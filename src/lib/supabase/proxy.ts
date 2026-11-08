import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    if (process.env.NODE_ENV === "production") return new NextResponse("Configuration Supabase manquante.", { status: 500 });
    return response;
  }
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll: ((cookiesToSet: Parameters<SetAllCookies>[0]) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }) as SetAllCookies,
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const pathname = request.nextUrl.pathname;
  const isPasswordRecoveryRoute = pathname === "/mot-de-passe-oublie" || pathname === "/reinitialiser-mot-de-passe";
  const isPublicRoute = pathname === "/" || pathname === "/connexion" || pathname === "/inscription" ||
    pathname === "/inscription/verification" || pathname.startsWith("/auth/") || isPasswordRecoveryRoute;
  if (error || !claims) {
    if (!isPublicRoute) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/connexion";
      destination.searchParams.set("next", pathname);
      return NextResponse.redirect(destination);
    }
    return response;
  }

  // Password recovery must remain accessible regardless of the current session or shop membership.
  if (isPasswordRecoveryRoute) return response;

  // Verify the authenticated user before applying shop-membership restrictions.
  const { data: { user } } = await supabase.auth.getUser();
  const superAdmin = isSuperAdmin(user);

  if (pathname === "/connexion" || pathname === "/inscription") {
    const destination = request.nextUrl.clone();

    if (superAdmin) {
      destination.pathname = "/super-admin";
    } else {
      const { data: membership } = await supabase
        .from("shop_memberships")
        .select("shopId")
        .limit(1)
        .maybeSingle();

      destination.pathname = membership?.shopId ? "/boutique" : "/demande-suivi";
    }

    destination.search = "";
    return NextResponse.redirect(destination);
  }

  // Public pages and Supabase authentication callbacks remain accessible.
  if (
    pathname === "/" ||
    pathname === "/inscription/verification" ||
    pathname.startsWith("/auth/")
  ) return response;

  // Keep the Super Admin in the private administration area, not the client area.
  if (superAdmin && pathname !== "/super-admin" && !pathname.startsWith("/super-admin/")) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/super-admin";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  // The administration layout performs its own authorization check.
  if (pathname === "/super-admin" || pathname.startsWith("/super-admin/")) return response;

  // Authenticated applicants may only view their application status until a shop membership is granted.
  if (pathname !== "/demande-suivi" && !pathname.startsWith("/demande-suivi/")) {
    const { data: membership, error: membershipError } = await supabase
      .from("shop_memberships").select("shopId").limit(1).maybeSingle();
    if (membershipError || !membership?.shopId) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/demande-suivi";
      destination.search = "";
      return NextResponse.redirect(destination);
    }
  }
  return response;
}
