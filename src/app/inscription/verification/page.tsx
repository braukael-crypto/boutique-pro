import Link from "next/link";

export default function VerificationPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-800">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        <p className="text-4xl">✉️</p>
        <h1 className="mt-4 text-2xl font-extrabold">Vérifiez votre e-mail</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Un lien de confirmation vient de vous être envoyé. Ouvrez-le pour activer votre compte et créer votre boutique BoutiquePro.</p>
        <Link href="/connexion" className="mt-6 inline-block rounded-xl bg-[#173B70] px-5 py-3 font-bold text-white">Retour à la connexion</Link>
      </section>
    </main>
  );
}
