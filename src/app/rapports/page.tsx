"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { openDatabase, SALES_STORE, EXPENSE_STORE, CREDIT_PAYMENT_STORE } from "@/lib/boutiquepro-db";

type SaleItem = { quantity: number; purchasePrice: number; sellingPrice: number; subtotal: number; estimatedProfit: number };
type Sale = { id: number; date: string; items: SaleItem[]; total: number; estimatedProfit: number; paymentMethod: "CASH" | "MOBILE_MONEY" | "CREDIT" };
type Expense = { id: number; amount: number; category: string; date: string };
type CreditPayment = { id: number; amount: number; date: string };
const money = (value: number) => `${value.toLocaleString("fr-FR")} FCFA`;

async function loadReportData(): Promise<[Sale[], Expense[], CreditPayment[]]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SALES_STORE, EXPENSE_STORE, CREDIT_PAYMENT_STORE], "readonly");
    const salesRequest = tx.objectStore(SALES_STORE).getAll();
    const expensesRequest = tx.objectStore(EXPENSE_STORE).getAll();
    const paymentsRequest = tx.objectStore(CREDIT_PAYMENT_STORE).getAll();
    let sales: Sale[] = [];
    let expenses: Expense[] = [];
    let payments: CreditPayment[] = [];
    salesRequest.onsuccess = () => { sales = salesRequest.result as Sale[]; };
    expensesRequest.onsuccess = () => { expenses = expensesRequest.result as Expense[]; };
    paymentsRequest.onsuccess = () => { payments = paymentsRequest.result as CreditPayment[]; };
    tx.oncomplete = () => { db.close(); resolve([sales, expenses, payments]); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export default function ReportsPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadReportData()
      .then(([loadedSales, loadedExpenses, loadedPayments]) => {
        if (!active) return;
        setSales(loadedSales);
        setExpenses(loadedExpenses);
        setPayments(loadedPayments);
      })
      .catch(() => { if (active) setError("Impossible de charger les rapports."); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const totals = useMemo(() => {
    const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
    const cost = sales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.purchasePrice * item.quantity, 0), 0);
    const grossProfit = sales.reduce((sum, sale) => sum + sale.estimatedProfit, 0);
    const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const collectedSales = sales.filter((sale) => sale.paymentMethod !== "CREDIT").reduce((sum, sale) => sum + sale.total, 0);
    const repayments = payments.reduce((sum, payment) => sum + payment.amount, 0);
    return { revenue, cost, grossProfit, expenseTotal, netResult: grossProfit - expenseTotal, collected: collectedSales + repayments, creditSales: sales.filter((sale) => sale.paymentMethod === "CREDIT").length };
  }, [sales, expenses, payments]);

  const categoryTotals = useMemo(() => {
    const grouped = new Map<string, number>();
    expenses.forEach((expense) => grouped.set(expense.category, (grouped.get(expense.category) ?? 0) + expense.amount));
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  if (!loaded) return <main className="min-h-screen p-6">Calcul des rapports...</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-800 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-2xl bg-[#173B70] p-6 text-white">
          <Link href="/" className="text-sm text-blue-100">← Tableau de bord</Link>
          <h1 className="mt-3 text-2xl font-extrabold">Rapports et rentabilité</h1>
          <p className="mt-2 text-sm text-blue-100">Vue globale des ventes, marges, dépenses et encaissements enregistrés.</p>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-3">
          <article className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Chiffre d'affaires</p><p className="mt-2 text-lg font-extrabold">{money(totals.revenue)}</p></article>
          <article className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Coût d'achat vendu</p><p className="mt-2 text-lg font-extrabold">{money(totals.cost)}</p></article>
          <article className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Marge brute estimée</p><p className="mt-2 text-lg font-extrabold text-emerald-700">{money(totals.grossProfit)}</p></article>
          <article className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Dépenses enregistrées</p><p className="mt-2 text-lg font-extrabold text-red-700">{money(totals.expenseTotal)}</p></article>
        </section>

        <section className="mt-4 rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Résultat estimé après dépenses</p>
          <p className={`mt-2 text-3xl font-extrabold ${totals.netResult >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money(totals.netResult)}</p>
          <p className="mt-2 text-xs text-slate-500">Marge brute estimée moins les dépenses enregistrées. Ce résultat ne tient pas encore compte des impôts, amortissements ni des autres charges non saisies.</p>
        </section>

        <section className="mt-4 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Encaissements et crédits</h2>
          <div className="mt-3 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Espèces, Mobile Money et remboursements reçus</span><strong className="text-right">{money(totals.collected)}</strong></div>
          <p className="mt-2 text-xs text-slate-500">{totals.creditSales} vente(s) à crédit enregistrée(s). Le chiffre d'affaires inclut ces ventes, mais les encaissements ne les comptent qu'au fur et à mesure des remboursements.</p>
        </section>

        <section className="mt-4 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Dépenses par catégorie</h2>
          <div className="mt-3 space-y-3">
            {categoryTotals.length === 0 && <p className="text-sm text-slate-500">Aucune dépense enregistrée.</p>}
            {categoryTotals.map(([category, amount]) => <div key={category} className="flex justify-between gap-3 border-b pb-2 text-sm"><span>{category}</span><strong>{money(amount)}</strong></div>)}
          </div>
        </section>

        <section className="mt-4 rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Activité enregistrée</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><p className="text-slate-500">Nombre de ventes<br /><strong className="text-xl text-slate-800">{sales.length}</strong></p><p className="text-slate-500">Nombre de dépenses<br /><strong className="text-xl text-slate-800">{expenses.length}</strong></p></div>
        </section>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3"><Link href="/depenses" className="rounded-xl bg-[#173B70] p-3 text-center text-sm font-bold text-white">Gérer les dépenses</Link><Link href="/ventes" className="rounded-xl border bg-white p-3 text-center text-sm font-bold text-[#173B70]">Voir les ventes</Link></div>
        <p className="mt-6 text-center text-xs text-slate-400">BoutiquePro · Rapports calculés à partir des données locales.</p>
      </div>
    </main>
  );
}
