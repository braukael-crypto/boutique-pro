const SASPAY_WEBHOOK_PATH = "/api/webhooks/saspay";

export function isProxyAuthExempt(pathname: string) {
  return pathname === SASPAY_WEBHOOK_PATH;
}

export function isPasswordRecoveryRoute(pathname: string) {
  return (
    pathname === "/mot-de-passe-oublie" ||
    pathname === "/reinitialiser-mot-de-passe"
  );
}

export function getUnauthenticatedRedirectPath(pathname: string) {
  const isPublicRoute =
    pathname === "/" ||
    pathname === "/connexion" ||
    pathname === "/admin-connexion" ||
    pathname === "/inscription" ||
    pathname === "/inscription/verification" ||
    pathname.startsWith("/auth/") ||
    isPasswordRecoveryRoute(pathname);

  if (isProxyAuthExempt(pathname) || isPublicRoute) return null;

  return pathname.startsWith("/super-admin")
    ? "/admin-connexion"
    : "/connexion";
}
