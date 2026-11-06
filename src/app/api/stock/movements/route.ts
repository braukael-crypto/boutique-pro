import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type MovementInput = {
  shopId?: unknown;
  productId?: unknown;
  legacyId?: unknown;
  type?: unknown;
  quantity?: unknown;
  reason?: unknown;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  let body: MovementInput;
  try {
    body = (await request.json()) as MovementInput;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const shopId = typeof body.shopId === "string" ? body.shopId : "";
  const productId = typeof body.productId === "string" ? body.productId : "";
  const type = body.type;
  const quantity = body.quantity;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!shopId || !productId) {
    return NextResponse.json({ error: "Boutique et produit obligatoires." }, { status: 400 });
  }

  if (type !== "IN" && type !== "OUT") {
    return NextResponse.json({ error: "Type de mouvement invalide." }, { status: 400 });
  }

  if (!Number.isSafeInteger(quantity) || Number(quantity) <= 0) {
    return NextResponse.json({ error: "La quantité doit être un entier positif." }, { status: 400 });
  }

  if (!reason || reason.length > 500) {
    return NextResponse.json({ error: "Le motif est obligatoire (500 caractères maximum)." }, { status: 400 });
  }

  let legacyId: number | null = null;
  if (body.legacyId !== undefined && body.legacyId !== null) {
    if (!Number.isSafeInteger(body.legacyId) || Number(body.legacyId) <= 0) {
      return NextResponse.json({ error: "Identifiant de mouvement invalide." }, { status: 400 });
    }
    legacyId = Number(body.legacyId);
  }

  const { data, error } = await supabase.rpc("apply_stock_movement", {
    p_shop_id: shopId,
    p_product_id: productId,
    p_legacy_id: legacyId,
    p_type: type,
    p_quantity: Number(quantity),
    p_reason: reason,
  });

  if (error) {
    const message = error.message || "Impossible d'enregistrer le mouvement.";
    const status =
      error.code === "42501" ? 403 :
      error.code === "P0002" ? 404 :
      error.code === "23505" ? 409 :
      error.code === "22023" ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ movementId: data }, { status: 201 });
}
