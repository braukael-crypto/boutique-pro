export function canManageBilling(role: unknown): role is "OWNER" | "MANAGER" {
  return role === "OWNER" || role === "MANAGER";
}

export function subscriptionCycleIdempotencyKey(
  subscriptionId: string,
  currentPeriodEnd: string | null,
  trialEndsAt: string | null,
) {
  const periodAnchor = currentPeriodEnd ?? trialEndsAt ?? "initial";
  return `subscription:${subscriptionId}:period:${periodAnchor}`;
}

type LinkedProviderTransactionInput = {
  transactionId: unknown;
  localProviderPaymentId: unknown;
  providerReference: unknown;
  localProviderReference: unknown;
  providerAmount: unknown;
  localAmount: unknown;
  providerCurrency: unknown;
  localCurrency: unknown;
};

type VerifiedProviderSuccessInput = LinkedProviderTransactionInput & {
  providerStatus: unknown;
  /** When provided, must be a recognized success status (e.g. SUCCESS/approved). */
  expectedProviderStatus?: string | string[];
  /** When provided, compared case-insensitively (and space/dash-insensitively) to the expected currency. */
  expectedCurrency?: string;
};

function normalizeStatus(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeCurrency(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * Provider-agnostic link/consistency check between a locally recorded payment
 * attempt and a provider-side transaction. Used before activating any subscription.
 */
export function isLinkedProviderTransaction(
  input: LinkedProviderTransactionInput & { expectedCurrency?: string },
) {
  const providerAmount = Number(input.providerAmount);
  const localAmount = Number(input.localAmount);
  const expectedCurrency = normalizeCurrency(input.expectedCurrency ?? input.localCurrency ?? "XOF");

  return input.transactionId !== null && input.transactionId !== undefined &&
    String(input.transactionId) === String(input.localProviderPaymentId) &&
    typeof input.providerReference === "string" && input.providerReference.length > 0 &&
    input.providerReference === input.localProviderReference &&
    Number.isFinite(providerAmount) && providerAmount > 0 && providerAmount === localAmount &&
    normalizeCurrency(input.providerCurrency) === expectedCurrency &&
    normalizeCurrency(input.localCurrency) === expectedCurrency;
}

/**
 * Confirms a provider transaction is successful AND matches the local payment.
 * Supports SasPay (SUCCESS) and legacy approved status naming.
 */
export function isVerifiedProviderSuccess(input: VerifiedProviderSuccessInput) {
  const status = normalizeStatus(input.providerStatus);
  const allowed = input.expectedProviderStatus === undefined
    ? ["SUCCESS", "APPROVED"]
    : Array.isArray(input.expectedProviderStatus)
      ? input.expectedProviderStatus.map((s) => normalizeStatus(s))
      : [normalizeStatus(input.expectedProviderStatus)];

  return allowed.includes(status) && isLinkedProviderTransaction(input);
}

/**
 * Maps a provider-side terminal state to a local subscription payment status.
 * Activation is never derived from this mapping; only failure/cancellation.
 */
export function terminalPaymentStatus(providerStatus: unknown) {
  const status = normalizeStatus(providerStatus);
  if (status === "FAILED" || status === "DECLINED") return "FAILED" as const;
  if (status === "CANCELLED" || status === "CANCELED") return "CANCELLED" as const;
  return null;
}

export function providerHttpStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { httpStatus?: unknown; status?: unknown; response?: { status?: unknown } };
  for (const candidate of [record.httpStatus, record.status, record.response?.status]) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
  }
  return null;
}

export function isSasPayApiKey(value: string | undefined) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.startsWith("sk_test_") || trimmed.startsWith("sk_live_");
}

export function isSasPayTestApiKey(value: string | undefined) {
  return typeof value === "string" && value.trim().startsWith("sk_test_");
}

export type SubscriptionAccess = {
  canRead: boolean;
  canWrite: boolean;
  reason:
    | "trial_active"
    | "active_period_valid"
    | "past_due_period_valid"
    | "canceled_period_valid"
    | "trial_expired"
    | "active_period_expired"
    | "past_due_no_valid_period"
    | "expired"
    | "canceled_period_expired"
    | "missing_subscription"
    | "invalid_or_missing_dates"
    | "unknown_status";
};

export type SubscriptionAccessInput = {
  status: string | null | undefined;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
} | null | undefined;

function parseTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getSubscriptionAccess(
  subscription: SubscriptionAccessInput,
  now: Date = new Date(),
): SubscriptionAccess {
  const readOnly = (reason: SubscriptionAccess["reason"]): SubscriptionAccess => ({
    canRead: true,
    canWrite: false,
    reason,
  });

  if (subscription == null) return readOnly("missing_subscription");

  const status = typeof subscription.status === "string"
    ? subscription.status.trim().toUpperCase()
    : "";

  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return readOnly("invalid_or_missing_dates");

  const trialEndsAt = parseTimestamp(subscription.trialEndsAt ?? null);
  const currentPeriodEnd = parseTimestamp(subscription.currentPeriodEnd ?? null);

  switch (status) {
    case "TRIALING":
      if (trialEndsAt === null) return readOnly("invalid_or_missing_dates");
      return nowTime < trialEndsAt
        ? { canRead: true, canWrite: true, reason: "trial_active" }
        : readOnly("trial_expired");

    case "ACTIVE":
      if (currentPeriodEnd === null) return readOnly("invalid_or_missing_dates");
      return nowTime < currentPeriodEnd
        ? { canRead: true, canWrite: true, reason: "active_period_valid" }
        : readOnly("active_period_expired");

    case "PAST_DUE":
      if (currentPeriodEnd === null) return readOnly("invalid_or_missing_dates");
      return nowTime < currentPeriodEnd
        ? { canRead: true, canWrite: true, reason: "past_due_period_valid" }
        : readOnly("past_due_no_valid_period");

    case "EXPIRED":
      return readOnly("expired");

    case "CANCELED":
      if (currentPeriodEnd === null) return readOnly("invalid_or_missing_dates");
      return nowTime < currentPeriodEnd
        ? { canRead: true, canWrite: true, reason: "canceled_period_valid" }
        : readOnly("canceled_period_expired");

    default:
      return readOnly("unknown_status");
  }
}
