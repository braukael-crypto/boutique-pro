import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  extractWebhookHeaders,
  safeCheckoutUrl,
  verifyWebhookSignature,
} from "../../src/lib/saspay.ts";

const FAKE_SECRET = "whsec_unit_fake_000000000000";
const NOW_SECONDS = 1_800_000_000;
const TOLERANCE_SECONDS = 300;

function sign(rawBody, timestamp) {
  return createHmac("sha256", FAKE_SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
}

function verify(rawBody, signature, timestamp, options = {}) {
  return verifyWebhookSignature({
    rawBody,
    signature,
    timestamp,
    secret: FAKE_SECRET,
    nowSeconds: NOW_SECONDS,
    toleranceSeconds: TOLERANCE_SECONDS,
    ...options,
  });
}

test("a correctly signed recent webhook is accepted", () => {
  const rawBody = JSON.stringify({ event: "transaction.success", data: { id: "txn_1" } });
  const result = verify(rawBody, sign(rawBody, NOW_SECONDS), String(NOW_SECONDS));
  assert.equal(result.ok, true);
  assert.equal(result.timestamp, NOW_SECONDS);
});

test("uppercase hexadecimal signatures are accepted", () => {
  const rawBody = "{\"event\":\"transaction.failed\"}";
  const result = verify(rawBody, sign(rawBody, NOW_SECONDS).toUpperCase(), String(NOW_SECONDS));
  assert.equal(result.ok, true);
});

test("missing signature or timestamp headers are rejected", () => {
  const rawBody = "{}";
  assert.equal(verify(rawBody, null, String(NOW_SECONDS)).reason, "missing_headers");
  assert.equal(verify(rawBody, sign(rawBody, NOW_SECONDS), null).reason, "missing_headers");
});

test("non numeric and stale timestamps are rejected", () => {
  const rawBody = "{}";
  assert.equal(verify(rawBody, sign(rawBody, NOW_SECONDS), "not-a-number").reason, "invalid_timestamp");
  assert.equal(
    verify(rawBody, sign(rawBody, NOW_SECONDS - 301), String(NOW_SECONDS - 301)).reason,
    "timestamp_out_of_tolerance",
  );
  assert.equal(
    verify(rawBody, sign(rawBody, NOW_SECONDS + 301), String(NOW_SECONDS + 301)).reason,
    "timestamp_out_of_tolerance",
  );
});

test("tampered bodies and wrong signatures are rejected", () => {
  const originalBody = JSON.stringify({ amount: 1000 });
  const tamperedBody = JSON.stringify({ amount: 999999 });
  const signature = sign(originalBody, NOW_SECONDS);
  assert.equal(verify(tamperedBody, signature, String(NOW_SECONDS)).reason, "signature_mismatch");
  assert.equal(verify(originalBody, "00".repeat(32), String(NOW_SECONDS)).reason, "signature_mismatch");
  assert.equal(verify(originalBody, "zz", String(NOW_SECONDS)).reason, "signature_mismatch");
});

test("webhook headers are read from their exact names", () => {
  const headers = new Headers({
    "x-webhook-signature": "signature-value",
    "x-webhook-timestamp": "123",
    "x-webhook-event": "transaction.success",
  });
  assert.deepEqual(extractWebhookHeaders(headers), {
    signature: "signature-value",
    timestamp: "123",
    event: "transaction.success",
  });
});

test("checkout URLs are restricted to HTTPS saspay.me hosts", () => {
  assert.equal(safeCheckoutUrl("https://pay.saspay.me/checkout/cs_1"), "https://pay.saspay.me/checkout/cs_1");
  assert.equal(safeCheckoutUrl("https://saspay.me/checkout/cs_1"), "https://saspay.me/checkout/cs_1");
  assert.equal(safeCheckoutUrl("https://checkout.saspay.me/cs_1"), "https://checkout.saspay.me/cs_1");
  assert.equal(safeCheckoutUrl("http://pay.saspay.me/checkout/cs_1"), null);
  assert.equal(safeCheckoutUrl("https://evil.example/?next=https://pay.saspay.me"), null);
  assert.equal(safeCheckoutUrl("https://pay.saspay.me.example/checkout"), null);
  assert.equal(safeCheckoutUrl(null), null);
});
