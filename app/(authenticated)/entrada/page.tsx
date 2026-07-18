import Link from "next/link";
import { ArrowLeftIcon, InboundIcon } from "@/components/icons";
import { getInboundCatalog } from "@/lib/inbound-data";
import { InboundEntryFlow } from "./inbound-entry-flow";

export default async function InboundPage() {
  const catalog = await getInboundCatalog();

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Link
        href="/"
        className="nk-focus mb-6 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-black text-text-primary transition hover:bg-brand-gold-soft"
      >
        <ArrowLeftIcon className="size-5" />
        Voltar para o início
      </Link>

      <section className="nk-industrial-grid relative mb-6 overflow-hidden rounded-3xl border border-brand-gold/25 bg-brand-charcoal p-5 text-white shadow-xl shadow-brand-charcoal/10 sm:p-7">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5 bg-emerald-600"
        />
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-300/30 sm:size-14">
            <InboundIcon className="size-7" />
          </span>
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-brand-gold uppercase">
              NK Servos · Estoque
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
              Entrada manual
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold text-slate-200 sm:text-base">
              Selecione os itens físicos, informe as quantidades e revise tudo
              antes de confirmar.
            </p>
          </div>
        </div>
      </section>

      {catalog.data === null ? (
        <section
          role="alert"
          className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-sm"
        >
          <h2 className="text-lg font-black">Catálogo indisponível</h2>
          <p className="mt-2 text-sm font-semibold">
            {catalog.error}
          </p>
          <Link
            href="/entrada"
            className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-red-900 px-5 text-sm font-black text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-300"
          >
            Tentar novamente
          </Link>
        </section>
      ) : catalog.data.length === 0 ? (
        <section className="rounded-3xl border border-border-neutral bg-surface p-6 text-center shadow-sm sm:p-8">
          <h2 className="text-lg font-black text-text-primary">
            Nenhum item disponível
          </h2>
          <p className="mt-2 text-sm font-semibold text-text-muted">
            Não há itens físicos ativos liberados para uma nova entrada.
          </p>
        </section>
      ) : (
        <InboundEntryFlow catalog={catalog.data} />
      )}
    </main>
  );
}
