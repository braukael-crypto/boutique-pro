"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function safeNextPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "/boutique";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/boutique";
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));
  if (!email || !password) redirect("/connexion?erreur=Veuillez renseigner votre adresse e-mail et votre mot de passe.");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/connexion?erreur=Identifiants invalides ou compte non confirmé.");
  redirect(next);
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
  if (error) redirect("/inscription?erreur=Impossible de créer le compte. Vérifiez l'adresse e-mail ou réessayez.");
  if (data.session) redirect("/auth/callback");
  redirect("/inscription/verification");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}
