import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonError("Authentification requise pour sauvegarder la boutique.", 401);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("shop_memberships")
    .select("shopId")
    .eq("userId", user.id)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.shopId) {
    return jsonError("Aucune boutique autorisée n'a été trouvée.", 403);
  }

  const shopId = membership.shopId as string;
  const [
    shopResult,
    productsResult,
    movementsResult,
    customersResult,
    salesResult,
    saleItemsResult,
    paymentsResult,
    expensesResult,
    suppliersResult,
  ] = await Promise.all([
    supabase.from("shops").select("id, name, slug, phone, whatsapp, address, logoUrl, currency, createdAt, updatedAt").eq("id", shopId).single(),
    supabase.from("products").select("*").eq("shopId", shopId).order("createdAt", { ascending: true }),
    supabase.from("stock_movements").select("*").eq("shopId", shopId).order("date", { ascending: true }),
    supabase.from("customers").select("*").eq("shopId", shopId).order("createdAt", { ascending: true }),
    supabase.from("sales").select("*").eq("shopId", shopId).order("date", { ascending: true }),
    supabase.from("sale_items").select("*").eq("shopId", shopId).order("id", { ascending: true }),
    supabase.from("credit_payments").select("*").eq("shopId", shopId).order("date", { ascending: true }),
    supabase.from("expenses").select("*").eq("shopId", shopId).order("date", { ascending: true }),
    supabase.from("suppliers").select("*").eq("shopId", shopId).order("name", { ascending: true }),
  ]);

  const results = [
    shopResult, productsResult, movementsResult, customersResult,
    salesResult, saleItemsResult, paymentsResult, expensesResult, suppliersResult,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    console.error("[backup] Supabase export failed:", failed.error);
    return jsonError("La sauvegarde Supabase est incomplète. Aucune archive n'a été générée.", 500);
  }

  const stores = {
    shop: shopResult.data,
    products: productsResult.data ?? [],
    stockMovements: movementsResult.data ?? [],
    customers: customersResult.data ?? [],
    sales: salesResult.data ?? [],
    saleItems: saleItemsResult.data ?? [],
    creditPayments: paymentsResult.data ?? [],
    expenses: expensesResult.data ?? [],
    suppliers: suppliersResult.data ?? [],
  };

  return NextResponse.json({
    format: "BoutiquePro Supabase backup",
    version: 1,
    source: "supabase",
    shopId,
    exportedAt: new Date().toISOString(),
    stores,
    counts: {
      products: stores.products.length,
      stockMovements: stores.stockMovements.length,
      customers: stores.customers.length,
      sales: stores.sales.length,
      saleItems: stores.saleItems.length,
      creditPayments: stores.creditPayments.length,
      expenses: stores.expenses.length,
      suppliers: stores.suppliers.length,
    },
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="boutiquepro-supabase-backup.json"',
    },
  });
}
