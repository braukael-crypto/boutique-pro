export type Plan = {
  code: string;
  name: string;
  monthlyAmount: number | string;
  currency: string;
};

export type Subscription = {
  id: string;
  plan: string;
  status: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
};

export type Payment = {
  id: string;
  plan: string;
  status: string;
  amount: number | string;
  currency: string;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
};

export type BillingData = {
  plans: Plan[];
  subscription: Subscription | null;
  payments: Payment[];
  role: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAmount(value: unknown): value is number | string {
  return (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPlan(value: unknown): value is Plan {
  return isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    isAmount(value.monthlyAmount) &&
    typeof value.currency === "string";
}

function isSubscription(value: unknown): value is Subscription {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.plan === "string" &&
    typeof value.status === "string" &&
    isNullableString(value.trialStartedAt) &&
    isNullableString(value.trialEndsAt) &&
    isNullableString(value.currentPeriodStart) &&
    isNullableString(value.currentPeriodEnd);
}

function isPayment(value: unknown): value is Payment {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.plan === "string" &&
    typeof value.status === "string" &&
    isAmount(value.amount) &&
    typeof value.currency === "string" &&
    isNullableString(value.paidAt) &&
    isNullableString(value.periodStart) &&
    isNullableString(value.periodEnd) &&
    typeof value.createdAt === "string";
}

export function parseBillingData(value: unknown): BillingData {
  if (
    !isRecord(value) ||
    !Array.isArray(value.plans) ||
    !value.plans.every(isPlan) ||
    !(value.subscription === null || isSubscription(value.subscription)) ||
    !Array.isArray(value.payments) ||
    !value.payments.every(isPayment) ||
    typeof value.role !== "string"
  ) {
    throw new Error("Le serveur a renvoyé des informations de facturation invalides.");
  }

  return {
    plans: value.plans,
    subscription: value.subscription,
    payments: value.payments,
    role: value.role,
  };
}
