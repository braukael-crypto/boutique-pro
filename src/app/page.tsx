import Link from "next/link";

const features = [
  { icon: "🛒", title: "Ventes simplifiées", text: "Enregistrez vos ventes et suivez vos recettes au quotidien." },
  { icon: "📦", title: "Stock maîtrisé", text: "Suivez vos produits, quantités disponibles et mouvements de stock." },
  { icon: "👥", title: "Clients et crédits", text: "Retrouvez vos clients et gardez une vue claire sur les ventes à crédit." },
  { icon: "🚚", title: "Fournisseurs", text: "Centralisez les coordonnées de vos fournisseurs et retrouvez-les sur vos appareils." },
  { icon: "📊", title: "Suivi d'activité", text: "Consultez vos dépenses et rapports pour mieux piloter votre commerce." },
  { icon: "☁️", title: "Données synchronisées", text: "Retrouvez les données synchronisées de votre boutique sur vos différents appareils." },
];

const steps = [
  ["01", "Présentez votre boutique", "Préparez les informations de votre commerce et choisissez votre formule."],
  ["02", "Validation et activation", "Votre dossier et votre paiement sont vérifiés avant l'ouverture de l'accès."],
  ["03", "Gérez votre activité", "Accédez à vos outils de vente, de stock, de clients et de suivi."],
];

export default function PublicHomePage() {
  return (
    <main className="min-h-screen bg-white text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-xl font-black tracking-tight text-[#173B70]">Boutique<span className="text-[#12A89D]">Pro</span></Link>
          <nav className="flex items-center gap-3">
            <a href="#fonctionnalites" className="hidden text-sm font-semibold text-slate-600 sm:inline">Fonctionnalités</a>
            <a href="#fonctionnement" className="hidden text-sm font-semibold text-slate-600 sm:inline">Comment ça marche</a>
            <div className="flex items-center gap-2"><Link href="/inscription" className="hidden rounded-xl border border-[#173B70] px-3 py-2.5 text-sm font-bold text-[#173B70] sm:inline">Ouvrir une boutique</Link><Link href="/connexion" className="rounded-xl bg-[#173B70] px-4 py-2.5 text-sm font-bold text-white">Connexion</Link></div>
          </nav>
        </div>
      </header>

      <section className="overflow-hidden bg-[#102D55] text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-16 sm:py-24 lg:grid-cols-2">
          <div>
            <p className="inline-flex rounded-full border border-teal-300/40 bg-teal-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">La gestion de votre commerce, simplement</p>
            <h1 className="mt-6 max-w-2xl text-4xl font-black leading-tight sm:text-5xl lg:text-6xl">Votre boutique mérite une gestion <span className="text-teal-300">plus simple.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-blue-100 sm:text-lg">BoutiquePro rassemble vos ventes, votre stock, vos clients, vos fournisseurs et vos dépenses dans un seul espace accessible depuis votre téléphone ou votre ordinateur.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/inscription" className="rounded-xl bg-[#12A89D] px-6 py-3.5 font-bold text-white shadow-lg shadow-black/10">Demander l’ouverture de ma boutique</Link>
              <a href="#fonctionnalites" className="rounded-xl border border-white/30 px-6 py-3.5 font-bold text-white">Découvrir les fonctionnalités</a>
            </div>
            <p className="mt-4 text-xs text-blue-200">L&apos;ouverture de nouveaux comptes sera proposée après mise en place du parcours de demande et de validation.</p>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur">
            <div className="rounded-2xl bg-white p-5 text-slate-800">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Aperçu de l&apos;espace boutique</p><p className="mt-1 text-xl font-extrabold text-[#173B70]">Tableau de bord</p></div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">En activité</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  ["🛒", "Ventes", "Suivi quotidien"],
                  ["📦", "Stock", "Produits"],
                  ["👥", "Clients", "Fichier client"],
                  ["📊", "Rapports", "Résultats"],
                ].map(([icon, title, detail]) => <div key={title} className="rounded-xl border border-slate-100 bg-slate-50 p-4"><span className="text-2xl">{icon}</span><p className="mt-3 font-bold">{title}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>)}
              </div>
              <p className="mt-4 rounded-xl bg-[#173B70] px-4 py-3 text-center text-sm font-semibold text-white">Tous vos outils au même endroit</p>
            </div>
          </div>
        </div>
      </section>

      <section id="fonctionnalites" className="mx-auto max-w-7xl px-5 py-16 sm:py-20">
        <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-widest text-[#12A89D]">Fonctionnalités</p><h2 className="mt-3 text-3xl font-black text-[#173B70] sm:text-4xl">Les essentiels pour piloter votre boutique</h2><p className="mt-4 leading-7 text-slate-600">Une vue organisée de vos opérations pour gagner du temps et mieux suivre votre activité.</p></div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => <article key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><span className="text-3xl">{feature.icon}</span><h3 className="mt-4 text-lg font-extrabold text-[#173B70]">{feature.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{feature.text}</p></article>)}
        </div>
      </section>

      <section id="fonctionnement" className="bg-slate-50 px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl"><p className="text-sm font-bold uppercase tracking-widest text-[#12A89D]">Démarrage</p><h2 className="mt-3 text-3xl font-black text-[#173B70] sm:text-4xl">Un parcours clair, en trois étapes</h2><div className="mt-9 grid gap-5 md:grid-cols-3">{steps.map(([number, title, text]) => <article key={number} className="rounded-2xl border border-slate-200 bg-white p-6"><p className="text-3xl font-black text-[#12A89D]">{number}</p><h3 className="mt-4 text-lg font-extrabold text-[#173B70]">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></article>)}</div></div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16 text-center sm:py-20">
        <h2 className="text-3xl font-black text-[#173B70] sm:text-4xl">Prêt à mieux organiser votre commerce ?</h2>
        <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-600">Connectez-vous à votre espace si votre boutique dispose déjà d&apos;un accès BoutiquePro.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3"><Link href="/inscription" className="inline-flex rounded-xl bg-[#173B70] px-7 py-3.5 font-bold text-white">Demander l’ouverture</Link><Link href="/connexion" className="inline-flex rounded-xl border border-slate-300 px-7 py-3.5 font-bold text-[#173B70]">Déjà client ? Connexion</Link></div>
      </section>

      <footer className="bg-[#102D55] px-5 py-8 text-center text-sm text-blue-100"><p className="font-bold text-white">BoutiquePro · CMR GROUP</p><p className="mt-2">Votre commerce, mieux organisé.</p></footer>
    </main>
  );
}
