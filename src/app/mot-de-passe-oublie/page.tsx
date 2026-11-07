import Link from "next/link";
import { requestPasswordResetAction } from "@/app/auth/actions";

type PageProps = {
  searchParams: Promise<{ erreur?: string; message?: string }>;
};

export default async function MotDePasseOubliePage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-800">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-wider text-[#12A89D]">BoutiquePro</p>
        <h1 className="mt-3 text-2xl font-extrabold">Mot de passe oublié</h1>
        <p className="mt-2 text-sm text-slate-500">Saisissez l'adresse e-mail de votre compte. Nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
        {params.erreur && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{params.erreur}</p>}
        {params.message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{params.message}</p>}
        <form action={requestPasswordResetAction} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold">Adresse e-mail
            <input name="email" type="email" autoComplete="email" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-[#12A89D]" />
          </label>
          <button className="w-full rounded-xl bg-[#173B70] px-4 py-3 font-bold text-white">Envoyer le lien de récupération</button>
        </form>
        <p className="mt-6 text-center text-sm"><Link className="font-semibold text-[#173B70] underline" href="/connexion">Retour à la connexion</Link></p>
      </section>
    </main>
  );
}
