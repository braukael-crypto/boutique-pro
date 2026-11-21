import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSuperAdminClient } from "@/lib/supabase/admin";
import {
  canManageBilling,
  shouldFailPendingCheckoutAttempt,
  subscriptionCycleIdempotencyKey,
} from "@/lib/subscriptions/policy";
import { createCheckoutSession, safeCheckoutUrl } from "@/lib/saspay";

const PLAN_CODES = ["ESSENTIAL", "STANDARD", "PREMIUM", "ENTERPRISE"] as const;
const PROVIDER = "SASPAY" as const;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function trustedSiteOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const requestOrigin = request.headers.get("origin");
  if (!configured || !requestOrigin) return null;

  try {
    const configuredUrl = new URL(configured);
    const originUrl = new URL(requestOrigin);
    if (configuredUrl.origin !== originUrl.origin) return null;
    if (process.env.NODE_ENV === "production" && configuredUrl.protocol !== "https:") return null;
    return configuredUrl.origin;
  } catch {
    return null;
  }
}

type PendingPaymentRow = {
  id: string;
  plan: string;
  amount: number | string;
  status: string;
  providerPaymentId: string | null;
  providerReference: string | null;
};

function isPendingReusable(payment: PendingPaymentRow, planCode: string, amount: number) {
  return payment.status === "PENDING" && payment.plan === planCode && Number(payment.amount) === amount;
}


