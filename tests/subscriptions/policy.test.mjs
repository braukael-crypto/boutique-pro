import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageBilling,
  getSubscriptionAccess,
  isLinkedProviderTransaction,
  isSasPayApiKey,
  isSasPayTestApiKey,
  isVerifiedProviderSuccess,
  providerHttpStatus,
  subscriptionCycleIdempotencyKey,
  terminalPaymentStatus,
} from "../../src/lib/subscriptions/policy.ts";

test("billing access is limited to OWNER and MANAGER", () => {
  assert.equal(canManageBilling("OWNER"), true);
  assert.equal(canManageBilling("MANAGER"), true);
  assert.equal(canManageBilling("STAFF"), false);
  assert.equal(canManageBilling("ADMIN"), false);
  assert.equal(canManageBilling(null), false);
});

test("one subscription period has one server-derived idempotency key", () => {
  const key = subscriptionCycleIdempotencyKey("sub-1", "2026-12-10T00:00:00Z", null);
  assert.equal(key, subscriptionCycleIdempotencyKey("sub-1", "2026-12-10T00:00:00Z", null));
  assert.notEqual(key, subscriptionCycleIdempotencyKey("sub-1", "2027-01-10T00:00:00Z", null));
  assert.notEqual(key, subscriptionCycleIdempotencyKey("sub-2", "2026-12-10T00:00:00Z", null));
});

const linkedPayment = {
  transactionId: "tx_7123",
  localProviderPaymentId: "tx_7123",
  providerReference: "BP-ref-1",
  localProviderReference: "BP-ref-1",
  providerAmount: 3000,
  localAmount: "3000.00",
  providerCurrency: "XOF",
  localCurrency: "XOF",
};

test("valid provider success matches its local payment (SasPay SUCCESS and legacy approved)", () => {
  assert.equal(isVerifiedProviderSuccess({ ...linkedPayment, providerStatus: "SUCCESS" }), true);
  assert.equal(isVerifiedProviderSuccess({ ...linkedPayment, providerStatus: "approved" }), true);
  assert.equal(isLinkedProviderTransaction(linkedPayment), true);
});

test("provider success is rejected for any status, amount, currency, reference or ID mismatch", () => {
  for (const mismatch of [
    { providerStatus: "PENDING" },
    { providerStatus: "FAILED" },
    { transactionId: "tx_other" },
    { providerReference: "other-ref" },
    { providerAmount: 2999 },
    { providerCurrency: "USD" },
    { localCurrency: "USD" },
  ]) {
    assert.equal(isVerifiedProviderSuccess({ ...linkedPayment, providerStatus: "SUCCESS", ...mismatch }), false);
  }
});

test("only terminal failure/cancellation provider states become terminal local states", () => {
  assert.equal(terminalPaymentStatus("FAILED"), "FAILED");
  assert.equal(terminalPaymentStatus("declined"), "FAILED");
  assert.equal(terminalPaymentStatus("CANCELLED"), "CANCELLED");
  assert.equal(terminalPaymentStatus("canceled"), "CANCELLED");
  assert.equal(terminalPaymentStatus("SUCCESS"), null);
  assert.equal(terminalPaymentStatus("approved"), null);
  assert.equal(terminalPaymentStatus("PENDING"), null);
});

test("SasPay API key format helpers", () => {
  assert.equal(isSasPayApiKey(undefined), false);
  assert.equal(isSasPayApiKey("sk_sandbox_x"), false);
  assert.equal(isSasPayApiKey("sk_test_x"), true);
  assert.equal(isSasPayApiKey("sk_live_x"), true);
  assert.equal(isSasPayTestApiKey("sk_test_x"), true);
  assert.equal(isSasPayTestApiKey("sk_live_x"), false);
});

test("provider HTTP status is read without logging the SDK error object", () => {
  assert.equal(providerHttpStatus({ httpStatus: 422 }), 422);
  assert.equal(providerHttpStatus({ status: 502 }), 502);
  assert.equal(providerHttpStatus({ response: { status: 401 } }), 401);
  assert.equal(providerHttpStatus({ httpStatus: null }), null);
  assert.equal(providerHttpStatus(new Error("network")), null);
});

const NOW = new Date("2026-11-13T12:00:00.000Z");
const FUTURE = "2026-11-13T12:00:00.001Z";
const PAST = "2026-11-13T11:59:59.999Z";
const AT_NOW = "2026-11-13T12:00:00.000Z";

test("subscription access: missing subscription is read-only", () => {
  assert.deepEqual(getSubscriptionAccess(null, NOW), {
    canRead: true,
    canWrite: false,
    reason: "missing_subscription",
  });
  assert.deepEqual(getSubscriptionAccess(undefined, NOW), {
    canRead: true,
    canWrite: false,
    reason: "missing_subscription",
  });
});

test("subscription access: TRIALING allows writes until trialEndsAt (strict boundary)", () => {
  assert.deepEqual(getSubscriptionAccess({ status: "TRIALING", trialEndsAt: FUTURE }, NOW), {
    canRead: true,
    canWrite: true,
    reason: "trial_active",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "TRIALING", trialEndsAt: AT_NOW }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "trial_expired",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "TRIALING", trialEndsAt: PAST }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "trial_expired",
  });
});

