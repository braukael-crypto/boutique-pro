import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/auth/actions";

export const dynamic = "force-dynamic";

const sections = [
  {
    title: "Boutiques inscrites",
    description: "Consulter les boutiques et leur statut.",
    status: "À connecter",
  },
  {
    title: "Abonnements et paiements",
    description: "Gérer les offres Free, Essentiel, Business et Premium.",
    status: "À développer",
  },
  {
    title: "Utilisateurs",
    description: "Consulter les comptes et gérer les accès.",
    status: "À développer",
  },
  {
    title: "Statistiques globales",
    description: "Suivre les inscriptions et l’activité de la plateforme.",
    status: "À développer",
  },
];

export default async function SuperAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-2xl bg-[#173B70] p-6 text-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-200">CMR · Administration centrale</p>
              <h1 className="mt-2 text-3xl font-extrabold">BoutiquePro Super Admin</h1>
              <p className="mt-2 text-sm text-blue-100">Espace privé de gestion de la plateforme.</p>
            </div>
            <form action={signOutAction}>
              <button className="rounded-xl border border-white/40 px-4 py-2 text-sm font-semibold text-white">
                Déconnexion
              </button>
            </form>
          </div>
          <p className="mt-5 border-t border-white/20 pt-4 text-sm text-blue-100">
            Administrateur connecté : {user?.email}
          </p>
        </header>

        <section className="mt-6">
          <h2 className="text-xl font-bold">Pilotage de la plateforme</h2>
          <p className="mt-1 text-sm text-slate-500">
            Le portail est créé. Les fonctions de gestion seront activées après la sécurisation des accès et des données.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {sections.map((section) => (
              <article key={section.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold">{section.title}</h3>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                    {section.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">{section.description}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link href="/" className="font-semibold text-[#173B70]">← Espace boutique</Link>
        </footer>
      </div>
    </main>
  );
}
