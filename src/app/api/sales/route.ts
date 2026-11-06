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

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedShop();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Corps de requête invalide.", 400);
  }
  if (!body || typeof body !== "object") return jsonError("Données de vente invalides.", 400);

  const input = body as Record<string, unknown>;
  const legacyId = input.legacyId;
  const date = typeof input.date === "string" ? input.date : "";
  const paymentMethod = input.paymentMethod;
  const customerLegacyId = input.customerLegacyId;
  const customerName = typeof input.customerName === "string" ? input.customerName : "";
  const items = input.items;

  if (
    Array.isArray(items) && new Set(items.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).productLegacyId : null)).size !== items.length
  ) {
    return jsonError("Un même produit ne peut apparaître qu'une fois dans la vente.", 400);
  }

  if (
    typeof legacyId !== "number" || !Number.isSafeInteger(legacyId) || legacyId <= 0 ||
    !["CASH", "MOBILE_MONEY", "CREDIT"].includes(String(paymentMethod)) ||
    (customerLegacyId !== null && customerLegacyId !== undefined &&
      (typeof customerLegacyId !== "number" || !Number.isSafeInteger(customerLegacyId) || customerLegacyId <= 0)) ||
    !Array.isArray(items) || items.length === 0 || items.length > 100 ||
    !items.every((item) => item && typeof item === "object" &&
      typeof item.productLegacyId === "number" && Number.isSafeInteger(item.productLegacyId) && item.productLegacyId > 0 &&
      typeof item.quantity === "number" && Number.isSafeInteger(item.quantity) && item.quantity > 0)
  ) {
    return jsonError("Vérifiez le numéro, le paiement, le client et les articles de la vente.", 400);
  }

  if (paymentMethod === "CREDIT" && !customerLegacyId) {
    return jsonError("Sélectionnez un client pour une vente à crédit.", 400);
  }

  const parsedDate = date ? new Date(date) : new Date();
  if (Number.isNaN(parsedDate.getTime())) return jsonError("Date de vente invalide.", 400);

  const { data, error } = await auth.supabase.rpc("create_shop_sale", {
    p_shop_id: auth.shopId,
    p_legacy_sale_id: legacyId,
    p_date: parsedDate.toISOString(),
    p_payment_method: paymentMethod,
    p_customer_legacy_id: customerLegacyId ?? null,
    p_customer_name: customerName,
    p_items: items,
  });

  if (error) {
    console.error("[sales] Supabase save failed:", error);
    const status = error.code === "23505" ? 409
      : error.code === "42501" ? 403
      : error.code === "P0002" ? 404
      : error.code === "22023" ? 400
      : 500;
    const message = error.message === "Insufficient stock"
      ? "Stock insuffisant pour cette vente."
      : error.message === "Customer not found in this shop"
        ? "Le client sélectionné est introuvable dans cette boutique."
        : error.message === "Product not found in this shop"
          ? "Un produit de la vente est introuvable dans cette boutique."
          : "Impossible d'enregistrer la vente dans Supabase.";
    return jsonError(message, status);
  }

  return NextResponse.json({ saleId: data }, { status: 201 });
}
