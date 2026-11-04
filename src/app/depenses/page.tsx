"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { openDatabase, EXPENSE_STORE } from "@/lib/boutiquepro-db";

type Expense = {
  id: number;
  label: string;
  category: string;
  amount: number;
  date: string;
  note: string;
};

const CATEGORIES = ["Approvisionnement", "Loyer", "Électricité et eau", "Transport", "Salaires", "Communication", "Entretien", "Autre"];
const money = (value: number) => `${value.toLocaleString("fr-FR")} FCFA`;

async function getExpenses(): Promise<Expense[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPENSE_STORE, "readonly");
    const request = tx.objectStore(EXPENSE_STORE).getAll();
    request.onsuccess = () => resolve((request.result as Expense[]).sort((a, b) => b.date.localeCompare(a.date)));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function saveExpense(expense: Expense): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPENSE_STORE, "readwrite");
    tx.objectStore(EXPENSE_STORE).add(expense);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Enregistrement annulé.")); };
    tx.onerror = () => { db.close(); };
  });
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    getExpenses()
      .then((data) => { if (active) setExpenses(data); })
      .catch(() => { if (active) setError("Impossible de charger les dépenses."); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const total = useMemo(() => expenses.reduce((sum, item) => sum + item.amount, 0), [expenses]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const value = Number(amount);
    if (!label.trim() || !Number.isInteger(value) || value <= 0 || !date) {
      setError("Saisissez un libellé, un montant entier positif et une date.");
      return;
    }
    try {
      await saveExpense({
        id: Date.now(),
        label: label.trim(),
        category,
        amount: value,
        date: new Date(`${date}T12:00:00`).toISOString(),
        note: note.trim(),
      });
      setExpenses(await getExpenses());
      setLabel("");
      setAmount("");
      setNote("");
      setSuccess("Dépense enregistrée avec succès.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'enregistrer cette dépense.");
    }
  }

  if (!loaded) return <main className="min-h-screen p-6">Chargement des dépenses...</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-800 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-2xl bg-[#173B70] p-6 text-white">
          <Link href="/" className="text-sm text-blue-100">← Tableau de bord</Link>
          <h1 className="mt-3 text-2xl font-extrabold">Gestion des dépenses</h1>
          <p className="mt-2 text-sm text-blue-100">Enregistrez les charges de votre boutique et suivez leur évolution.</p>
        </header>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total des dépenses enregistrées</p>
          <p className="mt-2 text-2xl font-extrabold text-red-700">{money(total)}</p>
          <p className="mt-1 text-xs text-slate-500">{expenses.length} dépense(s) enregistrée(s) sur cet appareil.</p>
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Ajouter une dépense</h2>
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <label className="block text-sm font-semibold">Libellé *
              <input required value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Ex. : Achat de sacs d'emballage" />
            </label>
            <label className="block text-sm font-semibold">Catégorie
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border bg-white p-3 font-normal">
                {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">Montant (FCFA) *
              <input required type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Ex. : 2500" />
            </label>
            <label className="block text-sm font-semibold">Date *
              <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" />
            </label>
            <label className="block text-sm font-semibold">Note (facultatif)
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Précisions sur la dépense" />
            </label>
            <button type="submit" className="w-full rounded-xl bg-[#173B70] p-3 font-bold text-white">Enregistrer la dépense</button>
          </form>
        </section>

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Historique des dépenses</h2>
          <div className="mt-4 space-y-3">
            {expenses.length === 0 && <p className="text-sm text-slate-500">Aucune dépense enregistrée.</p>}
            {expenses.map((expense) => (
              <article key={expense.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-bold">{expense.label}</h3><p className="text-xs text-slate-500">{expense.category} · {new Date(expense.date).toLocaleDateString("fr-FR")}</p></div>
                  <strong className="text-right text-red-700">{money(expense.amount)}</strong>
                </div>
                {expense.note && <p className="mt-2 text-sm text-slate-500">{expense.note}</p>}
              </article>
            ))}
          </div>
        </section>
        {(error || success) && <p className={error ? "mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" : "mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700"}>{error || success}</p>}
        <p className="mt-6 text-center text-xs text-slate-400">BoutiquePro · Données locales sur cet appareil.</p>
      </div>
    </main>
  );
}