export async function POST(request: NextRequest) {
  const siteOrigin = trustedSiteOrigin(request);
  if (!siteOrigin) return jsonError("Origine de la requête non autorisée ou URL du site manquante.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corps de requête invalide.", 400);
  }

  if (!body || typeof body !== "object") return jsonError("Paramètres invalides.", 400);
  const input = body as Record<string, unknown>;
  if (!PLAN_CODES.includes(input.plan as (typeof PLAN_CODES)[number])) {
    return jsonError("Formule invalide.", 400);
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError("Authentification requise.", 401);

  const { data: membership, error: membershipError } = await supabase
    .from("shop_memberships")
    .select("shopId, role")
    .eq("userId", user.id)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("[subscriptions/checkout] membership lookup failed:", membershipError);
    return jsonError("Impossible de vérifier l'appartenance à la boutique.", 500);
  }
  if (!membership?.shopId) return jsonError("Aucune boutique autorisée trouvée.", 403);
  if (!canManageBilling(membership.role)) {
    return jsonError("Accès réservé au propriétaire ou au responsable de la boutique.", 403);
  }

  const admin = createSuperAdminClient();
  const shopId = membership.shopId as string;
  const [{ data: plan, error: planError }, { data: subscription, error: subscriptionError }] =
    await Promise.all([
      admin.from("subscription_plans")
        .select('code, name, "monthlyAmount", currency')
        .eq("code", input.plan)
        .eq("isActive", true)
        .maybeSingle(),
      admin.from("subscriptions")
        .select('id, plan, status, "trialEndsAt", "currentPeriodEnd"')
        .eq("shopId", shopId)
        .maybeSingle(),
    ]);

  if (planError || subscriptionError) {
    console.error("[subscriptions/checkout] lookup failed:", planError?.code ?? subscriptionError?.code ?? "unknown");
    return jsonError("Impossible de préparer ce paiement.", 500);
  }
  if (!plan || !subscription) {
    return jsonError("La formule ou l'abonnement de cette boutique est indisponible.", 409);
  }

  const amount = Number(plan.monthlyAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || plan.currency !== "XOF") {
    console.error("[subscriptions/checkout] invalid server-side plan price:", plan.code);
    return jsonError("Le tarif configuré pour cette formule est invalide.", 500);
  }
  if (!user.email) return jsonError("Une adresse e-mail confirmée est nécessaire pour le paiement.", 400);

  const idempotencyKey = subscriptionCycleIdempotencyKey(
    subscription.id,
    subscription.currentPeriodEnd,
    subscription.trialEndsAt,
  );

  const { data: existingPayment, error: existingPaymentError } = await admin
    .from("subscription_payments")
    .select('id, plan, amount, status, "providerPaymentId", "providerReference"')
    .eq("shopId", shopId)
    .eq("idempotencyKey", idempotencyKey)
    .maybeSingle();

  if (existingPaymentError) {
    console.error("[subscriptions/checkout] idempotency lookup failed:", existingPaymentError.code);
    return jsonError("Impossible de vérifier cette tentative de paiement.", 500);
  }

  if (existingPayment?.status === "PENDING") {
    if (!isPendingReusable(existingPayment as PendingPaymentRow, plan.code, amount)) {
      return jsonError("Un paiement est déjà en attente pour une autre formule.", 409);
    }
    // SasPay checkout URL is only returned at creation; prevent duplicate unpaid session creation.
    return jsonError("Un paiement est déjà en attente pour cette période. Finalisez-le ou attendez sa confirmation/expiration avant d'en créer un nouveau.", 409);
  }

  if (existingPayment && existingPayment.status !== "FAILED" && existingPayment.status !== "CANCELLED") {
    return jsonError("Cette période a déjà une tentative de paiement traitée. Contactez le support si nécessaire.", 409);
  }

  const { data: pendingPayment, error: pendingPaymentError } = await admin
    .from("subscription_payments")
    .select('id, plan, amount, status, "providerPaymentId", "providerReference"')
    .eq("shopId", shopId)
    .eq("status", "PENDING")
    .limit(1)
    .maybeSingle();

  if (pendingPaymentError) {
    console.error("[subscriptions/checkout] pending payment lookup failed:", pendingPaymentError.code);
    return jsonError("Impossible de vérifier les paiements en attente.", 500);
  }
  if (pendingPayment) {
    return jsonError("Un autre paiement est déjà en attente pour cette boutique. Finalisez-le ou contactez le support.", 409);
  }

  const localReference = `BP-${randomUUID()}`;
  let paymentId: string;

  if (existingPayment && (existingPayment.status === "FAILED" || existingPayment.status === "CANCELLED")) {
    const { data: retryClaim, error: retryError } = await admin
      .from("subscription_payments")
      .update({
        status: "PENDING",
        plan: plan.code,
        amount,
        currency: "XOF",
        provider: PROVIDER,
        providerPaymentId: null,
        providerReference: localReference,
        paidAt: null,
        periodStart: null,
        periodEnd: null,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", existingPayment.id)
      .eq("status", existingPayment.status)
      .select("id")
      .maybeSingle();

    if (retryError) {
      console.error("[subscriptions/checkout] failed payment retry claim failed:", retryError.code);
      return jsonError("Impossible de reprendre cette tentative de paiement.", 500);
    }
    if (!retryClaim) return jsonError("Cette tentative vient d'être reprise dans un autre onglet. Rechargez la page.", 409);
    paymentId = retryClaim.id;
  } else {
    const { data: payment, error: insertError } = await admin
      .from("subscription_payments")
      .insert({
        shopId,
        subscriptionId: subscription.id,
        plan: plan.code,
        provider: PROVIDER,
        status: "PENDING",
        amount,
        currency: "XOF",
        providerReference: localReference,
        idempotencyKey,
      })
      .select("id")
      .single();

    if (insertError || !payment) {
      if (insertError?.code === "23505") {
        return jsonError("Une tentative de paiement est déjà en cours pour cette période.", 409);
      }
      console.error("[subscriptions/checkout] payment insert failed:", insertError?.code ?? "unknown");
      return jsonError("Impossible de créer la tentative de paiement.", 500);
    }
    paymentId = payment.id;
  }

  // Create external checkout session only after local pending attempt is recorded (and protected against duplicates).
  let session: Awaited<ReturnType<typeof createCheckoutSession>> | null = null;
  try {
    session = await createCheckoutSession({
      amount,
      currency: "XOF",
      customerEmail: user.email,
      customerName: (user.user_metadata?.full_name as string | undefined)?.trim() || user.email,
      description: `Abonnement BoutiquePro ${plan.code} ${localReference}`,
      returnUrl: new URL("/abonnements?retour=saspay", siteOrigin).toString(),
      metadata: {
        boutiquepro_payment_reference: localReference,
        boutiquepro_shop_id: shopId,
        boutiquepro_subscription_id: subscription.id,
        boutiquepro_plan: plan.code,
      },
    });

    const checkoutUrl = safeCheckoutUrl(session.checkoutUrl);
    if (!checkoutUrl) throw new Error("SasPay returned an invalid checkout URL");

    // Store checkout session id as providerPaymentId to allow status/verification lookups.
    const { error: associationError } = await admin
      .from("subscription_payments")
      .update({
        providerPaymentId: session.id,
        providerReference: localReference,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .eq("status", "PENDING");
    if (associationError) throw associationError;

    return NextResponse.json({ paymentId, checkoutUrl, amount, currency: "XOF", plan: plan.code });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "unknown error";
    console.error("[subscriptions/checkout] SasPay session creation failed:", errorName);
    if (shouldFailPendingCheckoutAttempt({
      providerSessionCreated: session !== null,
      providerPaymentId: session?.id ?? null,
    })) {
      const { error: releaseError } = await admin
        .from("subscription_payments")
        .update({
          status: "FAILED",
          providerPaymentId: null,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", paymentId)
        .eq("status", "PENDING");
      if (releaseError) {
        console.error("[subscriptions/checkout] failed attempt release failed:", releaseError.code);
      } else {
        const { error: eventError } = await admin.from("payment_events").insert({
          provider: PROVIDER,
          eventId: `local:checkout-session-creation-failed:${paymentId}:${randomUUID()}`,
          paymentId,
          payload: {
            event: "checkout.session_creation_failed",
            paymentReference: localReference,
            error: errorName,
          },
          processedAt: new Date().toISOString(),
        });
        if (eventError) {
          console.error("[subscriptions/checkout] failed attempt event insert failed:", eventError.code);
        }
      }
    } else {
      console.error("[subscriptions/checkout] provider session exists; local attempt remains pending");
    }
    return jsonError("Impossible de démarrer le paiement SasPay. Le paiement reste non confirmé.", 502);
  }
}