test("subscription access: ACTIVE allows writes until currentPeriodEnd (strict boundary)", () => {
  assert.deepEqual(getSubscriptionAccess({ status: "ACTIVE", currentPeriodEnd: FUTURE }, NOW), {
    canRead: true,
    canWrite: true,
    reason: "active_period_valid",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "ACTIVE", currentPeriodEnd: AT_NOW }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "active_period_expired",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "ACTIVE", currentPeriodEnd: PAST }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "active_period_expired",
  });
});

test("subscription access: PAST_DUE allows writes only while paid period remains valid", () => {
  assert.deepEqual(getSubscriptionAccess({ status: "PAST_DUE", currentPeriodEnd: FUTURE }, NOW), {
    canRead: true,
    canWrite: true,
    reason: "past_due_period_valid",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "PAST_DUE", currentPeriodEnd: AT_NOW }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "past_due_no_valid_period",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "PAST_DUE", currentPeriodEnd: PAST }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "past_due_no_valid_period",
  });
});

test("subscription access: EXPIRED is read-only regardless of dates", () => {
  for (const dates of [
    { currentPeriodEnd: FUTURE, trialEndsAt: FUTURE },
    { currentPeriodEnd: AT_NOW, trialEndsAt: AT_NOW },
    { currentPeriodEnd: PAST, trialEndsAt: PAST },
    { currentPeriodEnd: null, trialEndsAt: null },
    { currentPeriodEnd: "not-a-date", trialEndsAt: "2026-13-40" },
  ]) {
    assert.deepEqual(getSubscriptionAccess({ status: "EXPIRED", ...dates }, NOW), {
      canRead: true,
      canWrite: false,
      reason: "expired",
    });
  }
});

test("subscription access: CANCELED allows writes until paid period end, then read-only", () => {
  assert.deepEqual(getSubscriptionAccess({ status: "CANCELED", currentPeriodEnd: FUTURE }, NOW), {
    canRead: true,
    canWrite: true,
    reason: "canceled_period_valid",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "CANCELED", currentPeriodEnd: AT_NOW }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "canceled_period_expired",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "CANCELED", currentPeriodEnd: PAST }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "canceled_period_expired",
  });
});

test("subscription access: missing or invalid dates are read-only", () => {
  const invalidDates = [null, undefined, "", "not-a-date", "2026-13-40"];
  for (const trialEndsAt of invalidDates) {
    assert.deepEqual(getSubscriptionAccess({ status: "TRIALING", trialEndsAt }, NOW), {
      canRead: true,
      canWrite: false,
      reason: "invalid_or_missing_dates",
    });
  }
  for (const currentPeriodEnd of invalidDates) {
    assert.deepEqual(getSubscriptionAccess({ status: "ACTIVE", currentPeriodEnd }, NOW), {
      canRead: true,
      canWrite: false,
      reason: "invalid_or_missing_dates",
    });
    assert.deepEqual(getSubscriptionAccess({ status: "PAST_DUE", currentPeriodEnd }, NOW), {
      canRead: true,
      canWrite: false,
      reason: "invalid_or_missing_dates",
    });
    assert.deepEqual(getSubscriptionAccess({ status: "CANCELED", currentPeriodEnd }, NOW), {
      canRead: true,
      canWrite: false,
      reason: "invalid_or_missing_dates",
    });
  }
});

test("subscription access: unknown status is read-only and status is normalized", () => {
  assert.deepEqual(getSubscriptionAccess({ status: "UNKNOWN", currentPeriodEnd: FUTURE }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "unknown_status",
  });
  assert.deepEqual(getSubscriptionAccess({ status: "", currentPeriodEnd: FUTURE }, NOW), {
    canRead: true,
    canWrite: false,
    reason: "unknown_status",
  });
  assert.deepEqual(getSubscriptionAccess({ status: " active ", currentPeriodEnd: FUTURE }, NOW), {
    canRead: true,
    canWrite: true,
    reason: "active_period_valid",
  });
});

test("subscription access: valid subscription remains writable regardless of payment pending (no payment input)", () => {
  assert.equal(getSubscriptionAccess({ status: "TRIALING", trialEndsAt: FUTURE }, NOW).canWrite, true);
  assert.equal(getSubscriptionAccess({ status: "ACTIVE", currentPeriodEnd: FUTURE }, NOW).canWrite, true);
  assert.equal(getSubscriptionAccess({ status: "PAST_DUE", currentPeriodEnd: FUTURE }, NOW).canWrite, true);
  assert.equal(getSubscriptionAccess({ status: "CANCELED", currentPeriodEnd: FUTURE }, NOW).canWrite, true);
});

test("subscription access: uses injected server time and does not mutate input", () => {
  const beforeEnd = new Date("2026-11-13T11:59:59.999Z");
  const atEnd = new Date("2026-11-13T12:00:00.000Z");
  const input = { status: "ACTIVE", currentPeriodEnd: AT_NOW };
  const snapshot = structuredClone(input);

  assert.equal(getSubscriptionAccess(input, beforeEnd).canWrite, true);
  assert.equal(getSubscriptionAccess(input, atEnd).canWrite, false);
  assert.deepEqual(input, snapshot);
});
