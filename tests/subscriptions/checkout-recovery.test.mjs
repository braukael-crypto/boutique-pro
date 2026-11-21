import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { shouldFailPendingCheckoutAttempt } from "../../src/lib/subscriptions/policy.ts";

const checkoutSource = fs.readFileSync("src/app/api/subscriptions/checkout/route.ts", "utf8");
const webhookSource = fs.readFileSync("src/app/api/webhooks/saspay/route.ts", "utf8");

test("checkout failure releases only attempts without a provider session", () => {
  assert.equal(shouldFailPendingCheckoutAttempt({
    providerSessionCreated: false,
    providerPaymentId: null,
  }), true);
  assert.equal(shouldFailPendingCheckoutAttempt({
    providerSessionCreated: false,
    providerPaymentId: undefined,
  }), true);
  assert.equal(shouldFailPendingCheckoutAttempt({
    providerSessionCreated: true,
    providerPaymentId: null,
  }), false);
  assert.equal(shouldFailPendingCheckoutAttempt({
    providerSessionCreated: false,
    providerPaymentId: "cs_existing_1",
  }), false);
  assert.equal(shouldFailPendingCheckoutAttempt({
    providerSessionCreated: true,
    providerPaymentId: "cs_existing_1",
  }), false);
});

test("checkout failure keeps the local attempt and records a traceability event", () => {
  assert.match(checkoutSource, /if \(shouldFailPendingCheckoutAttempt\(\{/);
  assert.match(checkoutSource, /status: "FAILED"/);
  assert.match(checkoutSource, /\.eq\("status", "PENDING"\)/);
  assert.match(checkoutSource, /from\("payment_events"\)\.insert/);
  assert.match(checkoutSource, /local:checkout-session-creation-failed/);
  assert.doesNotMatch(checkoutSource, /\.delete\(/);
});

test("a created provider session is never released for duplicate checkout creation", () => {
  assert.match(checkoutSource, /providerSessionCreated: session !== null/);
  assert.match(checkoutSource, /providerPaymentId: session\?\.id \?\? null/);
  assert.match(checkoutSource, /provider session exists; local attempt remains pending/);
});

test("checkout never activates a subscription from the browser response", () => {
  assert.doesNotMatch(checkoutSource, /process_payment_event/);
  assert.doesNotMatch(checkoutSource, /status: "PAID"/);
  assert.match(checkoutSource, /returnUrl: new URL\("\/abonnements\?retour=saspay", siteOrigin\)/);
});

test("webhook still verifies server-side before any activation", () => {
  assert.match(webhookSource, /getSasPayWebhookSecret/);
  assert.match(webhookSource, /verifyWebhookSignature/);
  assert.match(webhookSource, /getCheckoutSessionStatus/);
  assert.match(webhookSource, /verifyPayment/);
  assert.match(webhookSource, /process_payment_event/);
  assert.match(webhookSource, /payment_events/);
});

test("SasPay checkout code contains no FedaPay reintroduction", () => {
  assert.doesNotMatch(checkoutSource, /fedapay/i);
  assert.doesNotMatch(webhookSource, /fedapay/i);
});
