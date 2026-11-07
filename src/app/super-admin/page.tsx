import Link from "next/link";
import { connection } from "next/server";
import { signOutAction } from "@/app/auth/actions";
import { createSuperAdminClient } from "@/lib/supabase/admin";

// Cette page utilise la session et les données serveur : elle doit être rendue à la demande.
export const instant = false;

export default async function SuperAdminPage() {
  await connection();

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let shops: Array<{
    id: string;
    name: string;
    slug: string;
    phone: string | null;
    whatsapp: string | null;
    address: string | null;
    currency: string;
    createdAt: string;
  }> = [];
  let loadError = "";

  if (!serviceKey) {
    loadError = "La clé serveur Supabase manque. Ajoutez SUPABASE_SERVICE_ROLE_KEY dans .env.local (et dans l’hébergement).";
  } else {
    const supabase = createSuperAdminClient();
    const { data, error } = await supabase
      .from("shops")
      .select("id,name,slug,phone,whatsapp,address,currency,createdAt")
      .order("createdAt", { ascending: false });

    if (error) {
      loadError = "Impossible de charger les boutiques. Vérifiez la configuration serveur et les droits de la base.";
    } else {
      shops = data ?? [];
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl bg-[#173B70] p-6 text-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-200">CMR · Administration centrale</p>
              <h1 className="mt-2 text-3xl font-extrabold">BoutiquePro Super Admin</h1>
              <p className="mt-2 text-sm text-blue-100">Gestion centrale des boutiques de la plateforme.</p>
            </div>
            <form action={signOutAction}>
              <button className="rounded-xl border border-white/40 px-4 py-2 text-sm font-semibold text-white">Déconnexion</button>
            </form>
          </div>
        </header>

        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Boutiques inscrites</h2>
              <p className="mt-1 text-sm text-slate-500">Vue globale des boutiques enregistrées dans BoutiquePro.</p>
            </div>
            <p className="rounded-xl bg-white px-4 py-2 text-sm font-bold shadow-sm">{shops.length} boutique(s)</p>
          </div>

          {loadError ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-bold">Configuration nécessaire</p>
              <p className="mt-2">{loadError}</p>
              <p className="mt-2">Cette clé est strictement réservée au serveur. Ne la placez jamais dans une variable NEXT_PUBLIC et ne la partagez pas.</p>
            </div>
          ) : shops.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Aucune boutique n’est encore enregistrée.
            </div>
          ) : (
            <div className="mt-4 grid gap-4">
              {shops.map((shop) => (
                <article key={shop.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">{shop.name}</h3>
                      <p className="text-sm text-slate-500">/{shop.slug}</p>
                    </div>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">Enregistrée</span>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-slate-500">Téléphone</dt><dd className="font-medium">{shop.phone || "Non renseigné"}</dd></div>
                    <div><dt className="text-slate-500">WhatsApp</dt><dd className="font-medium">{shop.whatsapp || "Non renseigné"}</dd></div>
                    <div><dt className="text-slate-500">Adresse</dt><dd className="font-medium">{shop.address || "Non renseignée"}</dd></div>
                    <div><dt className="text-slate-500">Devise</dt><dd className="font-medium">{shop.currency}</dd></div>
                    <div><dt className="text-slate-500">Inscription</dt><dd className="font-medium">{new Date(shop.createdAt).toLocaleDateString("fr-FR")}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-8 flex gap-4 text-sm">
          <Link href="/" className="font-semibold text-[#173B70]">← Espace boutique</Link>
        </footer>
      </div>
    </main>
  );
}
