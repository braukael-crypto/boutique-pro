import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { getSubscriptionAccess } from "../../src/lib/subscriptions/policy.ts";

const productionServerSource = fs.readFileSync("src/lib/subscriptions/server.ts", "utf8");
const policyUrl = pathToFileURL(path.resolve("src/lib/subscriptions/policy.ts")).href;
const supabaseServerUrl = pathToFileURL(path.resolve("src/lib/supabase/server.ts")).href;
const serverSource = productionServerSource
  .replace('import "server-only";', 'void 0; // server-only mocked for node --test')
  .replace('from "./policy"', `from "${policyUrl}"`)
  .replace('import("../supabase/server")', `import("${supabaseServerUrl}")`);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-server-access-"));
const tmpServerPath = path.join(tmpDir, "server.ts");
fs.writeFileSync(tmpServerPath, serverSource, "utf8");
const { requireShopWriteAccess } = await import(pathToFileURL(tmpServerPath).href);

const NOW = new Date("2026-11-13T12:00:00.000Z");
const FUTURE = "2026-11-13T12:00:00.001Z";
const PAST = "2026-11-13T11:59:59.999Z";

function createSupabaseMock({
  user = { id: "user-1" },
  authError = null,
  membership = { shopId: "shop-1", role: "OWNER" },
  membershipError = null,
  subscription = { status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE },
  subscriptionError = null,
  calls = [],
} = {}) {
  return {
    auth: {
      async getUser() {
        calls.push({ op: "auth.getUser" });
        return { data: { user }, error: authError };
      },
    },
    from(table) {
      calls.push({ op: "from", table });
      if (table === "shop_memberships") {
        const q = {
          select(selection) { calls.push({ op: "select", table, selection }); return q; },
          eq(column, value) { calls.push({ op: "eq", table, column, value }); return q; },
          order() { calls.push({ op: "order", table }); return q; },
          limit() { calls.push({ op: "limit", table }); return q; },
          async maybeSingle() { calls.push({ op: "maybeSingle", table }); return { data: membership, error: membershipError }; },
        };
        return q;
      }
      if (table === "subscriptions") {
        const q = {
          select(selection) { calls.push({ op: "select", table, selection }); return q; },
          eq(column, value) { calls.push({ op: "eq", table, column, value }); return q; },
          async maybeSingle() { calls.push({ op: "maybeSingle", table }); return { data: subscription, error: subscriptionError }; },
        };
        return q;
      }
      throw new Error(`Unexpected table ${table}`);
    },
    rpc(name) {
      calls.push({ op: "rpc", name });
      throw new Error("rpc must not be called when write access is denied before mutation");
    },
  };
}

test("server guard: unauthenticated user is refused", async () => {
  const calls = [];
  const supabase = createSupabaseMock({ user: null, calls });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, "UNAUTHENTICATED");
  assert.deepEqual(calls, [{ op: "auth.getUser" }]);
});

test("server guard: auth lookup error is treated as unauthenticated refusal", async () => {
  const supabase = createSupabaseMock({ user: null, authError: new Error("auth") });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, "UNAUTHENTICATED");
});

test("server guard: user without shop membership is refused", async () => {
  const calls = [];
  const supabase = createSupabaseMock({ membership: null, calls });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, "NO_MEMBERSHIP");
  assert.equal(calls.some((c) => c.table === "subscriptions"), false);
});

test("server guard: membership lookup error never authorizes write", async () => {
  const supabase = createSupabaseMock({ membershipError: new Error("db") });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, "MEMBERSHIP_LOOKUP_FAILED");
});

test("server guard: subscription lookup error never authorizes write", async () => {
  const calls = [];
  const supabase = createSupabaseMock({ subscriptionError: new Error("db"), calls });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, "SUBSCRIPTION_LOOKUP_FAILED");
  assert.equal(calls.some((c) => c.op === "rpc"), false);
});

test("server guard: createClient failure never authorizes write", async () => {
  const result = await requireShopWriteAccess({}, {
    createClientFn: async () => { throw new Error("missing env"); },
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, "SUBSCRIPTION_LOOKUP_FAILED");
});

test("server guard: unexpected exception from auth.getUser never authorizes write", async () => {
  const supabase = {
    auth: { async getUser() { throw new Error("boom"); } },
    from() { throw new Error("must not query membership when auth throws"); },
  };
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, "UNAUTHENTICATED");
});

