import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeSlug(value: unknown) {
  if (typeof value !== "string") return "";
  return value.toLowerCase().trim().slice(0, 80);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/connexion?erreur=Le lien de confirmation est invalide ou expiré.", request.url));
    }
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.redirect(new URL("/connexion?erreur=Veuillez vous connecter.", request.url));
  }

  // Évite de créer une deuxième boutique si le lien de confirmation est réutilisé.
  const { data: memberships, error: membershipError } = await supabase
    .from("shop_memberships")
    .select("shopId")
    .eq("userId", user.id)
    .limit(1);

  if (membershipError) {
    return NextResponse.redirect(new URL("/connexion?erreur=Impossible de vérifier votre boutique. Contactez le support.", request.url));
  }

  if (!memberships?.length) {
    const shopName = typeof user.user_metadata?.shop_name === "string"
      ? user.user_metadata.shop_name.trim()
      : "";
    const shopSlug = safeSlug(user.user_metadata?.shop_slug);

    if (!shopName || !shopSlug) {
      return NextResponse.redirect(new URL("/inscription?erreur=Les informations de votre boutique sont manquantes.", request.url));
    }

    const { error: createError } = await supabase.rpc("create_shop_for_current_user", {
      p_name: shopName,
      p_slug: shopSlug,
    });

    if (createError) {
      return NextResponse.redirect(new URL("/inscription?erreur=Ce nom de boutique est peut-être déjà utilisé. Réessayez avec un autre nom.", request.url));
    }
  }

  return NextResponse.redirect(new URL("/", request.url));
}
