"use server";

import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { redirect } from "next/navigation";

export async function signInSuperAdminAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/admin-connexion?erreur=Veuillez renseigner vos identifiants.");
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    redirect("/admin-connexion?erreur=Identifiants invalides ou compte non confirmé.");
  }

  if (!isSuperAdmin(data.user)) {
    await supabase.auth.signOut();
    redirect("/admin-connexion?erreur=Accès réservé à l'administration CMR GROUP.");
  }

  redirect("/super-admin");
}

export async function signOutSuperAdminAction() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user || !isSuperAdmin(user)) {
    await supabase.auth.signOut();
    redirect("/admin-connexion");
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("[Super Admin logout] Failed:", error);
    redirect("/admin-connexion?erreur=La déconnexion a échoué. Réessayez.");
  }

  redirect("/admin-connexion");
}
