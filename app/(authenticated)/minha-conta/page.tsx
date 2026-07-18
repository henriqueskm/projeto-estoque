import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/app/auth/actions";
import { ArrowLeftIcon, LogoutIcon } from "@/components/icons";
import { requireActiveProfile } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Minha conta | Negócios K",
};

export default async function AccountPage() {
  const profile = await requireActiveProfile();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Link
        href="/"
        className="nk-focus mb-6 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-black text-text-primary transition hover:bg-brand-gold-soft"
      >
        <ArrowLeftIcon className="size-5" />
        Voltar para o início
      </Link>

      <section className="nk-industrial-grid relative overflow-hidden rounded-3xl border border-brand-gold/25 bg-brand-charcoal p-5 text-white shadow-xl shadow-brand-charcoal/10 sm:p-7">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5 bg-brand-gold"
        />
        <p className="text-xs font-black tracking-[0.18em] text-brand-gold uppercase">
          NK Servos · Perfil
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
          Minha conta
        </h1>
        <p className="mt-2 max-w-2xl text-sm font-semibold text-slate-200 sm:text-base">
          Consulte os dados vinculados ao seu acesso ao Negócios K.
        </p>
      </section>

      <section
        className="nk-panel mt-6 p-5 sm:p-7"
        aria-labelledby="account-data-title"
      >
        <div>
          <p className="text-xs font-black tracking-[0.16em] text-brand-gold-ink uppercase">
            Dados do perfil
          </p>
          <h2
            id="account-data-title"
            className="mt-1 text-xl font-black text-text-primary"
          >
            Identificação
          </h2>
        </div>

        <div className="mt-6 grid gap-5">
          <label className="grid gap-2">
            <span className="text-sm font-black text-text-primary">
              Nome completo
            </span>
            <input
              type="text"
              value={profile.displayName}
              readOnly
              aria-readonly="true"
              className="nk-field min-h-12 w-full rounded-xl border px-4 text-base font-semibold outline-none"
            />
          </label>

          {!profile.hasRegisteredName ? (
            <div
              role="status"
              className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-950"
            >
              O administrador precisa completar o nome do seu cadastro.
            </div>
          ) : null}

          <label className="grid gap-2">
            <span className="text-sm font-black text-text-primary">
              E-mail
            </span>
            <input
              type="email"
              value={profile.email}
              readOnly
              aria-readonly="true"
              className="nk-field min-h-12 w-full rounded-xl border px-4 text-base font-semibold outline-none"
            />
          </label>
        </div>

        <div className="mt-6 rounded-xl border border-brand-gold/45 bg-brand-gold-soft/55 px-4 py-4">
          <p className="text-sm font-black text-brand-charcoal">
            Para alterar seu nome, procure o administrador.
          </p>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            O nome oficial vem do perfil cadastrado e não pode ser alterado
            nesta tela.
          </p>
        </div>

        <div className="mt-7 flex flex-col gap-3 border-t border-border-neutral pt-6 sm:flex-row">
          <Link
            href="/"
            className="nk-focus inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-brand-charcoal px-5 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
          >
            Voltar para o início
          </Link>

          <form action={logout} className="flex-1">
            <button
              type="submit"
              className="nk-focus inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-300 bg-surface px-5 text-sm font-black text-red-800 transition hover:bg-red-50"
            >
              <LogoutIcon className="size-5" />
              Sair com segurança
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
