import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
  const isPublicRoute = pathname === "/" || pathname === "/connexion" || pathname === "/inscription" ||
    pathname === "/inscription/verification" || pathname.startsWith("/auth/");
  if (error || !claims) {
    if (!isPublicRoute) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/connexion";
      destination.searchParams.set("next", pathname);
      return NextResponse.redirect(destination);
    }
    return response;
  }

  if (pathname === "/connexion" || pathname === "/inscription") {
    const { data: membership } = await supabase.from("shop_memberships").select("shopId").limit(1).maybeSingle();
    const destination = request.nextUrl.clone();
    destination.pathname = membership?.shopId ? "/boutique" : "/demande-suivi";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  // Public pages remain accessible to authenticated applicants as well.
  // In particular, the public homepage must not be trapped behind the pending-application gate.
  if (pathname === "/" || pathname === "/inscription/verification") return response;

  // Existing Super Admins are not shop members; keep their separate console accessible.
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
