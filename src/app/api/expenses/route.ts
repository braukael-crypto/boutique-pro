import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireShopWriteAccess, subscriptionWriteDeniedResponse } from "@/lib/subscriptions/server";

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
    .from("expenses")
    .select('id, "legacyId", label, category, amount, date, note')
    .eq("shopId", auth.shopId)
    .order("date", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[expenses] Supabase history read failed:", error);
    return jsonError("Impossible de charger les dépenses depuis Supabase.", 500);
  }

  const expenses = (data ?? [])
    .filter((expense) => expense.legacyId !== null)
    .map((expense) => ({
      id: Number(expense.legacyId),
      label: expense.label,
      category: expense.category,
      amount: Number(expense.amount),
      date: expense.date,
      note: expense.note ?? "",
    }));

  return NextResponse.json({ expenses });
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

  if (!body || typeof body !== "object") return jsonError("Données de dépense invalides.", 400);
  const input = body as Record<string, unknown>;
  const legacyId = input.legacyId;
  const label = typeof input.label === "string" ? input.label.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const amount = input.amount;
  const date = typeof input.date === "string" ? new Date(input.date) : new Date();
  const note = typeof input.note === "string" ? input.note.trim() : "";

  if (
    typeof legacyId !== "number" || !Number.isSafeInteger(legacyId) || legacyId <= 0 ||
    !label || label.length > 200 ||
    !category || category.length > 100 ||
    typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 ||
    Number.isNaN(date.getTime()) ||
    note.length > 1000
  ) {
    return jsonError("Vérifiez le libellé, la catégorie, le montant, la date et l'identifiant de la dépense.", 400);
  }

  const payload = {
    id: randomUUID(),
    shopId: auth.shopId,
    legacyId,
    label,
    category,
    amount,
    date: date.toISOString(),
    note: note || null,
  };

  const { data, error } = await auth.supabase
    .from("expenses")
    .insert(payload)
    .select('id, "legacyId", label, category, amount, date, note')
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: lookupError } = await auth.supabase
        .from("expenses")
        .select('id, "legacyId", label, category, amount, date, note')
        .eq("shopId", auth.shopId)
        .eq("legacyId", legacyId)
        .maybeSingle();

      if (!lookupError && existing) {
        return NextResponse.json({
          expense: {
            id: Number(existing.legacyId),
            label: existing.label,
            category: existing.category,
            amount: Number(existing.amount),
            date: existing.date,
            note: existing.note ?? "",
          },
        });
      }
    }

    console.error("[expenses] Supabase save failed:", error);
    return jsonError("Impossible d'enregistrer la dépense dans Supabase.", 500);
  }

  if (!data) return jsonError("Aucune dépense n'a été retournée par Supabase.", 500);

  return NextResponse.json({
    expense: {
      id: Number(data.legacyId),
      label: data.label,
      category: data.category,
      amount: Number(data.amount),
      date: data.date,
      note: data.note ?? "",
    },
  }, { status: 201 });
}
