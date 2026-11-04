"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { openDatabase, CUSTOMER_STORE, CREDIT_PAYMENT_STORE, SALES_STORE } from "@/lib/boutiquepro-db";

type Customer = { id: number; name: string; phone: string; address: string; createdAt: string };
type Sale = { id: number; date: string; total: number; paymentMethod: "CASH" | "MOBILE_MONEY" | "CREDIT"; customerId?: number; customerName?: string };
type CreditPayment = { id: number; saleId: number; customerId: number; amount: number; date: string; note: string };

const money = (value: number) => `${value.toLocaleString("fr-FR")} FCFA`;
const createId = () => Date.now();

async function loadData(): Promise<[Customer[], Sale[], CreditPayment[]]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CUSTOMER_STORE, SALES_STORE, CREDIT_PAYMENT_STORE], "readonly");
    const customers = tx.objectStore(CUSTOMER_STORE).getAll();
    const sales = tx.objectStore(SALES_STORE).getAll();
    const payments = tx.objectStore(CREDIT_PAYMENT_STORE).getAll();
    const result: [Customer[], Sale[], CreditPayment[]] = [[], [], []];
    customers.onsuccess = () => { result[0] = customers.result as Customer[]; };
    sales.onsuccess = () => { result[1] = sales.result as Sale[]; };
    payments.onsuccess = () => { result[2] = payments.result as CreditPayment[]; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function addCustomer(customer: Customer): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOMER_STORE, "readwrite");
    tx.objectStore(CUSTOMER_STORE).add(customer);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function recordPayment(payment: CreditPayment): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SALES_STORE, CREDIT_PAYMENT_STORE], "readwrite");
    const saleRequest = tx.objectStore(SALES_STORE).get(payment.saleId);
    let failure: Error | null = null;
    saleRequest.onsuccess = () => {
      const sale = saleRequest.result as Sale | undefined;
      if (!sale || sale.paymentMethod !== "CREDIT") {
        failure = new Error("Cette vente à crédit est introuvable.");
        tx.abort();
        return;
      }
      const request = tx.objectStore(CREDIT_PAYMENT_STORE).index("saleId").getAll(payment.saleId);
      request.onsuccess = () => {
        const paid = (request.result as CreditPayment[]).reduce((sum, item) => sum + item.amount, 0);
        const remaining = sale.total - paid;
        if (!Number.isInteger(payment.amount) || payment.amount <= 0) {
          failure = new Error("Le remboursement doit être un montant entier supérieur à zéro.");
          tx.abort();
        } else if (payment.amount > remaining) {
          failure = new Error("Le montant dépasse le solde restant dû.");
          tx.abort();
        } else {
          tx.objectStore(CREDIT_PAYMENT_STORE).add(payment);
        }
      };
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error("Remboursement annulé.")); };
    tx.onerror = () => { db.close(); };
  });
}

