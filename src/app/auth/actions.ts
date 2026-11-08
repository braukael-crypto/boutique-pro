"use server";

import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/connexion?erreur=Veuillez renseigner votre adresse e-mail et votre mot de passe.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    redirect("/connexion?erreur=Identifiants invalides ou compte non confirmé.");
  }

  if (isSuperAdmin(data.user)) {
    redirect("/super-admin");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("shop_memberships")
    .select("shopId")
    .eq("userId", data.user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("[BoutiquePro login] Membership lookup failed", membershipError);
    redirect("/connexion?erreur=Impossible de vérifier votre accès. Réessayez.");
  }

  if (membership?.shopId) {
    redirect("/boutique");
  }

  redirect("/demande-suivi");
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/mot-de-passe-oublie?erreur=Veuillez saisir une adresse e-mail valide.");
  }

  const headerStore = await headers();
  const origin = headerStore.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!origin) redirect("/mot-de-passe-oublie?erreur=Configuration du site indisponible.");

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("/auth/recovery/callback", origin).toString(),
  });

  if (error) {
    console.error("[BoutiquePro password reset] Supabase request failed", {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    redirect("/mot-de-passe-oublie?erreur=Impossible d'envoyer le lien. Réessayez dans quelques instants.");
  }

  redirect("/mot-de-passe-oublie?message=Si cette adresse correspond à un compte, un lien de récupération a été envoyé.");
}

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 8) redirect("/reinitialiser-mot-de-passe?erreur=Le mot de passe doit contenir au moins 8 caractères.");
  if (password !== confirmation) redirect("/reinitialiser-mot-de-passe?erreur=Les deux mots de passe ne correspondent pas.");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[BoutiquePro password reset] Password update failed", {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    redirect("/reinitialiser-mot-de-passe?erreur=Le lien est invalide ou expiré. Demandez un nouveau lien.");
  }

  await supabase.auth.signOut();
  redirect("/connexion?message=Votre mot de passe a été modifié. Connectez-vous avec votre nouveau mot de passe.");
}

export async function signUpAction(formData: FormData) {
  const shopName = String(formData.get("shopName") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const address = String(formData.get("address") ?? "").trim();
  const plan = String(formData.get("plan") ?? "");
  const password = String(formData.get("password") ?? "");

  if (shopName.length < 2 || shopName.length > 100 || contactName.length < 2 || contactName.length > 100) redirect("/inscription?erreur=Vérifiez le nom de la boutique et le nom du responsable.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/inscription?erreur=Adresse e-mail invalide.");
  if (phone.length < 6 || phone.length > 40) redirect("/inscription?erreur=Numéro de téléphone invalide.");
  if (address.length > 300) redirect("/inscription?erreur=Adresse trop longue.");
  if (!["ESSENTIAL","STANDARD","PREMIUM","ENTERPRISE"].includes(plan)) redirect("/inscription?erreur=Choisissez une formule.");
  if (password.length < 8) redirect("/inscription?erreur=Le mot de passe doit contenir au moins 8 caractères.");

  const supabase = await createClient();
  const headerStore = await headers();
  const origin = headerStore.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!origin) redirect("/inscription?erreur=URL du site manquante dans la configuration.");
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: new URL("/auth/callback", origin).toString(), data: { shop_name: shopName, contact_name: contactName, phone, address, plan } },
  });
  if (error) {
    console.error("[BoutiquePro signup] Supabase signUp failed", {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    redirect("/inscription?erreur=Impossible de créer le compte. Vérifiez l'adresse e-mail ou réessayez.");
  }
  if (data.session) redirect("/auth/callback");
  redirect("/inscription/verification");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}
