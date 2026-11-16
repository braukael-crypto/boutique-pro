"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseBillingData, type BillingData } from "@/lib/subscriptions/billing-data";

const BILLING_LOAD_TIMEOUT_MS = 15_000;

const amountLabel = (value: number | string, currency = "XOF") =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value)) +
  (currency === "XOF" ? " F CFA" : ` ${currency}`);

const dateLabel = (value: string | null) => value
  ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value))
  : "—";

const statuses: Record<string, string> = {
  TRIALING: "Essai gratuit",
  ACTIVE: "Actif",
  PAST_DUE: "Paiement à renouveler",
  EXPIRED: "Expiré",
  CANCELED: "Résilié",
  PENDING: "En attente",
  PAID: "Payé",
  FAILED: "Échoué",
  CANCELLED: "Annulé",
  REFUNDED: "Remboursé",
};

export default function AbonnementsPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("");
  const [startingPayment, setStartingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [now, setNow] = useState<number | null>(null);

  const loadBilling = useCallback(async (controller: AbortController) => {
    setError("");
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, BILLING_LOAD_TIMEOUT_MS);

    try {
      const response = await fetch("/api/subscriptions", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });

      if (response.redirected) {
        throw new Error("La session a expiré. Reconnectez-vous puis réessayez.");
      }

      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("La réponse de facturation n’est pas au format JSON.");
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("La réponse de facturation est illisible.");
      }

      if (!response.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Impossible de charger la facturation (HTTP ${response.status}).`;
        throw new Error(message);
      }

      const result = parseBillingData(payload);
      setData(result);
      const pendingPlan = result.payments.find((payment) => payment.status === "PENDING")?.plan;
      setSelectedPlan((current) => current || pendingPlan || result.subscription?.plan || result.plans[0]?.code || "");
    } catch (loadError) {
      if (timedOut) {
        setError("Le chargement de la facturation a dépassé 15 secondes. Vérifiez votre connexion puis réessayez.");
      } else if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : "Impossible de charger la facturation.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (!controller.signal.aborted || timedOut) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      void loadBilling(controller);
    });
    return () => controller.abort();
  }, [loadBilling]);

  useEffect(() => {
    const id = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(id);
  }, []);

  const currentPlan = useMemo(
    () => data?.plans.find((plan) => plan.code === data.subscription?.plan),
    [data],
  );
  const periodEnd = data?.subscription?.status === "TRIALING"
    ? data.subscription.trialEndsAt
    : data?.subscription?.currentPeriodEnd;
  const remainingDays = periodEnd && now !== null
    ? Math.max(0, Math.ceil((new Date(periodEnd).getTime() - now) / 86_400_000))
    : null;

  async function startManualPayment() {
    if (!selectedPlan || startingPayment) return;
    setStartingPayment(true);
    setPaymentMessage("");
    try {
      const response = await fetch("/api/subscriptions/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Le paiement n'a pas pu démarrer.");
      if (typeof result.checkoutUrl !== "string") throw new Error("Lien de paiement indisponible.");
      window.location.assign(result.checkoutUrl);
    } catch (paymentError) {
      setPaymentMessage(paymentError instanceof Error ? paymentError.message : "Le paiement n'a pas pu démarrer.");
      setStartingPayment(false);
    }
  }

  const pendingPayments = data?.payments.filter((payment) => payment.status === "PENDING") ?? [];

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/boutique" className="text-sm font-semibold text-[#173B70]">← Retour à la boutique</Link>
        <header className="mt-5 rounded-2xl bg-[#173B70] p-6 text-white">
          <p className="text-sm font-semibold text-blue-100">Espace boutique</p>
          <h1 className="mt-1 text-2xl font-extrabold">Abonnement et facturation</h1>
          <p className="mt-2 text-sm text-blue-100">Renouvellement manuel : aucun prélèvement automatique n’est activé.</p>
        </header>

        {loading && <p className="mt-6 rounded-xl bg-white p-5 text-slate-600">Chargement des informations de facturation…</p>}
        {!loading && error && <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><p role="alert">{error}</p>{error.includes("réservé") || error.includes("Aucune boutique") ? null : <button onClick={() => void loadBilling(new AbortController())} className="mt-3 font-semibold underline">Réessayer</button>}</section>}

        {!loading && data && <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Formule actuelle</p>
              <h2 className="mt-2 text-xl font-extrabold">{currentPlan?.name ?? data.subscription?.plan ?? "Aucune formule"}</h2>
              {currentPlan && <p className="mt-1 text-sm text-slate-600">{amountLabel(currentPlan.monthlyAmount, currentPlan.currency)} / mois</p>}
              <p className="mt-4"><span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-[#173B70]">{statuses[data.subscription?.status ?? ""] ?? data.subscription?.status ?? "Non configuré"}</span></p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Période en cours</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">Début</dt><dd className="mt-1 font-semibold">{dateLabel(data.subscription?.status === "TRIALING" ? data.subscription.trialStartedAt : data.subscription?.currentPeriodStart ?? null)}</dd></div>
                <div><dt className="text-slate-500">Échéance</dt><dd className="mt-1 font-semibold">{dateLabel(periodEnd ?? null)}</dd></div>
              </dl>
              <p className="mt-4 text-sm text-slate-600">Jours restants : <strong>{remainingDays ?? "—"}</strong></p>
            </article>
          </section>

          {pendingPayments.length > 0 && <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-bold text-amber-950">Paiement en attente</h2>
            <p className="mt-1 text-sm text-amber-900">{pendingPayments.length} tentative(s) de paiement attendent la confirmation du serveur. Ne relancez pas un paiement déjà ouvert.</p>
          </section>}

          <section className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-xl font-extrabold">Choisir une formule</h2><p className="mt-1 text-sm text-slate-600">Tarifs mensuels enregistrés dans le catalogue BoutiquePro.</p></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.plans.map((plan) => <button key={plan.code} type="button" onClick={() => setSelectedPlan(plan.code)} className={`rounded-2xl border bg-white p-5 text-left shadow-sm ${selectedPlan === plan.code ? "border-[#173B70] ring-2 ring-blue-100" : "border-slate-200"}`}>
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{plan.code}</span>
                <span className="mt-2 block text-lg font-bold">{plan.name}</span>
                <span className="mt-3 block text-xl font-extrabold text-[#173B70]">{amountLabel(plan.monthlyAmount, plan.currency)}<span className="text-xs font-medium text-slate-500"> / mois</span></span>
              </button>)}
            </div>
            <p className="mt-3 text-xs text-slate-500">Les fonctionnalités propres à chaque formule ne sont pas détaillées ici car elles ne sont pas définies dans le catalogue métier existant.</p>
            <div className="mt-4 rounded-2xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-950">Les abonnements sont prépayés. Le renouvellement est déclenché manuellement par un OWNER ou un MANAGER ; aucune reconduction automatique n’est effectuée.</div>
            <button type="button" disabled={!selectedPlan || startingPayment} onClick={() => void startManualPayment()} className="mt-4 rounded-xl bg-[#173B70] px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{startingPayment ? "Préparation du paiement…" : pendingPayments.length > 0 ? "Paiement en attente de confirmation" : "Payer en ligne (SasPay)"}</button>
            {paymentMessage && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">{paymentMessage}</p>}
            <p className="mt-2 text-xs text-slate-500">Le retour du navigateur ne confirme jamais un paiement. L’abonnement est activé uniquement après vérification serveur et validation sécurisée du webhook SasPay.</p>
          </section>

          <section className="mt-9">
            <h2 className="text-xl font-extrabold">Historique des paiements</h2>
            {data.payments.length === 0 ? <p className="mt-3 rounded-xl bg-white p-5 text-sm text-slate-600">Aucun paiement enregistré.</p> : <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Formule</th><th className="p-3">Montant</th><th className="p-3">Statut</th><th className="p-3">Période payée</th></tr></thead>
                <tbody>{data.payments.map((payment) => <tr key={payment.id} className="border-t border-slate-100"><td className="p-3">{dateLabel(payment.paidAt ?? payment.createdAt)}</td><td className="p-3">{payment.plan}</td><td className="p-3">{amountLabel(payment.amount, payment.currency)}</td><td className="p-3">{statuses[payment.status] ?? payment.status}</td><td className="p-3">{payment.periodStart ? `${dateLabel(payment.periodStart)} – ${dateLabel(payment.periodEnd)}` : "—"}</td></tr>)}</tbody>
              </table>
            </div>}
          </section>
        </>}
      </div>
    </main>
  );
}
