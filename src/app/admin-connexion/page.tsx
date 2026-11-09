import { Suspense } from "react";
import { signInSuperAdminAction } from "@/app/super-admin/auth-actions";

type PageProps = {
  searchParams: Promise<{ erreur?: string }>;
};

async function AdminLoginContent({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-5 text-slate-800">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#D9A441]">
            CMR GROUP
          </p>
          <h1 className="mt-3 text-2xl font-extrabold text-[#173B70]">
            Administration générale
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Espace privé réservé au Super Administrateur de BoutiquePro.
          </p>
        </div>

        {params.erreur && (
          <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {params.erreur}
          </p>
        )}

        <form action={signInSuperAdminAction} className="space-y-4">
          <label className="block text-sm font-semibold">
            Adresse e-mail administrateur
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-[#D9A441]"
            />
          </label>

          <label className="block text-sm font-semibold">
            Mot de passe
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-[#D9A441]"
            />
          </label>

          <button className="w-full rounded-xl bg-[#173B70] px-4 py-3 font-bold text-white transition hover:bg-[#244f8d]">
            Accéder à l'administration
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Accès sécurisé · CMR GROUP
        </p>
      </section>
    </main>
  );
}

export default function AdminConnexionPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Chargement…</main>}>
      <AdminLoginContent searchParams={searchParams} />
    </Suspense>
  );
}
