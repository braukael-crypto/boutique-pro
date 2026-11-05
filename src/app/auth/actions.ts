"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";

function safeNextPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "/";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function makeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!email || !password) redirect("/connexion?erreur=Veuillez renseigner votre adresse e-mail et votre mot de passe.");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/connexion?erreur=Identifiants invalides ou compte non confirmé.");
  }

  redirect(next);
}

export async function signUpAction(formData: FormData) {
  const shopName = String(formData.get("shopName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const baseSlug = makeSlug(shopName);
  const slug = baseSlug ? `${baseSlug}-${randomBytes(3).toString("hex")}` : "";

  if (shopName.length < 2 || shopName.length > 100 || !slug) {
    redirect("/inscription?erreur=Le nom de la boutique est invalide.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/inscription?erreur=Adresse e-mail invalide.");
  }
  if (password.length < 8) {
    redirect("/inscription?erreur=Le mot de passe doit contenir au moins 8 caractères.");
  }

  const supabase = await createClient();
  const headerStore = await headers();
  const origin = headerStore.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;

  if (!origin) {
    redirect("/inscription?erreur=URL du site manquante dans la configuration.");
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: new URL("/auth/callback", origin).toString(),
      data: { shop_name: shopName, shop_slug: slug },
    },
  });

  if (error) {
    redirect("/inscription?erreur=Impossible de créer le compte. Vérifiez l'adresse e-mail ou réessayez.");
  }

  if (data.session) {
    redirect("/auth/callback");
  }

  redirect("/inscription/verification");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}
