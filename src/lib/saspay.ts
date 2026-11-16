import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const SASPAY_BASE_URL = "https://api.saspay.me/api/v1";
const SASPAY_WEBHOOK_TOLERANCE_SECONDS = 300;

type SasPayEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: unknown;
  code?: number;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type SasPayCheckoutSession = {
  id: string;
  slug: string | null;
  checkoutUrl: string;
  status: string;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
  raw: Record<string, unknown>;
};

export type SasPayPaymentVerification = {
  id: string;
  status: string;
  amount: number | null;
  currency: string | null;
  reference: string | null;
  raw: Record<string, unknown>;
};

export type SasPayWebhookHeaders = {
  signature: string | null;
  timestamp: string | null;
  event: string | null;
};

export class SasPayRequestError extends Error {
  status: number | null;
  code: string | number | null;
  details: unknown;

  constructor(message: string, status: number | null, code: string | number | null, details: unknown) {
    super(message);
    this.name = "SasPayRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getSasPaySecretKey() {
  const key = process.env.SASPAY_SECRET_KEY?.trim();
  if (!key) throw new Error("SASPAY_SECRET_KEY is not configured");
  if (!(key.startsWith("sk_test_") || key.startsWith("sk_live_"))) {
    throw new Error("SASPAY_SECRET_KEY must start with sk_test_ or sk_live_");
  }
  return key;
}

export function getSasPayWebhookSecret() {
  const secret = process.env.SASPAY_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("SASPAY_WEBHOOK_SECRET is not configured");
  return secret;
}

async function sasPayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getSasPaySecretKey();
  const response = await fetch(`${SASPAY_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  const envelope = (payload && typeof payload === "object" ? payload : null) as SasPayEnvelope<T> | null;
  if (!response.ok || envelope?.success === false) {
    const err = envelope?.error;
    const errRec = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
    const detailMessage = readString(errRec?.message ?? errRec?.detail);
    const errCode = errRec?.code;
    throw new SasPayRequestError(
      detailMessage ?? `SasPay request failed (${response.status})`,
      response.status,
      (typeof errCode === "string" || typeof errCode === "number" ? errCode : envelope?.code ?? null),
      envelope?.error ?? payload,
    );
  }

  return (envelope && "data" in envelope ? envelope.data : payload) as T;
}

export async function createCheckoutSession(input: {
  amount: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  description?: string;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  const data = await sasPayRequest<Record<string, unknown>>("/checkout-sessions/", {
    method: "POST",
    body: JSON.stringify({
      amount: String(input.amount),
      currency: input.currency,
      customer_email: input.customerEmail,
      customer_name: input.customerName,
      ...(input.description ? { description: input.description } : {}),
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
  });

  const id = readString(data.id);
  const checkoutUrl = readString(data.checkout_url ?? data.checkoutUrl ?? data.url);
  const status = readString(data.status) ?? "PENDING";
  const slug = readString(data.slug);
  const tx = data.transaction;
  const txRec = tx && typeof tx === "object" ? (tx as Record<string, unknown>) : null;
  const transactionId = readString(txRec?.id ?? txRec?.transaction_id ?? data.transaction_id);

  if (!id || !checkoutUrl) {
    throw new SasPayRequestError("SasPay checkout session response is missing identifiers", null, null, data);
  }

  return {
    id,
    slug,
    checkoutUrl,
    status,
    transactionId,
    amount: readNumber(data.amount),
    currency: readString(data.currency),
    raw: data,
  } satisfies SasPayCheckoutSession;
}

function normalizeVerification(raw: Record<string, unknown>, fallbackId: string): SasPayPaymentVerification {
  const status = readString(raw.status ?? raw.state ?? raw.payment_status) ?? "UNKNOWN";
  const rawRec = raw as Record<string, unknown>;
  const amount = readNumber(raw.amount ?? rawRec.amount_paid ?? rawRec.total);
  const currencyObj = raw.currency;
  const currencyRec = currencyObj && typeof currencyObj === "object" ? (currencyObj as Record<string, unknown>) : null;
  const currency = readString(
    raw.currency_iso ?? raw.currency_code ?? currencyRec?.iso ?? currencyRec?.code ?? (typeof raw.currency === "string" ? raw.currency : null),
  );
  const reference = readString(raw.reference ?? raw.provider_reference ?? raw.merchant_reference ?? raw.id);
  return {
    id: readString(raw.id ?? raw.payment_id ?? raw.transaction_id) ?? fallbackId,
    status,
    amount,
    currency,
    reference,
    raw,
  };
}

export async function getCheckoutSessionStatus(sessionId: string) {
  const data = await sasPayRequest<Record<string, unknown>>(`/checkout-sessions/${encodeURIComponent(sessionId)}/status/`, {
    method: "GET",
  });
  return normalizeVerification(data, sessionId);
}

export async function verifyPayment(paymentId: string) {
  const data = await sasPayRequest<Record<string, unknown>>(`/payments/${encodeURIComponent(paymentId)}/verify/`, {
    method: "GET",
  });
  return normalizeVerification(data, paymentId);
}

export function extractWebhookHeaders(headers: Headers): SasPayWebhookHeaders {
  return {
    signature: headers.get("x-webhook-signature"),
    timestamp: headers.get("x-webhook-timestamp"),
    event: headers.get("x-webhook-event"),
  };
}

export function verifyWebhookSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}) {
  const { rawBody, signature, timestamp, secret } = input;
  if (!signature || !timestamp) return { ok: false as const, reason: "missing_headers" as const };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false as const, reason: "invalid_timestamp" as const };

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? SASPAY_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - ts) > tolerance) {
    return { ok: false as const, reason: "timestamp_out_of_tolerance" as const };
  }

  const signed = `${timestamp}.${rawBody}`;
  const expectedHex = createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  const provided = signature.trim().toLowerCase();
  const expected = Buffer.from(expectedHex, "hex");
  const given = Buffer.from(provided, "hex");
  if (expected.length !== given.length || expected.length === 0) {
    return { ok: false as const, reason: "signature_mismatch" as const };
  }
  if (!timingSafeEqual(expected, given)) {
    return { ok: false as const, reason: "signature_mismatch" as const };
  }

  return { ok: true as const, timestamp: ts };
}

export function safeCheckoutUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    // SasPay hosted checkout and documented domains
    if (
      url.hostname === "pay.saspay.me" ||
      url.hostname === "saspay.me" ||
      url.hostname.endsWith(".saspay.me")
    ) {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}
