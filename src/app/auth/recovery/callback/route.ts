import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/connexion?erreur=Le lien de récupération est invalide ou expiré.", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[BoutiquePro password recovery callback] Code exchange failed", {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    return NextResponse.redirect(new URL("/connexion?erreur=Le lien de récupération est invalide ou expiré. Demandez un nouveau lien.", request.url));
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.redirect(new URL("/connexion?erreur=La session de récupération n'a pas pu être confirmée.", request.url));
  }

  // This dedicated endpoint is only used by password recovery emails.
  // Do not run the normal signup/application callback logic here.
  return NextResponse.redirect(new URL("/reinitialiser-mot-de-passe", request.url));
}
