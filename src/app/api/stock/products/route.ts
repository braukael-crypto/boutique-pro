import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedShop();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corps de requête invalide.", 400);
  }

  if (!body || typeof body !== "object") return jsonError("Produit invalide.", 400);
  const input = body as Record<string, unknown>;
  const legacyId = input.legacyId;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "Autres";
  const purchasePrice = input.purchasePrice;
  const sellingPrice = input.sellingPrice;
  const quantity = input.quantity;
  const minStock = input.minStock;

  if (
    typeof legacyId !== "number" || !Number.isSafeInteger(legacyId) || legacyId <= 0 ||
    !name || name.length > 200 ||
    !Number.isFinite(purchasePrice) || Number(purchasePrice) < 0 ||
    !Number.isFinite(sellingPrice) || Number(sellingPrice) <= 0 ||
    !Number.isSafeInteger(quantity) || Number(quantity) < 0 ||
    !Number.isSafeInteger(minStock) || Number(minStock) < 0
  ) {
    return jsonError("Vérifiez le nom, les prix et les quantités du produit.", 400);
  }

  const { data: existing, error: lookupError } = await auth.supabase
    .from("products")
    .select('id, quantity')
    .eq("shopId", auth.shopId)
    .eq("legacyId", legacyId)
    .maybeSingle();

  if (lookupError) return jsonError("Impossible de vérifier le produit.", 500);

  const productPayload = {
    name,
    category: category || "Autres",
    purchasePrice: Number(purchasePrice),
    sellingPrice: Number(sellingPrice),
    minStock: Number(minStock),
  };

  const productQuery = existing
    ? auth.supabase
        .from("products")
        .update(productPayload)
        .eq("shopId", auth.shopId)
        .eq("id", existing.id)
    : auth.supabase
        .from("products")
        .insert({
          ...productPayload,
          shopId: auth.shopId,
          legacyId,
          quantity: 0,
        });

  const { data: saved, error: saveError } = await productQuery
    .select("id, quantity, legacyId")
    .single();

  if (saveError || !saved) {
    return jsonError("Impossible d'enregistrer le produit dans Supabase.", 500);
  }

  const currentQuantity = Number(saved.quantity);
  const requestedQuantity = Number(quantity);
  const delta = requestedQuantity - currentQuantity;

  if (delta !== 0) {
    const movementLegacyId = Date.now();
    const { error: movementError } = await auth.supabase.rpc("apply_stock_movement", {
      p_shop_id: auth.shopId,
      p_product_id: saved.id,
      p_legacy_id: movementLegacyId,
      p_type: delta > 0 ? "IN" : "OUT",
      p_quantity: Math.abs(delta),
      p_reason: existing ? "Ajustement depuis la fiche produit" : "Stock initial",
    });

    if (movementError) {
      return jsonError(
        movementError.message === "Insufficient stock"
          ? "Impossible de diminuer le stock en dessous de zéro."
          : "Le produit est enregistré, mais son ajustement de stock a échoué. Rechargez les données avant toute nouvelle modification.",
        409
      );
    }
  }

  return NextResponse.json({ productId: saved.id, quantity: requestedQuantity }, { status: 200 });
}
