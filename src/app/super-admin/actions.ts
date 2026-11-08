"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createSuperAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/super-admin";

async function requireSuperAdmin() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!isSuperAdmin(user)) redirect("/connexion?next=/super-admin");
  return createSuperAdminClient();
}

export async function reviewApplicationAction(formData: FormData) {
  const applicationId = String(formData.get("applicationId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("adminNote") ?? "").trim().slice(0, 1000);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) {
    redirect("/super-admin?erreur=Demande invalide");
  }
  if (!["UNDER_REVIEW", "REJECTED", "APPROVED"].includes(decision)) {
    redirect("/super-admin?erreur=Décision invalide");
  }

  const admin = await requireSuperAdmin();
  if (decision === "APPROVED") {
    const { error } = await admin.rpc("approve_shop_application", { p_application_id: applicationId });
    if (error) {
      console.error("[super-admin] approval failed", { code: error.code, message: error.message });
      redirect("/super-admin?erreur=Impossible de valider cette demande. Vérifiez la migration et son état.");
    }
  } else {
    const { error } = await admin.from("shop_applications").update({
      status: decision,
      adminNote: note || null,
      reviewedAt: decision === "REJECTED" ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    }).eq("id", applicationId).in("status", ["PENDING", "UNDER_REVIEW"]);
    if (error) {
      console.error("[super-admin] application review failed", { code: error.code, message: error.message });
      redirect("/super-admin?erreur=Impossible de mettre à jour cette demande.");
    }
  }

  revalidatePath("/super-admin");
  revalidatePath("/demande-suivi");
  redirect("/super-admin?message=Décision enregistrée");
}
