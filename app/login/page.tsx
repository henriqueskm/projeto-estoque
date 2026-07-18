import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <main className="nk-industrial-grid relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-charcoal px-4 py-8 sm:px-6 sm:py-12">
      <div
        aria-hidden="true"
        className="absolute -top-40 -left-32 size-96 rounded-full bg-brand-gold/12 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -right-32 -bottom-48 size-[30rem] rounded-full bg-brand-gold-dark/14 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandMark variant="full" size="lg" inverted />
        </div>

        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-surface p-6 shadow-[0_30px_90px_-36px_rgba(0,0,0,0.9)] sm:p-9">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1.5 bg-brand-gold"
          />

          <div>
            <p className="text-xs font-black tracking-[0.2em] text-brand-gold-ink uppercase">
              Sistema interno
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-text-primary sm:text-4xl">
              Acesse o estoque
            </h1>
            <p className="mt-3 text-base leading-7 text-text-muted">
              Entre com seu usuário para continuar no Negócios K.
            </p>
          </div>

          {error === "inactive" ? (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950"
            >
              Seu perfil não está ativo. Procure o responsável pelo sistema.
            </div>
          ) : null}

          <LoginForm />

          <div className="mt-7 border-t border-border-neutral pt-5 text-center">
            <p className="text-sm font-bold text-brand-charcoal">
              Compromisso com qualidade e confiança!
            </p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Acesso restrito a usuários autorizados.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
