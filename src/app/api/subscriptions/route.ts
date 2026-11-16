import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createSuperAdminClient } from "@/lib/supabase/admin";
import { canManageBilling } from "@/lib/subscriptions/policy";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Authentification requise.", 401);
    }

    const { data: membership, error: membershipError } = await supabase
      .from("shop_memberships")
      .select("shopId, role")
      .eq("userId", user.id)
      .order("createdAt", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error("[subscriptions] membership lookup:", membershipError);
      return jsonError("Impossible de vérifier l'appartenance à la boutique.", 500);
    }

    if (!membership?.shopId) {
      return jsonError("Aucune boutique autorisée trouvée.", 403);
    }

    if (!canManageBilling(membership.role)) {
      return jsonError("Accès réservé au propriétaire ou à l'administration de la boutique.", 403);
    }

    const admin = createSuperAdminClient();
    const shopId = membership.shopId;

    const [plansResult, subscriptionResult, paymentsResult] =
      await Promise.all([
        admin
          .from("subscription_plans")
          .select('code, name, "monthlyAmount", currency')
          .eq("isActive", true)
          .order("monthlyAmount", { ascending: true }),

        admin
          .from("subscriptions")
          .select(
            'id, plan, status, currency, "trialStartedAt", "trialEndsAt", "currentPeriodStart", "currentPeriodEnd"',
          )
          .eq("shopId", shopId)
          .maybeSingle(),

        admin
          .from("subscription_payments")
          .select(
            'id, plan, status, amount, currency, "paidAt", "periodStart", "periodEnd", "createdAt"',
          )
          .eq("shopId", shopId)
          .order("createdAt", { ascending: false })
          .limit(50),
      ]);

    if (plansResult.error) {
      console.error("[subscriptions] plans:", plansResult.error);
      return jsonError("Impossible de charger les forfaits.", 500);
    }

    if (subscriptionResult.error) {
      console.error("[subscriptions] subscription:", subscriptionResult.error);
      return jsonError("Impossible de charger l'abonnement.", 500);
    }

    if (paymentsResult.error) {
      console.error("[subscriptions] payments:", paymentsResult.error);
      return jsonError("Impossible de charger les paiements.", 500);
    }

    return NextResponse.json({
      plans: plansResult.data ?? [],
      subscription: subscriptionResult.data ?? null,
      payments: paymentsResult.data ?? [],
      role: membership.role,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[subscriptions] GET failed:", error);
    return jsonError("Une erreur serveur est survenue.", 500);
  }
}
