"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { openDatabase, SUPPLIER_STORE } from "@/lib/boutiquepro-db";

type Supplier = { id: number; name: string; phone: string; email: string; address: string; notes: string; createdAt: string; updatedAt?: string };
const createId = () => Date.now();

async function readLocal(): Promise<Supplier[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SUPPLIER_STORE, "readonly");
    const req = tx.objectStore(SUPPLIER_STORE).getAll();
    req.onsuccess = () => resolve(req.result as Supplier[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function putLocal(item: Supplier) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SUPPLIER_STORE, "readwrite");
    tx.objectStore(SUPPLIER_STORE).put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
function fromRemote(rows: Array<Record<string, unknown>>): Supplier[] {
  return rows.flatMap((row) => {
    const id = Number(row.legacyId);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    return [{ id, name: String(row.name ?? ""), phone: String(row.phone ?? ""), email: String(row.email ?? ""), address: String(row.address ?? ""), notes: String(row.notes ?? ""), createdAt: String(row.createdAt ?? new Date().toISOString()), updatedAt: String(row.updatedAt ?? "") }];
  });
}

export default function SuppliersPage() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function refresh() { setItems((await readLocal()).sort((a,b) => a.name.localeCompare(b.name))); }
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const local = await readLocal();
        if (active) setItems(local);
        const response = await fetch("/api/suppliers", { cache: "no-store" });
        if (!response.ok) throw new Error("Synchronisation des fournisseurs indisponible. Les données locales sont conservées.");
        const payload = await response.json() as { suppliers?: Array<Record<string, unknown>> };
        const remote = fromRemote(Array.isArray(payload.suppliers) ? payload.suppliers : []);
        for (const item of remote) await putLocal(item);
        const merged = new Map(local.map((item) => [item.id, item]));
        remote.forEach((item) => merged.set(item.id, item));
        if (active) setItems(Array.from(merged.values()).sort((a,b) => a.name.localeCompare(b.name)));
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Chargement impossible."); }
      finally { if (active) setLoaded(true); }
    }
    void init(); return () => { active = false; };
  }, []);

  const filtered = useMemo(() => items.filter((item) => [item.name,item.phone,item.email,item.address].join(" ").toLowerCase().includes(query.toLowerCase())), [items, query]);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    if (!name.trim()) { setError("Le nom du fournisseur est obligatoire."); return; }
    setSaving(true);
    try {
      const item: Supplier = { id: createId(), name: name.trim(), phone: phone.trim(), email: email.trim(), address: address.trim(), notes: notes.trim(), createdAt: new Date().toISOString() };
      const response = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legacyId: item.id, name: item.name, phone: item.phone, email: item.email, address: item.address, notes: item.notes }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Enregistrement Supabase impossible.");
      await putLocal(item); await refresh();
      setName(""); setPhone(""); setEmail(""); setAddress(""); setNotes("");
      setSuccess("Fournisseur enregistré dans Supabase et sur cet appareil. Il sera disponible sur vos autres appareils.");
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }

  if (!loaded) return <main className="min-h-screen p-6">Chargement des fournisseurs...</main>;
  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-800 sm:px-8"><div className="mx-auto max-w-4xl">
    <header className="rounded-2xl bg-[#173B70] p-6 text-white"><Link href="/boutique" className="text-sm text-blue-100">← Tableau de bord</Link><h1 className="mt-3 text-2xl font-extrabold">Fournisseurs</h1><p className="mt-2 text-sm text-blue-100">Centralisez les coordonnées de vos fournisseurs sur vos appareils.</p></header>
    <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Ajouter un fournisseur</h2><form onSubmit={handleSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold sm:col-span-2">Nom du fournisseur *<input required maxLength={200} value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Nom de l'entreprise ou du fournisseur"/></label>
      <label className="text-sm font-semibold">Téléphone<input maxLength={40} value={phone} onChange={e=>setPhone(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="+229..."/></label>
      <label className="text-sm font-semibold">E-mail<input type="email" maxLength={200} value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="contact@exemple.com"/></label>
      <label className="text-sm font-semibold sm:col-span-2">Adresse<input maxLength={300} value={address} onChange={e=>setAddress(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Ville, quartier, adresse"/></label>
      <label className="text-sm font-semibold sm:col-span-2">Notes<textarea maxLength={2000} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Informations utiles sur ce fournisseur"/></label>
      <button disabled={saving} className="rounded-xl bg-[#173B70] p-3 font-bold text-white disabled:opacity-50 sm:col-span-2">{saving ? "Enregistrement..." : "Enregistrer le fournisseur"}</button>
    </form>{error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{success && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>}</section>
    <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Répertoire des fournisseurs</h2><span className="text-sm text-slate-500">{items.length} fournisseur(s)</span></div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher par nom, téléphone ou e-mail..." className="mt-4 w-full rounded-xl border p-3"/>
      {filtered.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Aucun fournisseur trouvé.</p> : <div className="mt-3 divide-y">{filtered.map(item=><article key={item.id} className="py-4"><h3 className="font-bold">{item.name}</h3><p className="mt-1 text-sm text-slate-600">{[item.phone,item.email,item.address].filter(Boolean).join(" · ") || "Aucune coordonnée renseignée"}</p>{item.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-500">{item.notes}</p>}</article>)}</div>}
    </section><p className="mt-5 text-center text-xs text-slate-400">Les fournisseurs sont séparés par boutique et synchronisés via Supabase.</p>
  </div></main>;
}
