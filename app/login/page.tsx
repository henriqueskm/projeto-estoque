import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f7f4] px-4 py-10 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute -left-20 -top-20 size-72 rounded-full bg-emerald-200/45 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-24 -right-20 size-80 rounded-full bg-sky-200/35 blur-3xl"
      />

      <section className="relative w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.3)] sm:p-9">
        <div className="flex size-13 items-center justify-center rounded-2xl bg-emerald-700 text-base font-extrabold text-white shadow-sm">
          NK
        </div>

        <div className="mt-7">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">
            Bem-vindo
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl">
            Negócios K
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            Controle inteligente de estoque
          </p>
        </div>

        {error === "inactive" ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
          >
            Seu perfil não está ativo. Procure o responsável pelo sistema.
          </div>
        ) : null}

        <LoginForm />

        <p className="mt-7 text-center text-xs leading-5 text-slate-500">
          Acesso restrito a usuários autorizados.
        </p>
      </section>
    </main>
  );
}
