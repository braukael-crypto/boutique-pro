import { Suspense } from "react";
import Link from "next/link";
import { signUpAction } from "@/app/auth/actions";
type PageProps = { searchParams: Promise<{ erreur?: string }> };
async function InscriptionContent({ searchParams }: PageProps) {
  const params = await searchParams;
  const field = "mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-[#12A89D]";
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-800"><section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
    <p className="text-sm font-bold uppercase tracking-wider text-[#12A89D]">BoutiquePro</p><h1 className="mt-3 text-2xl font-extrabold">Demander l'ouverture de ma boutique</h1>
    <p className="mt-2 text-sm text-slate-500">Remplissez ce formulaire. Votre dossier sera étudié par l'administration avant toute activation.</p>
    {params.erreur && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{params.erreur}</p>}
    <form action={signUpAction} className="mt-6 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold sm:col-span-2">Nom de la boutique<input name="shopName" minLength={2} maxLength={100} required className={field}/></label>
      <label className="text-sm font-semibold">Nom du responsable<input name="contactName" minLength={2} maxLength={100} required autoComplete="name" className={field}/></label>
      <label className="text-sm font-semibold">Téléphone / WhatsApp<input name="phone" type="tel" minLength={6} maxLength={40} required className={field}/></label>
      <label className="text-sm font-semibold sm:col-span-2">Adresse e-mail<input name="email" type="email" autoComplete="email" required className={field}/></label>
      <label className="text-sm font-semibold sm:col-span-2">Adresse de la boutique (facultatif)<input name="address" maxLength={300} className={field}/></label>
      <label className="text-sm font-semibold sm:col-span-2">Formule souhaitée<select name="plan" required defaultValue="" className={field}><option value="" disabled>Choisir une formule</option><option value="ESSENTIAL">Essentiel — petite boutique</option><option value="STANDARD">Standard — boutique en croissance</option><option value="PREMIUM">Premium — activité développée</option><option value="ENTERPRISE">Entreprise — plusieurs points de vente</option></select></label>
      <label className="text-sm font-semibold sm:col-span-2">Créer un mot de passe<input name="password" type="password" minLength={8} autoComplete="new-password" required className={field}/><span className="mt-1 block text-xs font-normal text-slate-500">8 caractères minimum. Vous devrez confirmer votre adresse e-mail.</span></label>
      <button className="rounded-xl bg-[#173B70] px-4 py-3 font-bold text-white sm:col-span-2">Envoyer ma demande</button>
    </form><p className="mt-6 text-center text-sm text-slate-500">Vous avez déjà un compte ? <Link className="font-bold text-[#173B70]" href="/connexion">Se connecter</Link></p>
  </section></main>;
}
export default function InscriptionPage({ searchParams }: PageProps) {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-500">Chargement du formulaire…</main>}><InscriptionContent searchParams={searchParams}/></Suspense>;
}
