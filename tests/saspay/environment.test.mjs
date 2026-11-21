import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSasPayConfiguration,
  getSasPayKeyMode,
  resolveSasPayRuntimeEnvironment,
  SasPayConfigurationError,
} from "../../src/lib/saspay-environment.ts";
import {
  createCheckoutSession,
  getSasPaySecretKey,
  SasPayConfigurationError as ClientConfigurationError,
} from "../../src/lib/saspay.ts";

const TEST_KEY = "sk_test_unit_fake_000000000000";
const LIVE_KEY = "sk_live_unit_fake_000000000000";
const INVALID_KEY = "sk_sandbox_unit_fake_000000000";

const MANAGED_ENV_KEYS = [
  "VERCEL_ENV",
  "NODE_ENV",
  "SASPAY_SECRET_KEY",
  "NEXT_PUBLIC_VERCEL_ENV",
  "NEXT_PUBLIC_SASPAY_SECRET_KEY",
  "NEXT_PUBLIC_SASPAY_MODE",
];

function setProcessEnv(variables) {
  const saved = new Map(MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of MANAGED_ENV_KEYS) {
    const value = variables[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function expectConfigError(code) {
  return (error) => {
    assert.ok(error instanceof SasPayConfigurationError);
    assert.equal(error.code, code);
    return true;
  };
}

test("runtime environment comes from the server-only Vercel system variable", () => {
  assert.equal(resolveSasPayRuntimeEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" }), "preview");
  assert.equal(resolveSasPayRuntimeEnvironment({ VERCEL_ENV: "production", NODE_ENV: "development" }), "production");
  assert.equal(resolveSasPayRuntimeEnvironment({ VERCEL_ENV: "development" }), "development");
  assert.equal(resolveSasPayRuntimeEnvironment({ NODE_ENV: "production" }), "production");
  assert.equal(resolveSasPayRuntimeEnvironment({ NODE_ENV: "test" }), "development");
  assert.equal(resolveSasPayRuntimeEnvironment({}), "unknown");
  assert.equal(resolveSasPayRuntimeEnvironment({ VERCEL_ENV: "staging", NODE_ENV: "production" }), "unknown");
});

test("key mode parsing accepts only complete sandbox or live prefixes", () => {
  assert.equal(getSasPayKeyMode(TEST_KEY), "test");
  assert.equal(getSasPayKeyMode(LIVE_KEY), "live");
  assert.equal(getSasPayKeyMode(INVALID_KEY), "invalid");
  assert.equal(getSasPayKeyMode("sk_test_"), "invalid");
  assert.equal(getSasPayKeyMode("sk_live_"), "invalid");
  assert.equal(getSasPayKeyMode(undefined), "invalid");
});

test("preview accepts a sandbox key", () => {
  const config = assertSasPayConfiguration({ VERCEL_ENV: "preview", SASPAY_SECRET_KEY: TEST_KEY });
  assert.equal(config.environment, "preview");
  assert.equal(config.keyMode, "test");
  assert.equal(config.secretKey, TEST_KEY);
});

test("preview rejects a live key", () => {
  assert.throws(
    () => assertSasPayConfiguration({ VERCEL_ENV: "preview", SASPAY_SECRET_KEY: LIVE_KEY }),
    expectConfigError("SASPAY_CONFIG_MODE_MISMATCH"),
  );
});

test("preview rejects a missing key", () => {
  assert.throws(
    () => assertSasPayConfiguration({ VERCEL_ENV: "preview" }),
    expectConfigError("SASPAY_CONFIG_MISSING_KEY"),
  );
});

test("production accepts a live key", () => {
  const config = assertSasPayConfiguration({ VERCEL_ENV: "production", SASPAY_SECRET_KEY: LIVE_KEY });
  assert.equal(config.environment, "production");
  assert.equal(config.keyMode, "live");
  assert.equal(config.secretKey, LIVE_KEY);
});

test("production rejects a sandbox key", () => {
  assert.throws(
    () => assertSasPayConfiguration({ VERCEL_ENV: "production", SASPAY_SECRET_KEY: TEST_KEY }),
    expectConfigError("SASPAY_CONFIG_MODE_MISMATCH"),
  );
});

test("production rejects a missing key", () => {
  assert.throws(
    () => assertSasPayConfiguration({ VERCEL_ENV: "production" }),
    expectConfigError("SASPAY_CONFIG_MISSING_KEY"),
  );
});

test("local development keeps a safe sandbox-only configuration", () => {
  const config = assertSasPayConfiguration({ NODE_ENV: "development", SASPAY_SECRET_KEY: TEST_KEY });
  assert.equal(config.environment, "development");
  assert.equal(config.keyMode, "test");
  assert.throws(
    () => assertSasPayConfiguration({ NODE_ENV: "development", SASPAY_SECRET_KEY: LIVE_KEY }),
    expectConfigError("SASPAY_CONFIG_MODE_MISMATCH"),
  );
});

test("an invalid key is rejected in every known environment", () => {
  for (const environment of ["preview", "production", "development"]) {
    const env = { [environment === "development" ? "NODE_ENV" : "VERCEL_ENV"]: environment, SASPAY_SECRET_KEY: INVALID_KEY };
    assert.throws(() => assertSasPayConfiguration(env), expectConfigError("SASPAY_CONFIG_INVALID_KEY"));
  }
});

test("browser-controllable variables cannot change the payment mode", () => {
  const preview = assertSasPayConfiguration({
    VERCEL_ENV: "preview",
    SASPAY_SECRET_KEY: TEST_KEY,
    NEXT_PUBLIC_VERCEL_ENV: "production",
    NEXT_PUBLIC_SASPAY_SECRET_KEY: LIVE_KEY,
    NEXT_PUBLIC_SASPAY_MODE: "live",
  });
  assert.equal(preview.keyMode, "test");

  const production = assertSasPayConfiguration({
    VERCEL_ENV: "production",
    SASPAY_SECRET_KEY: LIVE_KEY,
    NEXT_PUBLIC_VERCEL_ENV: "preview",
    NEXT_PUBLIC_SASPAY_SECRET_KEY: TEST_KEY,
    NEXT_PUBLIC_SASPAY_MODE: "test",
  });
  assert.equal(production.keyMode, "live");
});

test("configuration errors never disclose key material", () => {
  const failures = [
    { VERCEL_ENV: "preview", SASPAY_SECRET_KEY: LIVE_KEY },
    { VERCEL_ENV: "production", SASPAY_SECRET_KEY: TEST_KEY },
    { VERCEL_ENV: "preview", SASPAY_SECRET_KEY: INVALID_KEY },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: "unrecognized", SASPAY_SECRET_KEY: LIVE_KEY },
  ];

  for (const env of failures) {
    assert.throws(
      () => assertSasPayConfiguration(env),
      (error) => {
        const serialized = `${error.message}|${String(error)}|${error.stack}|${JSON.stringify(error)}`;
        for (const candidate of [TEST_KEY, LIVE_KEY, INVALID_KEY]) {
          assert.equal(serialized.includes(candidate), false);
        }
        assert.equal(Object.prototype.hasOwnProperty.call(error, "details"), false);
        assert.equal(Object.prototype.hasOwnProperty.call(error, "response"), false);
        return true;
      },
    );
  }
});

test("an unknown environment performs no API call with any key", async () => {
  const restore = setProcessEnv({ VERCEL_ENV: "unrecognized", NODE_ENV: undefined, SASPAY_SECRET_KEY: LIVE_KEY });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called");
  };

  try {
    for (const key of [TEST_KEY, LIVE_KEY, INVALID_KEY, undefined]) {
      const env = { VERCEL_ENV: "unrecognized", ...(key === undefined ? {} : { SASPAY_SECRET_KEY: key }) };
      assert.throws(() => assertSasPayConfiguration(env), expectConfigError("SASPAY_CONFIG_UNKNOWN_ENVIRONMENT"));
    }
    assert.throws(() => getSasPaySecretKey(), expectConfigError("SASPAY_CONFIG_UNKNOWN_ENVIRONMENT"));
    await assert.rejects(
      () => createCheckoutSession({
        amount: 1000,
        currency: "XOF",
        customerEmail: "unit@example.test",
        customerName: "Unit",
      }),
      (error) => error instanceof SasPayConfigurationError,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a live key in preview is rejected before any API call", async () => {
  const restore = setProcessEnv({ VERCEL_ENV: "preview", NODE_ENV: undefined, SASPAY_SECRET_KEY: LIVE_KEY });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called");
  };

  try {
    await assert.rejects(
      () => createCheckoutSession({
        amount: 1000,
        currency: "XOF",
        customerEmail: "unit@example.test",
        customerName: "Unit",
      }),
      (error) => error instanceof ClientConfigurationError && error.code === "SASPAY_CONFIG_MODE_MISMATCH",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a validated sandbox configuration is used for the API request", async () => {
  const restore = setProcessEnv({ VERCEL_ENV: "preview", NODE_ENV: undefined, SASPAY_SECRET_KEY: TEST_KEY });
  const originalFetch = globalThis.fetch;
  let requestUrl = null;
  let authorization = null;
  globalThis.fetch = async (url, init) => {
    requestUrl = url;
    authorization = init?.headers?.Authorization ?? null;
    return new Response(
      JSON.stringify({
        success: true,
        data: { id: "cs_unit_1", checkout_url: "https://pay.saspay.me/checkout/cs_unit_1", status: "PENDING" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const session = await createCheckoutSession({
      amount: 1000,
      currency: "XOF",
      customerEmail: "unit@example.test",
      customerName: "Unit",
    });
    assert.equal(session.id, "cs_unit_1");
    assert.equal(requestUrl, "https://api.saspay.me/api/v1/checkout-sessions/");
    assert.equal(authorization, `Bearer ${TEST_KEY}`);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
