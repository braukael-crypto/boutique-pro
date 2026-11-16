import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireShopWriteAccess, subscriptionWriteDeniedResponse } from "@/lib/subscriptions/server";


function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getAuthorizedShop() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, shopId: null, error: "Authentification requise." };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("shop_memberships")
    .select("shopId")
    .eq("userId", user.id)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.shopId) {
    return {
      supabase,
      shopId: null,
      error: "Aucune boutique autorisée n'a été trouvée.",
    };
  }

  return { supabase, shopId: membership.shopId as string, error: null };
}

export async function GET() {
  const auth = await getAuthorizedShop();

  if (auth.error || !auth.shopId) {
    return jsonError(auth.error || "Accès refusé.", 401);
  }

  const [productsResult, movementsResult] = await Promise.all([
    auth.supabase
      .from("products")
      .select('id, "legacyId", name, category, "purchasePrice", "sellingPrice", quantity, "minStock"')
      .eq("shopId", auth.shopId)
      .is("archivedAt", null)
      .order("name", { ascending: true }),
    auth.supabase
      .from("stock_movements")
      .select('id, "legacyId", "productId", "productName", type, quantity, reason, date, "stockBefore", "stockAfter"')
      .eq("shopId", auth.shopId)
      .order("date", { ascending: false })
      .limit(500),
  ]);

  if (productsResult.error || movementsResult.error) {
    return jsonError("Impossible de charger les données du stock.", 500);
  }

  return NextResponse.json({
    products: productsResult.data ?? [],
    movements: movementsResult.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireShopWriteAccess({ membershipMissingStatus: 401 });
  if (!auth.ok) return subscriptionWriteDeniedResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corps de requête invalide.", 400);
  }

  if (!body || typeof body !== "object") {
    return jsonError("Données de mouvement invalides.", 400);
  }

  const input = body as Record<string, unknown>;
  const productId = input.productId;
  const legacyId = input.legacyId;
  const type = input.type;
  const quantity = input.quantity;
  const reason = input.reason;

  if (
    typeof productId !== "string" ||
    typeof legacyId !== "number" ||
    !Number.isSafeInteger(legacyId) ||
    !["IN", "OUT"].includes(String(type)) ||
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    typeof reason !== "string" ||
    !reason.trim()
  ) {
    return jsonError("Vérifiez le produit, l'identifiant, le type, la quantité et le motif.", 400);
  }

  const { data, error } = await auth.supabase.rpc("apply_stock_movement", {
    p_shop_id: auth.shopId,
    p_product_id: productId,
    p_legacy_id: legacyId,
    p_type: type,
    p_quantity: quantity,
    p_reason: reason.trim(),
  });

  if (error) {
    const status = error.code === "23505" ? 409
      : error.code === "42501" ? 403
      : error.code === "P0002" ? 404
      : error.code === "22023" ? 400
      : 500;

    return jsonError(
      error.message === "Insufficient stock"
        ? "Stock insuffisant pour cette sortie."
        : error.message === "Duplicate stock movement identifier"
          ? "Ce mouvement a déjà été enregistré."
          : "Impossible d'enregistrer le mouvement.",
      status
    );
  }

  return NextResponse.json({ movementId: data }, { status: 201 });
}
