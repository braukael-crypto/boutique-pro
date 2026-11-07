import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getAuthorizedShop() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { supabase, shopId: null, error: "Authentification requise." };
  const { data: membership, error } = await supabase.from("shop_memberships")
    .select("shopId").eq("userId", user.id).order("createdAt", { ascending: true }).limit(1).maybeSingle();
  if (error || !membership?.shopId) return { supabase, shopId: null, error: "Aucune boutique autorisée n'a été trouvée." };
  return { supabase, shopId: membership.shopId as string, error: null };
}

function parseSupplier(input: Record<string, unknown>) {
  const legacyId = input.legacyId;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (typeof legacyId !== "number" || !Number.isSafeInteger(legacyId) || legacyId <= 0 || !name || name.length > 200 || phone.length > 40 || email.length > 200 || address.length > 300 || notes.length > 2000) return null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { legacyId, name, phone: phone || null, email: email || null, address: address || null, notes: notes || null };
}

export async function GET() {
  const auth = await getAuthorizedShop();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);
  const { data, error } = await auth.supabase.from("suppliers")
    .select("id,legacyId,name,phone,email,address,notes,createdAt,updatedAt")
    .eq("shopId", auth.shopId).order("name", { ascending: true });
  if (error) return jsonError("Impossible de charger les fournisseurs depuis Supabase.", 500);
  return NextResponse.json({ suppliers: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedShop();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Corps de requête invalide.", 400); }
  if (!body || typeof body !== "object") return jsonError("Données du fournisseur invalides.", 400);
  const parsed = parseSupplier(body as Record<string, unknown>);
  if (!parsed) return jsonError("Vérifiez le nom, les coordonnées et l'identifiant du fournisseur.", 400);
  const { data: existing, error: lookupError } = await auth.supabase.from("suppliers").select("id")
    .eq("shopId", auth.shopId).eq("legacyId", parsed.legacyId).maybeSingle();
  if (lookupError) return jsonError("Impossible de vérifier le fournisseur existant.", 500);
  const payload = { ...parsed, updatedAt: new Date().toISOString() };
  const query = existing
    ? auth.supabase.from("suppliers").update(payload).eq("shopId", auth.shopId).eq("id", existing.id)
    : auth.supabase.from("suppliers").insert({ id: randomUUID(), ...payload, shopId: auth.shopId });
  const { data, error } = await query.select("id,legacyId,name,phone,email,address,notes,createdAt,updatedAt").single();
  if (error || !data) return jsonError("Impossible d'enregistrer le fournisseur dans Supabase.", 500);
  return NextResponse.json({ supplier: data }, { status: existing ? 200 : 201 });
}