export default function ClientsPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [selectedSale, setSelectedSale] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function applyData(data: [Customer[], Sale[], CreditPayment[]]) {
    setCustomers(data[0].sort((a, b) => a.name.localeCompare(b.name)));
    setSales(data[1].sort((a, b) => b.date.localeCompare(a.date)));
    setPayments(data[2].sort((a, b) => b.date.localeCompare(a.date)));
  }
  async function refresh() { applyData(await loadData()); }

  useEffect(() => {
    let active = true;
    loadData().then((data) => { if (active) applyData(data); })
      .catch(() => { if (active) setError("Impossible de charger les clients et les crédits."); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const balances = useMemo(() => sales.filter((sale) => sale.paymentMethod === "CREDIT").map((sale) => {
    const paid = payments.filter((payment) => payment.saleId === sale.id).reduce((sum, payment) => sum + payment.amount, 0);
    return { sale, paid, remaining: Math.max(0, sale.total - paid) };
  }), [sales, payments]);

  const selected = balances.find((item) => item.sale.id === Number(selectedSale));
  const totalDebt = balances.reduce((sum, item) => sum + item.remaining, 0);
  const debtFor = (customerId: number) => balances.filter((item) => item.sale.customerId === customerId).reduce((sum, item) => sum + item.remaining, 0);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    if (!name.trim() || !phone.trim()) { setError("Le nom et le téléphone sont obligatoires."); return; }
    try {
      await addCustomer({ id: createId(), name: name.trim(), phone: phone.trim(), address: address.trim(), createdAt: new Date().toISOString() });
      await refresh(); setName(""); setPhone(""); setAddress(""); setSuccess("Client enregistré avec succès.");
    } catch { setError("Impossible d'enregistrer ce client."); }
  }

  async function handlePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    const value = Number(amount);
    if (!selected || !Number.isInteger(value) || value <= 0) { setError("Choisissez une dette et saisissez un montant entier valide."); return; }
    try {
      await recordPayment({ id: createId(), saleId: selected.sale.id, customerId: selected.sale.customerId ?? 0, amount: value, date: new Date().toISOString(), note: note.trim() });
      await refresh(); setSelectedSale(""); setAmount(""); setNote(""); setSuccess("Remboursement enregistré et solde recalculé.");
    } catch (err) { setError(err instanceof Error ? err.message : "Impossible d'enregistrer le remboursement."); }
  }

  if (!loaded) return <main className="min-h-screen p-6">Chargement des clients...</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-800 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-2xl bg-[#173B70] p-6 text-white">
          <Link href="/" className="text-sm text-blue-100">← Tableau de bord</Link>
          <h1 className="mt-3 text-2xl font-extrabold">Clients et crédits</h1>
          <p className="mt-2 text-sm text-blue-100">Gérez vos clients, leurs dettes et les remboursements.</p>
        </header>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total des crédits restant à rembourser</p>
          <p className="mt-2 text-2xl font-extrabold text-orange-700">{money(totalDebt)}</p>
          <p className="mt-1 text-xs text-slate-500">Les anciennes ventes à crédit sans client associé restent consultables.</p>
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Ajouter un client</h2>
          <form onSubmit={handleAdd} className="mt-4 space-y-3">
            <label className="block text-sm font-semibold">Nom complet *
              <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Nom du client" />
            </label>
            <label className="block text-sm font-semibold">Téléphone *
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Téléphone ou WhatsApp" />
            </label>
            <label className="block text-sm font-semibold">Adresse (facultatif)
              <input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Quartier ou ville" />
            </label>
            <button className="w-full rounded-xl bg-[#173B70] p-3 font-bold text-white" type="submit">Enregistrer le client</button>
          </form>
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Enregistrer un remboursement</h2>
          <form onSubmit={handlePayment} className="mt-4 space-y-3">
            <label className="block text-sm font-semibold">Dette à rembourser
              <select required value={selectedSale} onChange={(e) => setSelectedSale(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-3 font-normal">
                <option value="">Choisir une dette</option>
                {balances.filter((item) => item.remaining > 0).map(({ sale, remaining }) => <option key={sale.id} value={sale.id}>{sale.customerName || "Client non identifié"} · Vente #{sale.id} · {money(remaining)}</option>)}
              </select>
            </label>
            {selected && <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">Solde restant : <strong>{money(selected.remaining)}</strong></p>}
            <label className="block text-sm font-semibold">Montant remboursé (FCFA)
              <input required type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Ex. : 5000" />
            </label>
            <label className="block text-sm font-semibold">Note (facultatif)
              <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Ex. : Paiement en espèces" />
            </label>
            <button type="submit" disabled={!selected} className="w-full rounded-xl bg-emerald-600 p-3 font-bold text-white disabled:opacity-50">Enregistrer le remboursement</button>
          </form>
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Liste des clients ({customers.length})</h2>
          <div className="mt-4 space-y-3">
            {customers.length === 0 && <p className="text-sm text-slate-500">Aucun client enregistré.</p>}
            {customers.map((customer) => <article key={customer.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{customer.name}</h3><p className="text-sm text-slate-500">{customer.phone}</p>{customer.address && <p className="text-xs text-slate-500">{customer.address}</p>}</div><strong className="text-right text-sm text-orange-700">{money(debtFor(customer.id))}</strong></div>
            </article>)}
          </div>
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Historique des crédits</h2>
          <div className="mt-4 space-y-3">
            {balances.length === 0 && <p className="text-sm text-slate-500">Aucune dette en cours.</p>}
            {balances.map(({ sale, paid, remaining }) => <article key={sale.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{sale.customerName || "Client non identifié"}</h3><p className="text-xs text-slate-500">Vente #{sale.id} · {new Date(sale.date).toLocaleString("fr-FR")}</p></div><span className="rounded-lg bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700">{remaining > 0 ? "En cours" : "Soldé"}</span></div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><p>Total<br /><strong>{money(sale.total)}</strong></p><p>Payé<br /><strong>{money(paid)}</strong></p><p>Reste<br /><strong>{money(remaining)}</strong></p></div>
              {payments.filter((payment) => payment.saleId === sale.id).map((payment) => <p key={payment.id} className="mt-2 border-t pt-2 text-xs text-slate-500">Remboursement : {money(payment.amount)} · {new Date(payment.date).toLocaleString("fr-FR")}{payment.note ? ` · ${payment.note}` : ""}</p>)}
            </article>)}
          </div>
        </section>
        {(error || success) && <p className={error ? "mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" : "mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700"}>{error || success}</p>}
        <p className="mt-6 text-center text-xs text-slate-400">BoutiquePro · Données locales sur cet appareil.</p>
      </div>
    </main>
  );
}
