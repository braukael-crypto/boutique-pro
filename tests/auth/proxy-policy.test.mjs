import assert from "node:assert/strict";
import test from "node:test";
import {
  getUnauthenticatedRedirectPath,
  isProxyAuthExempt,
} from "../../src/lib/supabase/proxy-policy.ts";

test("the exact SasPay webhook path bypasses proxy auth without a session", () => {
  const pathname = "/api/webhooks/saspay";

  assert.equal(isProxyAuthExempt(pathname), true);
  assert.equal(getUnauthenticatedRedirectPath(pathname), null);
  assert.equal(isProxyAuthExempt(`${pathname}/extra`), false);
});

test("other private routes still redirect unauthenticated requests to login", () => {
  for (const pathname of ["/api/subscriptions", "/boutique"]) {
    assert.equal(getUnauthenticatedRedirectPath(pathname), "/connexion");
  }

  assert.equal(
    getUnauthenticatedRedirectPath("/super-admin"),
    "/admin-connexion",
  );
});