test("server guard: unexpected exception from membership query never authorizes write", async () => {
  const supabase = {
    auth: { async getUser() { return { data: { user: { id: "u1" } }, error: null }; } },
    from(table) {
      if (table === "shop_memberships") {
        return {
          select() { return this; },
          eq() { return this; },
          order() { return this; },
          limit() { return this; },
          async maybeSingle() { throw new Error("db throw"); },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, "MEMBERSHIP_LOOKUP_FAILED");
});

test("server guard: unexpected exception from subscription query never authorizes write", async () => {
  const supabase = {
    auth: { async getUser() { return { data: { user: { id: "u1" } }, error: null }; } },
    from(table) {
      if (table === "shop_memberships") {
        return {
          select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
          async maybeSingle() { return { data: { shopId: "shop-1", role: "OWNER" }, error: null }; },
        };
      }
      if (table === "subscriptions") {
        return {
          select() { return this; }, eq() { return this; },
          async maybeSingle() { throw new Error("db throw"); },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, "SUBSCRIPTION_LOOKUP_FAILED");
});

test("server guard: unexpected exception from access policy evaluation never authorizes write", async () => {
  const supabase = createSupabaseMock({ subscription: { status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE } });
  const result = await requireShopWriteAccess({}, {
    createClientFn: async () => supabase,
    now: NOW,
    getAccessFn: () => { throw new Error("policy boom"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, "SUBSCRIPTION_LOOKUP_FAILED");
});

test("server guard: absent subscription is read-only (write refused)", async () => {
  const supabase = createSupabaseMock({ subscription: null });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "WRITE_NOT_ALLOWED");
});

async function expectAllowed(subscription) {
  const supabase = createSupabaseMock({ subscription });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.shopId, "shop-1");
  assert.equal(result.userId, "user-1");
  assert.equal(result.access.canWrite, true);
  return result;
}

async function expectDenied(subscription, reason) {
  const calls = [];
  const supabase = createSupabaseMock({ subscription, calls });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "WRITE_NOT_ALLOWED");
  assert.equal(calls.some((c) => c.op === "rpc"), false, "no mutation/RPC before or after denied guard");
  if (reason) assert.equal(getSubscriptionAccess(subscription, NOW).reason, reason);
  return result;
}

test("server guard: ACTIVE valid period allows write", async () => {
  await expectAllowed({ status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE });
});

test("server guard: TRIALING valid allows write", async () => {
  await expectAllowed({ status: "TRIALING", trialEndsAt: FUTURE, currentPeriodEnd: null });
});

test("server guard: PAST_DUE with valid paid period allows write", async () => {
  await expectAllowed({ status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: FUTURE });
});

test("server guard: CANCELED with valid paid period allows write", async () => {
  await expectAllowed({ status: "CANCELED", trialEndsAt: null, currentPeriodEnd: FUTURE });
});

test("server guard: ACTIVE expired is refused", async () => {
  await expectDenied({ status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: PAST }, "active_period_expired");
});

test("server guard: EXPIRED is refused", async () => {
  await expectDenied({ status: "EXPIRED", trialEndsAt: FUTURE, currentPeriodEnd: FUTURE }, "expired");
});

test("server guard: invalid or missing date is refused", async () => {
  await expectDenied({ status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null }, "invalid_or_missing_dates");
  await expectDenied({ status: "TRIALING", trialEndsAt: "not-a-date", currentPeriodEnd: null }, "invalid_or_missing_dates");
});

test("server guard: unknown status is refused", async () => {
  await expectDenied({ status: "UNKNOWN", trialEndsAt: null, currentPeriodEnd: FUTURE }, "unknown_status");
});

test("server guard: pending payment does not block a still-valid subscription period", async () => {
  // Access decision is based only on subscription status/dates, never on payment status.
  await expectAllowed({ status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: FUTURE });
  await expectAllowed({ status: "TRIALING", trialEndsAt: FUTURE, currentPeriodEnd: null });
  await expectAllowed({ status: "PAST_DUE", trialEndsAt: null, currentPeriodEnd: FUTURE });
});

test("server guard: browser-supplied shop identity cannot bypass (resolved from membership only)", async () => {
  const calls = [];
  const supabase = createSupabaseMock({
    user: { id: "user-browser" },
    membership: { shopId: "shop-from-db", role: "STAFF" },
    subscription: { status: "EXPIRED", trialEndsAt: null, currentPeriodEnd: PAST },
    calls,
  });
  const result = await requireShopWriteAccess({}, { createClientFn: async () => supabase, now: NOW });
  assert.equal(result.ok, false);
  // membership queried by authenticated user, subscription queried by resolved shop only
  assert.ok(calls.some((c) => c.table === "shop_memberships" && c.op === "eq" && c.column === "userId" && c.value === "user-browser"));
  assert.ok(calls.some((c) => c.table === "subscriptions" && c.op === "eq" && c.column === "shopId" && c.value === "shop-from-db"));
  assert.equal(calls.some((c) => c.value === "shop-from-browser"), false);
});

test("server guard: resolves membership from server session, not from input parameter", async () => {
  // requireShopWriteAccess has no request/body/shopId parameter to trust.
  assert.equal(requireShopWriteAccess.length <= 2, true);
});

const protectedMutations = [
  "src/app/api/sales/route.ts",
  "src/app/api/stock/route.ts",
  "src/app/api/stock/products/route.ts",
  "src/app/api/clients/route.ts",
  "src/app/api/credit-payments/route.ts",
  "src/app/api/expenses/route.ts",
  "src/app/api/suppliers/route.ts",
  "src/app/api/shop-profile/route.ts",
];

test("protected routes: mutating handlers call subscription write guard before mutation/RPC", () => {
  for (const file of protectedMutations) {
    const src = fs.readFileSync(file, "utf8");
    assert.match(src, /requireShopWriteAccess/, `${file} must use requireShopWriteAccess`);
    const guardIndex = src.indexOf("requireShopWriteAccess(");
    assert.ok(guardIndex >= 0, `${file} must call requireShopWriteAccess`);
    const firstWrite = Math.min(
      ...[
        src.indexOf(".insert("),
        src.indexOf(".update("),
        src.indexOf(".delete("),
        src.indexOf('.rpc("create_shop_sale"'),
        src.indexOf('.rpc("apply_stock_movement"'),
        src.indexOf('.rpc("record_shop_credit_payment"'),
      ].filter((i) => i >= 0),
    );
    assert.ok(Number.isFinite(firstWrite), `${file} must contain a mutation/RPC`);
    assert.ok(guardIndex < firstWrite, `${file} must check subscription before first mutation/RPC`);
  }
});

test("protected routes: GET handlers remain read-only and are not gated by subscription write guard", () => {
  const routeFiles = protectedMutations.filter((f) => !f.endsWith("stock/products/route.ts"));
  for (const file of routeFiles) {
    const src = fs.readFileSync(file, "utf8");
    const getIndex = src.indexOf("export async function GET");
    assert.ok(getIndex >= 0, `${file} must export GET`);
    const postOrPatchIndex = Math.min(
      ...[
        src.indexOf("export async function POST"),
        src.indexOf("export async function PATCH"),
      ].filter((i) => i >= 0),
    );
    assert.ok(postOrPatchIndex > getIndex, `${file} should define GET before mutation handler`);
    const getSection = src.slice(getIndex, postOrPatchIndex);
    assert.doesNotMatch(getSection, /requireShopWriteAccess/, `${file} GET must remain usable without subscription write guard`);
  }
});

test("renewal and exception operations are preserved (not subscription-write gated as business mutations)", () => {
  const checkout = fs.readFileSync("src/app/api/subscriptions/checkout/route.ts", "utf8");
  const subscriptions = fs.readFileSync("src/app/api/subscriptions/route.ts", "utf8");
  const webhook = fs.readFileSync("src/app/api/webhooks/saspay/route.ts", "utf8");
  assert.doesNotMatch(checkout, /requireShopWriteAccess/, "checkout must remain accessible for renewal");
  assert.doesNotMatch(subscriptions, /requireShopWriteAccess/, "subscriptions read route unchanged");
  assert.doesNotMatch(webhook, /requireShopWriteAccess/, "webhook must remain technical exception");
});

test("production helper enforces strict server-only boundary (static import, no silent dynamic catch)", () => {
  assert.match(productionServerSource, /^import "server-only";/m, "production helper must keep static server-only import");
  assert.doesNotMatch(productionServerSource, /import\(["']server-only["']\)\.catch/, "production helper must not silently ignore server-only import failure");
});
