import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import {
  getUnauthenticatedRedirectPath,
  isPasswordRecoveryRoute,
  isProxyAuthExempt,
} from "@/lib/supabase/proxy-policy";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  if (isProxyAuthExempt(pathname)) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Configuration Supabase manquante.", { status: 500 });
    }
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll: ((cookiesToSet: Parameters<SetAllCookies>[0]) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      }) as SetAllCookies,
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims) {
    const redirectPath = getUnauthenticatedRedirectPath(pathname);
    if (redirectPath) {
      const destination = request.nextUrl.clone();
      destination.pathname = redirectPath;
      destination.search = "";
      return NextResponse.redirect(destination);
    }
    return response;
  }

  if (isPasswordRecoveryRoute(pathname)) return response;

  const { data: { user } } = await supabase.auth.getUser();
  const superAdmin = isSuperAdmin(user);

  // Connexion réservée à l'administration.
  if (pathname === "/admin-connexion") {
    if (superAdmin) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/super-admin";
      destination.search = "";
      return NextResponse.redirect(destination);
    }
    return response;
  }

  // Connexion et inscription réservées aux clients des boutiques.
  if (pathname === "/connexion" || pathname === "/inscription") {
    if (superAdmin) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/super-admin";
      destination.search = "";
      return NextResponse.redirect(destination);
    }

    const { data: membership } = await supabase
      .from("shop_memberships")
      .select("shopId")
      .eq("userId", user?.id ?? "")
      .limit(1)
      .maybeSingle();

    const destination = request.nextUrl.clone();
    destination.pathname = membership?.shopId
      ? "/boutique"
      : "/demande-suivi";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  // Pages publiques et callbacks Supabase.
  if (
    pathname === "/" ||
    pathname === "/inscription/verification" ||
    pathname.startsWith("/auth/")
  ) {
    return response;
  }

  // Le Super Admin reste dans son espace privé.
  if (superAdmin) {
    if (pathname === "/super-admin" || pathname.startsWith("/super-admin/")) {
      return response;
    }

    const destination = request.nextUrl.clone();
    destination.pathname = "/super-admin";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  // L'administration générale reste inaccessible aux comptes clients.
  if (pathname === "/super-admin" || pathname.startsWith("/super-admin/")) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/admin-connexion";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  // Vérification de l'appartenance à une boutique.
  const { data: membership, error: membershipError } = await supabase
    .from("shop_memberships")
    .select("shopId")
    .eq("userId", user?.id ?? "")
    .limit(1)
    .maybeSingle();

  if (
    membershipError ||
    !membership?.shopId
  ) {
    if (pathname !== "/demande-suivi" && !pathname.startsWith("/demande-suivi/")) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/demande-suivi";
      destination.search = "";
      return NextResponse.redirect(destination);
    }
  }

  return response;
}
