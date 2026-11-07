"use client";

import Link from "next/link";
import Image from "next/image";
import { ChangeEvent, useEffect, useState } from "react";
import {
  openDatabase,
  STORE_NAME,
  MOVEMENT_STORE,
  SALES_STORE,
  CUSTOMER_STORE,
  CREDIT_PAYMENT_STORE,
  EXPENSE_STORE,
  SETTINGS_STORE,
} from "@/lib/boutiquepro-db";

type StoreProfile = {
  id: "profile";
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  logo?: string;
};

const emptyProfile: StoreProfile = {
  id: "profile",
  name: "",
  phone: "",
  whatsapp: "",
  address: "",
};

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choisissez un fichier image."));
      return;
    }
    if (file.size > 1024 * 1024) {
      reject(new Error("Le logo doit peser 1 Mo maximum."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Impossible de lire le logo."));
    reader.readAsDataURL(file);
  });
}

async function loadProfile(): Promise<StoreProfile | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, "readonly");
    const request = tx.objectStore(SETTINGS_STORE).get("profile");
    request.onsuccess = () => resolve(request.result as StoreProfile | undefined);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function saveProfile(profile: StoreProfile): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, "readwrite");
    tx.objectStore(SETTINGS_STORE).put(profile);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

async function downloadLocalBackup(): Promise<void> {
  const db = await openDatabase();
  const storeNames = [
    STORE_NAME,
    MOVEMENT_STORE,
    SALES_STORE,
    CUSTOMER_STORE,
    CREDIT_PAYMENT_STORE,
    EXPENSE_STORE,
    SETTINGS_STORE,
  ];

  try {
    const data = await new Promise<Record<string, unknown[]>>((resolve, reject) => {
      const tx = db.transaction(storeNames, "readonly");
      const backup: Record<string, unknown[]> = {};
      for (const name of storeNames) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => { backup[name] = request.result as unknown[]; };
        request.onerror = () => reject(request.error);
      }
      tx.oncomplete = () => resolve(backup);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Lecture de sauvegarde annulée."));
    });

    const payload = {
      format: "BoutiquePro local backup",
      version: 1,
      database: "BoutiqueProDB",
      databaseVersion: db.version,
      exportedAt: new Date().toISOString(),
      stores: data,
      counts: Object.fromEntries(
        Object.entries(data).map(([name, records]) => [name, records.length]),
      ),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `boutiquepro-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } finally {
    db.close();
  }
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<StoreProfile>(emptyProfile);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    async function initialize() {
      let local: StoreProfile | undefined;
      try {
        local = await loadProfile();
      } catch {
        if (active) setError("Impossible de lire les paramètres locaux.");
      }

      try {
        const response = await fetch("/api/shop-profile", { cache: "no-store" });
        if (!response.ok) throw new Error("Chargement distant indisponible.");
        const payload = await response.json() as { profile: StoreProfile };
        const remote = payload.profile;
        const needsBackfill = Boolean(local && (
          (!remote.phone && local.phone) ||
          (!remote.whatsapp && local.whatsapp) ||
          (!remote.address && local.address) ||
          (!remote.logo && local.logo)
        ));
        let resolved = remote;
        if (needsBackfill && local) {
          const merged = {
            ...remote,
            phone: remote.phone || local.phone,
            whatsapp: remote.whatsapp || local.whatsapp,
            address: remote.address || local.address,
            logo: remote.logo || local.logo,
          };
          const saveResponse = await fetch("/api/shop-profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(merged),
          });
          if (saveResponse.ok) {
            const savedPayload = await saveResponse.json() as { profile: StoreProfile };
            resolved = savedPayload.profile;
          }
        }
        await saveProfile(resolved);
        if (active) setProfile(resolved);
      } catch {
        if (local) {
          if (active) {
            setProfile(local);
            setError("Paramètres affichés depuis cet appareil : synchronisation en ligne indisponible.");
          }
        } else if (active) {
          setError("Impossible de charger les paramètres de la boutique.");
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialize();
    return () => { active = false; };
  }, []);

  function update(field: keyof Omit<StoreProfile, "id" | "logo">, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    setSuccess("");
  }

  async function handleLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const logo = await readImage(file);
      setProfile((current) => ({ ...current, logo }));
      setSuccess("Logo chargé. Enregistrez les paramètres pour le conserver.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo invalide.");
    }
  }

  async function handleBackup() {
    setError("");
    setSuccess("");
    setBackingUp(true);
    try {
      await downloadLocalBackup();
      setSuccess("Sauvegarde téléchargée. Conservez ce fichier dans un endroit sûr.");
    } catch {
      setError("Impossible de créer la sauvegarde locale.");
    } finally {
      setBackingUp(false);
    }
  }

  async function handleSave() {
    setError("");
    setSuccess("");
    if (!profile.name.trim()) {
      setError("Le nom de la boutique est obligatoire.");
      return;
    }
    setSaving(true);
    try {
      const normalized = { ...profile, name: profile.name.trim(), phone: profile.phone.trim(), whatsapp: profile.whatsapp.trim(), address: profile.address.trim() };
      const response = await fetch("/api/shop-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Enregistrement en ligne impossible.");
      }
      const payload = await response.json() as { profile: StoreProfile };
      await saveProfile(payload.profile);
      setProfile(payload.profile);
      setSuccess("Paramètres enregistrés dans Supabase et synchronisés sur vos appareils.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'enregistrer les paramètres.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <main className="min-h-screen p-6">Chargement des paramètres...</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-800 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <header className="rounded-2xl bg-[#173B70] p-6 text-white">
          <Link href="/" className="text-sm text-blue-100">← Tableau de bord</Link>
          <h1 className="mt-3 text-2xl font-extrabold">Paramètres de la boutique</h1>
          <p className="mt-2 text-sm text-blue-100">Personnalisez les informations qui apparaissent sur vos reçus.</p>
        </header>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Identité de la boutique</h2>
          <label className="mt-4 block text-sm font-semibold">Nom de la boutique *
            <input value={profile.name} onChange={(event) => update("name", event.target.value)} maxLength={80} placeholder="Ex. : Boutique Espoir" className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal" />
          </label>
          <label className="mt-4 block text-sm font-semibold">Téléphone
            <input value={profile.phone} onChange={(event) => update("phone", event.target.value)} maxLength={30} inputMode="tel" placeholder="Ex. : +229 ..." className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal" />
          </label>
          <label className="mt-4 block text-sm font-semibold">WhatsApp
            <input value={profile.whatsapp} onChange={(event) => update("whatsapp", event.target.value)} maxLength={30} inputMode="tel" placeholder="Ex. : +229 ..." className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal" />
          </label>
          <label className="mt-4 block text-sm font-semibold">Adresse
            <textarea value={profile.address} onChange={(event) => update("address", event.target.value)} maxLength={180} rows={3} placeholder="Quartier, ville..." className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal" />
          </label>
          <div className="mt-5">
            <p className="text-sm font-semibold">Logo de la boutique</p>
            <input type="file" accept="image/*" onChange={handleLogo} className="mt-2 block w-full text-sm" />
            <p className="mt-1 text-xs text-slate-500">Image de 1 Mo maximum. Le logo est synchronisé avec la boutique.</p>
            {profile.logo && <div className="mt-3 flex items-center gap-4"><Image src={profile.logo} alt="Aperçu du logo" width={80} height={80} unoptimized className="h-20 w-20 rounded-xl border object-contain p-2" /><button type="button" onClick={() => setProfile((current) => ({ ...current, logo: undefined }))} className="text-sm font-semibold text-red-600">Supprimer le logo</button></div>}
          </div>
          <button type="button" disabled={saving} onClick={handleSave} className="mt-6 w-full rounded-xl bg-[#173B70] p-4 font-bold text-white disabled:opacity-50">{saving ? "Enregistrement..." : "Enregistrer les paramètres"}</button>
          <div className="mt-8 border-t border-slate-200 pt-5">
            <h2 className="text-lg font-bold">Sauvegarde des données</h2>
            <p className="mt-2 text-sm text-slate-600">
              Téléchargez une copie de vos produits, ventes, clients, crédits,
              remboursements, mouvements de stock, dépenses et paramètres.
            </p>
            <button
              type="button"
              disabled={backingUp}
              onClick={handleBackup}
              className="mt-4 w-full rounded-xl border border-[#173B70] p-4 font-bold text-[#173B70] disabled:opacity-50"
            >
              {backingUp ? "Préparation de la sauvegarde..." : "Télécharger une sauvegarde complète"}
            </button>
            <p className="mt-2 text-xs text-slate-500">
              Cette opération copie les données sans les modifier ni les supprimer.
            </p>
          </div>
          {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {success && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>}
        </section>
        <p className="mt-5 text-center text-xs text-slate-400">Ces informations sont enregistrées dans la boutique et partagées entre ses appareils.</p>
      </div>
    </main>
  );
}
