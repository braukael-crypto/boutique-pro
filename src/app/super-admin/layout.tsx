import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/super-admin";


export default async function SuperAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/connexion?next=/super-admin");
  }

  if (!isSuperAdmin(user)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-800">
        <section className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-extrabold">Accès réservé</h1>
          <p className="mt-3 text-sm text-slate-600">
            Ce compte n’est pas autorisé à accéder à l’administration générale de BoutiquePro.
          </p>
          <a href="/" className="mt-5 inline-block rounded-xl bg-[#173B70] px-4 py-3 text-sm font-bold text-white">
            Retour à BoutiquePro
          </a>
        </section>
      </main>
    );
  }

  return children;
}
