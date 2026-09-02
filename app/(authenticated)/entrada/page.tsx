import Link from "next/link";
import { ArrowLeftIcon, InboundIcon } from "@/components/icons";
import { getInboundCatalog } from "@/lib/inbound-data";
import { InboundEntryFlow } from "./inbound-entry-flow";

export default async function InboundPage() {
  const catalog = await getInboundCatalog();

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-7 lg:px-8">
      <Link
        href="/"
        className="nk-focus mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-black text-text-primary transition hover:bg-brand-gold-soft sm:mb-4"
      >
        <ArrowLeftIcon className="size-5" />
        Voltar para o início
      </Link>

      <section className="mb-5 flex items-center gap-3 border-b border-border-neutral pb-4 sm:mb-6 sm:gap-4 sm:pb-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800 sm:size-12">
          <InboundIcon className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="text-[0.68rem] font-black tracking-[0.16em] text-brand-gold-ink uppercase sm:text-xs">
            Estoque
          </p>
          <h1 className="text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
            Entrada manual
          </h1>
          <p className="mt-1 max-w-2xl text-sm font-semibold text-text-muted">
            Selecione itens e informe as quantidades recebidas.
          </p>
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
      ) : catalog.data.physicalItems.length === 0 &&
        catalog.data.commercialCodes.length === 0 ? (
        <section className="rounded-3xl border border-border-neutral bg-surface p-6 text-center shadow-sm sm:p-8">
          <h2 className="text-lg font-black text-text-primary">
            Nenhuma opção disponível
          </h2>
          <p className="mt-2 text-sm font-semibold text-text-muted">
            Não há itens físicos ou códigos comerciais ativos para entrada.
          </p>
        </section>
      ) : (
        <InboundEntryFlow catalog={catalog.data} />
      )}
    </main>
  );
}
