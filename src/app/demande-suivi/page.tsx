import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cette page dépend de la session Supabase et doit être rendue à la demande.
export const instant = false;

const labels: Record<string,string> = { ESSENTIAL:"Essentiel", STANDARD:"Standard", PREMIUM:"Premium", ENTERPRISE:"Entreprise" };
const statuses: Record<string,string> = { PENDING:"En attente de traitement", UNDER_REVIEW:"En cours d'étude", REJECTED:"Demande à compléter ou refusée", APPROVED:"Demande approuvée" };

export default async function DemandeSuiviPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/connexion?next=/demande-suivi");
  const { data: membership } = await supabase.from("shop_memberships").select("shopId").eq("userId", user.id).limit(1).maybeSingle();
  if (membership?.shopId) redirect("/boutique");
  const { data: application, error } = await supabase.from("shop_applications")
    .select("shopName,plan,status,adminNote,createdAt").eq("userId", user.id).maybeSingle();

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-800">
    <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-wider text-[#12A89D]">BoutiquePro</p>
      <h1 className="mt-3 text-2xl font-extrabold">Suivi de ma demande</h1>
      {error || !application ? <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Votre demande n&apos;est pas encore visible. Si vous venez de confirmer votre e-mail, actualisez cette page dans quelques instants. Sinon, contactez le support.</p> : <>
        <div className="mt-5 rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-500">Boutique demandée</p><p className="mt-1 text-lg font-bold">{application.shopName}</p><p className="mt-2 text-sm text-slate-600">Formule : {labels[application.plan] ?? application.plan}</p></div>
        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4"><p className="font-bold text-[#173B70]">{statuses[application.status] ?? "En attente"}</p><p className="mt-2 text-sm text-slate-700">Votre espace commercial sera accessible uniquement après validation par l&apos;administration.</p></div>
        {application.adminNote && <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Message de l&apos;administration : {application.adminNote}</p>}
        <p className="mt-4 text-xs text-slate-400">Demande déposée le {new Date(application.createdAt).toLocaleDateString("fr-FR")}</p>
      </>}
      <div className="mt-6"><Link href="/" className="font-semibold text-[#173B70]">Retour au site public</Link></div>
    </section>
  </main>;
}
