import { NextResponse } from "next/server";
import { createSuperAdminClient } from "@/lib/supabase/admin";
import {
  extractWebhookHeaders,
  getCheckoutSessionStatus,
  getSasPayWebhookSecret,
  verifyPayment,
  verifyWebhookSignature,
} from "@/lib/saspay";
import { terminalPaymentStatus } from "@/lib/subscriptions/policy";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type WebhookEnvelope = {
  event?: unknown;
  data?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000) return jsonError("Événement trop volumineux.", 413);

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 1_000_000) {
    return jsonError("Événement trop volumineux.", 413);
  }

  let webhookSecret: string;
  try {
    webhookSecret = getSasPayWebhookSecret();
  } catch {
    return jsonError("Le webhook SasPay n'est pas encore configuré.", 503);
  }

  const headers = extractWebhookHeaders(request.headers);
  const signatureCheck = verifyWebhookSignature({
    rawBody,
    signature: headers.signature,
    timestamp: headers.timestamp,
    secret: webhookSecret,
  });
  if (!signatureCheck.ok) {
    console.warn("[saspay webhook] rejected", { reason: signatureCheck.reason });
    return jsonError("Signature ou horodatage du webhook invalide.", 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError("Corps de webhook invalide.", 400);
  }

  const envelope = payload as WebhookEnvelope;
  const eventName = str(envelope?.event) ?? str(headers.event);
  const data = asRecord(envelope?.data) ?? asRecord(payload);
  if (!eventName || !data) {
    return jsonError("Événement ou données webhook manquants.", 400);
  }

  const admin = createSuperAdminClient();

  // Attempt to resolve local payment from webhook data (best-effort) without trusting it for activation.
  const metadata = asRecord(data.metadata) ?? {};
  const localReference =
    str(metadata.boutiquepro_payment_reference) ??
    str(data.reference) ??
    str(data.merchant_reference) ??
    null;
  const sessionId = str(data.checkout_session_id) ?? str(data.session_id) ?? null;
  const txId = str(data.transaction_id) ?? str(data.payment_id) ?? str(data.id) ?? sessionId;

  // Derive a stable idempotency key for the event (provider, eventId).
  // Prefer provider-supplied identifiers; fall back to stable business identifiers (no timestamp)
  // so webhook retries/deliveries are deduplicated.
  const stableSubject = txId ?? sessionId ?? localReference ?? "unknown";
  const eventId =
    str(data.event_id) ??
    str(data.delivery_id) ??
    str(data.idempotency_key) ??
    `${eventName}:${stableSubject}`;

  let payment: {
    id: string;
    providerPaymentId: string | null;
    providerReference: string | null;
    amount: number | string;
    currency: string;
    status: string;
  } | null = null;

  const lookupBy = async (column: string, value: string | null) => {
    if (!value) return null;
    const { data: row, error } = await admin
      .from("subscription_payments")
      .select('id, "providerPaymentId", "providerReference", amount, currency, status')
      .eq(column, value)
      .eq("provider", "SASPAY")
      .maybeSingle();
    if (error) {
      console.error("[saspay webhook] local payment lookup failed:", error.code);
      throw new Error("lookup_failed");
    }
    return row as typeof payment;
  };

  try {
    payment =
      (await lookupBy("providerPaymentId", sessionId)) ??
      (await lookupBy("providerPaymentId", txId)) ??
      (await lookupBy("providerReference", localReference));
  } catch {
    return jsonError("Impossible de retrouver le paiement local.", 500);
  }

  const eventPayload = {
    event: eventName,
    data,
    header_event: headers.event,
    header_timestamp: headers.timestamp,
  };

  const isSuccess = eventName === "transaction.success";
  const isFailure = eventName === "transaction.failed";
  const isCancelled = eventName === "transaction.cancelled";

  if (!payment) {
    // Unknown payment: acknowledge only if not a success event requiring activation; success must map to a known local payment.
    if (isSuccess) return jsonError("Aucun paiement local associé à cette transaction.", 404);
    return NextResponse.json({ received: true, ignored: true });
  }

  // For terminal non-success events, record and update status (idempotent) without activating.
  if (isFailure || isCancelled) {
    const { data: dup } = await admin
      .from("payment_events")
      .select("id")
      .eq("provider", "SASPAY")
      .eq("eventId", eventId)
      .maybeSingle();

    if (!dup) {
      await admin.from("payment_events").insert({
        provider: "SASPAY",
        eventId,
        paymentId: payment.id,
        payload: eventPayload,
        processedAt: new Date().toISOString(),
      });
    }

    if (payment.status === "PENDING") {
      const terminal = terminalPaymentStatus(isCancelled ? "CANCELLED" : "FAILED");
      if (terminal) {
        await admin
          .from("subscription_payments")
          .update({ status: terminal, updatedAt: new Date().toISOString() })
          .eq("id", payment.id)
          .eq("status", "PENDING");
      }
    }
    return NextResponse.json({ received: true });
  }

  if (!isSuccess) {
    // Record informational/other events idempotently.
    await admin.from("payment_events").upsert(
      {
        provider: "SASPAY",
        eventId,
        paymentId: payment.id,
        payload: eventPayload,
        processedAt: new Date().toISOString(),
      },
      { onConflict: "provider,eventId", ignoreDuplicates: true },
    );
    return NextResponse.json({ received: true });
  }

  // Success path: always verify against SasPay server-side before activation.
  try {
    const sessionLookupId = sessionId ?? payment.providerPaymentId;
    let verified = null as null | Awaited<ReturnType<typeof verifyPayment>>;
    let verifiedSessionStatus: string | null = null;

    if (sessionLookupId) {
      try {
        const sessionStatus = await getCheckoutSessionStatus(sessionLookupId);
        verifiedSessionStatus = sessionStatus.status;
        // Prefer verifying the concrete transaction/payment id when available.
        const txFromSession = str(asRecord(sessionStatus.raw)?.transaction_id ?? asRecord(asRecord(sessionStatus.raw)?.transaction)?.id ?? null);
        if (txFromSession) {
          verified = await verifyPayment(txFromSession);
        } else if (sessionStatus.reference || sessionStatus.amount !== null) {
          verified = {
            id: sessionStatus.id,
            status: sessionStatus.status,
            amount: sessionStatus.amount,
            currency: sessionStatus.currency,
            reference: sessionStatus.reference,
            raw: sessionStatus.raw,
          };
        }
      } catch {
        // fall through to direct payment verification
      }
    }

    if (!verified && txId) {
      verified = await verifyPayment(txId);
    }

    if (!verified) {
      return jsonError("Impossible de vérifier la transaction auprès de SasPay.", 502);
    }

    const status = (verified.status || verifiedSessionStatus || "").toUpperCase();
    if (status !== "SUCCESS") {
      if (payment.status === "PENDING") {
        const terminal = terminalPaymentStatus(status);
        if (terminal) {
          await admin
            .from("subscription_payments")
            .update({ status: terminal, updatedAt: new Date().toISOString() })
            .eq("id", payment.id)
            .eq("status", "PENDING");
        }
      }
      return NextResponse.json({ received: true, status });
    }

    const providerTxId = str(verified.id) || txId || str(payment.providerPaymentId) || "";
    const verifiedAmount = verified.amount ?? num(data.amount) ?? Number(payment.amount);
    const verifiedCurrency = (verified.currency || str(data.currency) || payment.currency || "XOF").toUpperCase();

    // Enforce strict consistency against the locally recorded payment (source of truth).
    // We confirm using the local internal reference stored at checkout (sent to/validated by RPC).
    const amountOk = Number.isFinite(verifiedAmount) && verifiedAmount > 0 && verifiedAmount === Number(payment.amount);
    const currencyOk = verifiedCurrency === "XOF" && String(payment.currency).toUpperCase() === "XOF";
    const localRefOk = typeof payment.providerReference === "string" && payment.providerReference.trim().length > 0;
    const txIdOk = providerTxId.trim().length > 0;
    if (!amountOk || !currencyOk || !localRefOk || !txIdOk) {
      return jsonError("La transaction vérifiée ne correspond pas au paiement attendu.", 409);
    }

    const paidAt = str(data.paid_at) ?? str(data.updated_at) ?? null;
    const paidAtIso = paidAt && Number.isFinite(Date.parse(paidAt)) ? new Date(paidAt).toISOString() : null;

    const { error: processError } = await admin.rpc("process_payment_event", {
      p_provider: "SASPAY",
      p_event_id: eventId,
      p_event_name: "transaction.success",
      p_payment_id: payment.id,
      p_provider_payment_id: providerTxId,
      p_provider_reference: payment.providerReference,
      p_verified_amount: Number(payment.amount),
      p_verified_currency: "XOF",
      p_paid_at: paidAtIso,
      p_payload: eventPayload,
    });

    if (processError) {
      console.error("[saspay webhook] event persistence/confirmation failed:", processError.code);
      return jsonError("Impossible de traiter l'événement SasPay.", 500);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[saspay webhook] verification failed:", error instanceof Error ? error.name : "unknown error");
    return jsonError("Impossible de vérifier la transaction auprès de SasPay.", 502);
  }
}
