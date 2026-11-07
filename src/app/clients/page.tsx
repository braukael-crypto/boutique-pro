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

async function cacheRemoteCustomers(customers: Customer[]): Promise<void> {
  if (customers.length === 0) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOMER_STORE, "readwrite");
    const store = tx.objectStore(CUSTOMER_STORE);
    customers.forEach((customer) => store.put(customer));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Mise en cache annulée.")); };
  });
}

async function loadRemoteCustomers(): Promise<Customer[] | null> {
  const response = await fetch("/api/clients", { cache: "no-store" });
  if (!response.ok) return null;
  const payload = await response.json() as { customers?: Array<Record<string, unknown>> };
  if (!Array.isArray(payload.customers)) return null;

  return payload.customers.flatMap((row) => {
    const id = Number(row.legacyId);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    return [{
      id,
      name: String(row.name ?? ""),
      phone: String(row.phone ?? ""),
      address: String(row.address ?? ""),
      createdAt: String(row.createdAt ?? new Date().toISOString()),
    }];
  });
}

async function loadRemoteSales(): Promise<Sale[] | null> {
  const response = await fetch("/api/sales", { cache: "no-store" });
  if (!response.ok) return null;
  const payload = await response.json() as { sales?: Array<Record<string, unknown>> };
  if (!Array.isArray(payload.sales)) return null;

  return payload.sales.flatMap((row) => {
    const id = Number(row.id);
    const total = Number(row.total);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(total) || total < 0) return [];
    const paymentMethod = row.paymentMethod;
    if (paymentMethod !== "CASH" && paymentMethod !== "MOBILE_MONEY" && paymentMethod !== "CREDIT") return [];
    return [{
      id,
      date: String(row.date ?? new Date().toISOString()),
      total,
      paymentMethod,
      ...(row.customerId !== null && row.customerId !== undefined ? { customerId: Number(row.customerId) } : {}),
      ...(row.customerName ? { customerName: String(row.customerName) } : {}),
    }];
  });
}

async function cacheRemoteSales(sales: Sale[]): Promise<void> {
  if (sales.length === 0) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SALES_STORE, "readwrite");
    const store = tx.objectStore(SALES_STORE);
    sales.forEach((sale) => store.put(sale));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Mise en cache des ventes annulée.")); };
  });
}

async function loadRemotePayments(): Promise<CreditPayment[] | null> {
  const response = await fetch("/api/credit-payments", { cache: "no-store" });
  if (!response.ok) return null;
  const payload = await response.json() as { payments?: CreditPayment[] };
  return Array.isArray(payload.payments) ? payload.payments : null;
}

async function cacheRemotePayments(payments: CreditPayment[]): Promise<void> {
  if (payments.length === 0) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CREDIT_PAYMENT_STORE, "readwrite");
    const store = tx.objectStore(CREDIT_PAYMENT_STORE);
    payments.forEach((payment) => store.put(payment));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Mise en cache des remboursements annulée.")); };
  });
}

async function syncLocalPayments(payments: CreditPayment[]): Promise<void> {
  for (const payment of payments) {
    const response = await fetch("/api/credit-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legacyId: payment.id,
        saleLegacyId: payment.saleId,
        amount: payment.amount,
        date: payment.date,
        note: payment.note,
      }),
    });
    if (response.status === 404) {
      // The related historical sale may still exist only on this device.
      // Keep that repayment local; never invent or recreate the missing sale.
      continue;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || "Un ancien remboursement n'a pas pu être synchronisé.");
    }
  }
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
    async function initialize() {
      try {
        const localData = await loadData();
        if (!active) return;
        applyData(localData);

        try {
          const remoteCustomers = await loadRemoteCustomers();
          if (remoteCustomers && active) {
            await cacheRemoteCustomers(remoteCustomers);
            const merged = new Map(localData[0].map((customer) => [customer.id, customer]));
            remoteCustomers.forEach((customer) => merged.set(customer.id, customer));
            if (active) setCustomers(Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)));
          }

          // Load authoritative remote sales before displaying debts or accepting repayments.
          // Keep all device-only historical sales; remote rows replace matching legacy IDs.
          const remoteSales = await loadRemoteSales();
          if (remoteSales && active) {
            await cacheRemoteSales(remoteSales);
            const mergedSales = new Map(localData[1].map((sale) => [sale.id, sale]));
            remoteSales.forEach((sale) => mergedSales.set(sale.id, sale));
            if (active) setSales(Array.from(mergedSales.values()).sort((a, b) => b.date.localeCompare(a.date)));
          }

          // Idempotently migrate this device's previously local repayments before loading
          // the authoritative remote history. Existing IDs are preserved as idempotency keys.
          await syncLocalPayments(localData[2]);
          const remotePayments = await loadRemotePayments();
          if (remotePayments && active) {
            await cacheRemotePayments(remotePayments);
            const mergedPayments = new Map(localData[2].map((payment) => [payment.id, payment]));
            remotePayments.forEach((payment) => mergedPayments.set(payment.id, payment));
            if (active) setPayments(Array.from(mergedPayments.values()).sort((a, b) => b.date.localeCompare(a.date)));
          } else if (active) {
            setError("Les remboursements locaux sont conservés, mais Supabase n'a pas renvoyé leur historique.");
          }
        } catch (err) {
          if (active) setError(err instanceof Error ? err.message : "Impossible de synchroniser les clients et remboursements. Les données locales sont conservées.");
        }
      } catch {
        if (active) setError("Impossible de charger les clients et les crédits.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialize();
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
      const customer: Customer = { id: createId(), name: name.trim(), phone: phone.trim(), address: address.trim(), createdAt: new Date().toISOString() };
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legacyId: customer.id, name: customer.name, phone: customer.phone, address: customer.address }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Impossible d'enregistrer le client dans Supabase.");
      await addCustomer(customer);
      await refresh();
      setName(""); setPhone(""); setAddress("");
      setSuccess("Client enregistré dans Supabase et copié sur cet appareil.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'enregistrer ce client.");
    }
  }

  async function handlePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    const value = Number(amount);
    if (!selected || !Number.isInteger(value) || value <= 0) { setError("Choisissez une dette et saisissez un montant entier valide."); return; }
    try {
      const payment: CreditPayment = { id: createId(), saleId: selected.sale.id, customerId: selected.sale.customerId ?? 0, amount: value, date: new Date().toISOString(), note: note.trim() };
      const response = await fetch("/api/credit-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legacyId: payment.id, saleLegacyId: payment.saleId, amount: payment.amount, date: payment.date, note: payment.note }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Impossible d'enregistrer le remboursement dans Supabase.");
      await recordPayment(payment);
      const remotePayments = await loadRemotePayments();
      if (remotePayments) await cacheRemotePayments(remotePayments);
      await refresh(); setSelectedSale(""); setAmount(""); setNote(""); setSuccess("Remboursement enregistré dans Supabase et copié sur cet appareil.");
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
        <p className="mt-6 text-center text-xs text-slate-400">BoutiquePro · Clients, ventes et remboursements synchronisés avec Supabase.</p>
      </div>
    </main>
  );
}
