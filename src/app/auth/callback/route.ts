import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/connexion?erreur=Le lien de confirmation est invalide ou expiré.", request.url));
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.redirect(new URL("/connexion?erreur=Veuillez vous connecter.", request.url));

  const { data: memberships, error: membershipError } = await supabase.from("shop_memberships").select("shopId").eq("userId", user.id).limit(1);
  if (membershipError) return NextResponse.redirect(new URL("/connexion?erreur=Impossible de vérifier votre accès. Contactez le support.", request.url));
  if (memberships?.length) return NextResponse.redirect(new URL("/boutique", request.url));

  const metadata = user.user_metadata ?? {};
  const shopName = typeof metadata.shop_name === "string" ? metadata.shop_name.trim() : "";
  const contactName = typeof metadata.contact_name === "string" ? metadata.contact_name.trim() : "";
  const phone = typeof metadata.phone === "string" ? metadata.phone.trim() : "";
  const address = typeof metadata.address === "string" ? metadata.address.trim() : "";
  const plan = typeof metadata.plan === "string" ? metadata.plan : "";
  if (shopName.length < 2 || contactName.length < 2 || phone.length < 6 || !["ESSENTIAL","STANDARD","PREMIUM","ENTERPRISE"].includes(plan)) {
    return NextResponse.redirect(new URL("/inscription?erreur=Les informations de votre demande sont incomplètes.", request.url));
  }
  const { error: applicationError } = await supabase.from("shop_applications").upsert({
    userId: user.id, shopName, contactName, phone, email: user.email ?? "", address: address || null, plan, updatedAt: new Date().toISOString(),
  }, { onConflict: "userId" });
  if (applicationError) {
    console.error("[shop-application] create failed:", applicationError);
    return NextResponse.redirect(new URL("/inscription?erreur=Votre compte est confirmé, mais la demande n'a pas pu être enregistrée. Contactez le support.", request.url));
  }
  return NextResponse.redirect(new URL("/demande-suivi", request.url));
}
