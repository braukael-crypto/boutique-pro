import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getAuthorizedShop() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, shopId: null, error: "Authentification requise." };
  }

  const { data: membership, error } = await supabase
    .from("shop_memberships")
    .select("shopId")
    .eq("userId", user.id)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !membership?.shopId) {
    return { supabase, shopId: null, error: "Aucune boutique autorisée n'a été trouvée." };
  }

  return { supabase, shopId: membership.shopId as string, error: null };
}

export async function GET() {
  const auth = await getAuthorizedShop();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);

  const { data, error } = await auth.supabase
    .from("customers")
    .select('id, "legacyId", name, phone, address, "createdAt"')
    .eq("shopId", auth.shopId)
    .order("name", { ascending: true });

  if (error) return jsonError("Impossible de charger les clients depuis Supabase.", 500);

  return NextResponse.json({ customers: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedShop();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corps de requête invalide.", 400);
  }

  if (!body || typeof body !== "object") return jsonError("Données du client invalides.", 400);
  const input = body as Record<string, unknown>;
  const legacyId = input.legacyId;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";

  if (
    typeof legacyId !== "number" ||
    !Number.isSafeInteger(legacyId) ||
    legacyId <= 0 ||
    !name ||
    name.length > 200 ||
    !phone ||
    phone.length > 40 ||
    address.length > 300
  ) {
    return jsonError("Le nom, le téléphone et un identifiant client valide sont obligatoires.", 400);
  }

  const { data: existing, error: lookupError } = await auth.supabase
    .from("customers")
    .select("id")
    .eq("shopId", auth.shopId)
    .eq("legacyId", legacyId)
    .maybeSingle();

  if (lookupError) return jsonError("Impossible de vérifier le client.", 500);

  const payload = { name, phone, address: address || null };
  const query = existing
    ? auth.supabase.from("customers").update(payload).eq("shopId", auth.shopId).eq("id", existing.id)
    : auth.supabase.from("customers").insert({ ...payload, shopId: auth.shopId, legacyId });

  const { data, error } = await query
    .select('id, "legacyId", name, phone, address, "createdAt"')
    .single();

  if (error || !data) return jsonError("Impossible d'enregistrer le client dans Supabase.", 500);

  return NextResponse.json({ customer: data }, { status: existing ? 200 : 201 });
}
