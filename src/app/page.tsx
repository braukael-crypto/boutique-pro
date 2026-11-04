import Link from "next/link";

const modules = [
  { icon: "🛒", label: "Ventes", href: "/ventes" },
  { icon: "📦", label: "Produits et stock", href: "/stock" },
  { icon: "👥", label: "Clients et crédits", href: "/clients" },
  { icon: "💰", label: "Dépenses" },
  { icon: "📊", label: "Rapports" },
  { icon: "⚙️", label: "Paramètres" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-800">
      <header className="rounded-2xl bg-[#173B70] p-6 text-white">
        <h1 className="text-2xl font-extrabold">BoutiquePro</h1>
        <p className="mt-2 text-sm text-blue-100">
          Gestion commerciale simplifiée
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">Bienvenue 👋</h2>
        <p className="mt-2 text-sm text-slate-500">
          Gérez votre boutique depuis votre téléphone.
        </p>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4">
        {modules.map((module) => {
          const content = (
            <>
              <div className="text-3xl">{module.icon}</div>
              <h3 className="mt-3 font-bold">{module.label}</h3>
            </>
          );

          return module.href ? (
            <Link
              key={module.label}
              href={module.href}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
            >
              {content}
            </Link>
          ) : (
            <div
              key={module.label}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              {content}
            </div>
          );
        })}
      </section>

      <p className="mt-8 text-center text-xs text-slate-400">
        BoutiquePro · Votre commerce, mieux organisé.
      </p>
    </main>
  );
}
