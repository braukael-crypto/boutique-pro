import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // L'application peut être compilée avant que les clés locales soient installées.
  // En production, ces variables sont obligatoires.
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
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { claims }, error } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const isPublicRoute =
    pathname === "/connexion" ||
    pathname === "/inscription" ||
    pathname.startsWith("/auth/");

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
    const destination = request.nextUrl.clone();
    destination.pathname = "/";
    destination.search = "";
    return NextResponse.redirect(destination);
  }

  return response;
}
