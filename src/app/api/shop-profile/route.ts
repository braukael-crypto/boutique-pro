import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getShopContext() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { supabase, shopId: null, role: null, error: "Authentification requise." };

  const { data: membership, error } = await supabase
    .from("shop_memberships")
    .select("shopId, role")
    .eq("userId", user.id)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !membership?.shopId) {
    return { supabase, shopId: null, role: null, error: "Aucune boutique autorisée n'a été trouvée." };
  }
  return { supabase, shopId: membership.shopId as string, role: membership.role as string, error: null };
}

function toProfile(shop: Record<string, unknown>) {
  return {
    id: "profile" as const,
    name: String(shop.name ?? ""),
    phone: String(shop.phone ?? ""),
    whatsapp: String(shop.whatsapp ?? ""),
    address: String(shop.address ?? ""),
    logo: typeof shop.logoUrl === "string" && shop.logoUrl ? shop.logoUrl : undefined,
  };
}

export async function GET() {
  const auth = await getShopContext();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);

  const { data, error } = await auth.supabase
    .from("shops")
    .select("id, name, phone, whatsapp, address, logoUrl")
    .eq("id", auth.shopId)
    .single();

  if (error || !data) {
    console.error("[shop-profile] read failed:", error);
    return jsonError("Impossible de charger les paramètres de la boutique.", 500);
  }
  return NextResponse.json({ profile: toProfile(data) });
}

export async function PATCH(request: NextRequest) {
  const auth = await getShopContext();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);
  if (auth.role !== "OWNER" && auth.role !== "MANAGER") {
    return jsonError("Seul le propriétaire ou un responsable peut modifier ces paramètres.", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Corps de requête invalide.", 400); }
  if (!body || typeof body !== "object") return jsonError("Paramètres invalides.", 400);

  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const whatsapp = typeof input.whatsapp === "string" ? input.whatsapp.trim() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const logo = input.logo;

  if (!name || name.length < 2 || name.length > 100 ||
      phone.length > 30 || whatsapp.length > 30 || address.length > 180 ||
      (logo !== undefined && logo !== null &&
        (typeof logo !== "string" || logo.length > 1_500_000 || !logo.startsWith("data:image/")))) {
    return jsonError("Vérifiez le nom, les coordonnées et le logo de la boutique.", 400);
  }

  const updates = {
    name,
    phone: phone || null,
    whatsapp: whatsapp || null,
    address: address || null,
    logoUrl: typeof logo === "string" && logo ? logo : null,
    updatedAt: new Date().toISOString(),
  };

  const { data, error } = await auth.supabase
    .from("shops")
    .update(updates)
    .eq("id", auth.shopId)
    .select("id, name, phone, whatsapp, address, logoUrl")
    .single();

  if (error || !data) {
    console.error("[shop-profile] save failed:", error);
    return jsonError("Impossible d'enregistrer les paramètres dans la boutique.", 500);
  }
  return NextResponse.json({ profile: toProfile(data) });
}
