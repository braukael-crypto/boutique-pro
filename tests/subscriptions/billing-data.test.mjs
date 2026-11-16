import assert from "node:assert/strict";
import test from "node:test";
import { parseBillingData } from "../../src/lib/subscriptions/billing-data.ts";

test("valid billing JSON preserves plans, subscription, role, and empty payments", () => {
  const payload = {
    plans: [
      { code: "ESSENTIAL", name: "Essentiel", monthlyAmount: "2000.00", currency: "XOF" },
      { code: "STANDARD", name: "Standard", monthlyAmount: 3000, currency: "XOF" },
    ],
    subscription: {
      id: "sub-1",
      plan: "ESSENTIAL",
      status: "TRIALING",
      trialStartedAt: "2026-11-01T00:00:00Z",
      trialEndsAt: "2026-12-01T00:00:00Z",
      currentPeriodStart: null,
      currentPeriodEnd: null,
    },
    payments: [],
    role: "OWNER",
  };

  assert.deepEqual(parseBillingData(payload), payload);
});

test("invalid billing JSON is rejected with a displayable error", () => {
  assert.throws(
    () => parseBillingData({ plans: [], subscription: {}, payments: [], role: "OWNER" }),
    /informations de facturation invalides/,
  );
});
