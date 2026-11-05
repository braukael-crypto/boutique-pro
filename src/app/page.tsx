import { Suspense } from "react";

// Le tableau de bord dépend de la session Supabase et doit être rendu à la demande.
export const instant = false;
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/auth/actions";

const modules = [
  { icon: "🛒", label: "Ventes", href: "/ventes" },
  { icon: "📦", label: "Produits et stock", href: "/stock" },
  { icon: "👥", label: "Clients et crédits", href: "/clients" },
  { icon: "💰", label: "Dépenses", href: "/depenses" },
  { icon: "📊", label: "Rapports", href: "/rapports" },
  { icon: "⚙️", label: "Paramètres", href: "/parametres" },
];

async function DashboardContent() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-800">
      <header className="rounded-2xl bg-[#173B70] p-6 text-white">
        <h1 className="text-2xl font-extrabold">BoutiquePro</h1>
        <p className="mt-2 text-sm text-blue-100">
          Gestion commerciale simplifiée
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-blue-100">{user?.email ?? "Compte BoutiquePro"}</p>
          <form action={signOutAction}>
            <button className="rounded-lg border border-white/40 px-3 py-2 text-xs font-semibold text-white">
              Déconnexion
            </button>
          </form>
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">Bienvenue 👋</h2>
        <p className="mt-2 text-sm text-slate-500">
          Gérez votre boutique depuis votre téléphone.
        </p>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4">
        {modules.map((module) => (
          <Link
            key={module.label}
            href={module.href}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
          >
            <div className="text-3xl">{module.icon}</div>
            <h3 className="mt-3 font-bold">{module.label}</h3>
          </Link>
        ))}
      </section>

      <p className="mt-8 text-center text-xs text-slate-400">
        BoutiquePro · Votre commerce, mieux organisé.
      </p>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50 p-5 text-slate-500">Chargement de votre boutique…</main>}>
      <DashboardContent />
    </Suspense>
  );
}
