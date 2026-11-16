import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireShopWriteAccess, subscriptionWriteDeniedResponse } from "@/lib/subscriptions/server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getAuthorizedShop() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { supabase, shopId: null, error: "Authentification requise." };
  const { data: membership, error } = await supabase
    .from("shop_memberships")
    .select("shopId")
    .eq("userId", user.id)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !membership?.shopId) return { supabase, shopId: null, error: "Aucune boutique autorisée n'a été trouvée." };
  return { supabase, shopId: membership.shopId as string, error: null };
}

export async function GET() {
  const auth = await getAuthorizedShop();
  if (auth.error || !auth.shopId) return jsonError(auth.error || "Accès refusé.", 401);

  const { data: payments, error } = await auth.supabase
    .from("credit_payments")
    .select('id, "legacyId", "saleId", "customerId", amount, date, note')
    .eq("shopId", auth.shopId)
    .order("date", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("[credit-payments] history read failed:", error);
    return jsonError("Impossible de récupérer les remboursements.", 500);
  }

  const saleIds = Array.from(new Set((payments ?? []).map((p) => p.saleId)));
  const customerIds = Array.from(new Set((payments ?? []).map((p) => p.customerId).filter(Boolean)));
  const [salesResult, customersResult] = await Promise.all([
    saleIds.length ? auth.supabase.from("sales").select('id, "legacyId"').eq("shopId", auth.shopId).in("id", saleIds) : Promise.resolve({ data: [], error: null }),
    customerIds.length ? auth.supabase.from("customers").select('id, "legacyId"').eq("shopId", auth.shopId).in("id", customerIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (salesResult.error || customersResult.error) return jsonError("Impossible de relier les remboursements à leurs ventes.", 500);
  const saleLegacy = new Map((salesResult.data ?? []).map((s) => [s.id, s.legacyId]));
  const customerLegacy = new Map((customersResult.data ?? []).map((c) => [c.id, c.legacyId]));

  return NextResponse.json({
    payments: (payments ?? []).flatMap((p) => {
      const saleId = saleLegacy.get(p.saleId);
      if (p.legacyId === null || saleId === null || saleId === undefined) return [];
      return [{
        id: Number(p.legacyId),
        saleId: Number(saleId),
        customerId: p.customerId ? Number(customerLegacy.get(p.customerId) ?? 0) : 0,
        amount: Number(p.amount),
        date: p.date,
        note: p.note ?? "",
      }];
    }),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireShopWriteAccess({ membershipMissingStatus: 401 });
  if (!auth.ok) return subscriptionWriteDeniedResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Corps de requête invalide.", 400); }
  if (!body || typeof body !== "object") return jsonError("Données de remboursement invalides.", 400);
  const input = body as Record<string, unknown>;
  const legacyId = input.legacyId;
  const saleLegacyId = input.saleLegacyId;
  const amount = input.amount;
  const date = typeof input.date === "string" ? input.date : "";
  const note = typeof input.note === "string" ? input.note : "";

  if (
    typeof legacyId !== "number" || !Number.isSafeInteger(legacyId) || legacyId <= 0 ||
    typeof saleLegacyId !== "number" || !Number.isSafeInteger(saleLegacyId) || saleLegacyId <= 0 ||
    typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 ||
    note.length > 500
  ) return jsonError("Vérifiez l'identifiant, la vente et le montant du remboursement.", 400);

  const parsedDate = date ? new Date(date) : new Date();
  if (Number.isNaN(parsedDate.getTime())) return jsonError("Date de remboursement invalide.", 400);

  const { data, error } = await auth.supabase.rpc("record_shop_credit_payment", {
    p_shop_id: auth.shopId,
    p_legacy_payment_id: legacyId,
    p_legacy_sale_id: saleLegacyId,
    p_amount: amount,
    p_date: parsedDate.toISOString(),
    p_note: note,
  });
  if (error) {
    console.error("[credit-payments] save failed:", error);
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
    const errorMessage = error.message ?? "";
    const message = errorMessage.includes("exceeds outstanding balance")
      ? "Le montant dépasse le solde restant dû."
      : errorMessage.includes("not a credit sale")
        ? "Cette vente n'est pas une vente à crédit."
        : errorMessage.includes("not found")
          ? "La vente à crédit est introuvable dans cette boutique."
          : "Impossible d'enregistrer le remboursement dans Supabase.";
    return jsonError(message, status);
  }
  return NextResponse.json({ paymentId: data }, { status: 201 });
}
