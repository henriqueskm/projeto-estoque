import Link from "next/link";
import {
  ArrowLeftIcon,
  ClockIcon,
  SearchIcon,
} from "@/components/icons";
import {
  loadHistoryList,
  parseHistoryFilters,
} from "@/lib/history-data";
import {
  movementSourceLabels,
  movementSources,
  movementTypeLabels,
  movementTypes,
  type HistoryFilters,
  type HistorySearchParams,
  type MovementType,
} from "@/lib/history-types";

type HistoryPageProps = {
  searchParams: Promise<HistorySearchParams>;
};

const quantityFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const movementTypeStyles: Record<MovementType, string> = {
  INBOUND: "bg-emerald-100 text-emerald-900",
  OUTBOUND: "bg-red-100 text-red-900",
  ASSEMBLY: "bg-sky-100 text-sky-900",
  DISASSEMBLY: "bg-indigo-100 text-indigo-900",
  ADJUSTMENT: "bg-amber-100 text-amber-950",
  REVERSAL: "bg-brand-gold-soft text-brand-charcoal",
};

function formatDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : dateFormatter.format(date);
}

function createHistoryHref(
  filters: HistoryFilters,
  page = filters.page,
) {
  const params = new URLSearchParams();

  if (filters.type !== "ALL") {
    params.set("tipo", filters.type);
  }

  if (filters.source !== "ALL") {
    params.set("origem", filters.source);
  }

  if (filters.dateFrom) {
    params.set("dataInicial", filters.dateFrom);
  }

  if (filters.dateTo) {
    params.set("dataFinal", filters.dateTo);
  }

  if (filters.user) {
    params.set("usuario", filters.user);
  }

  if (filters.query) {
    params.set("busca", filters.query);
  }

  if (page > 1) {
    params.set("pagina", String(page));
  }

  const query = params.toString();
  return query ? `/historico?${query}` : "/historico";
}

function hasActiveFilters(filters: HistoryFilters) {
  return Boolean(
    filters.type !== "ALL" ||
      filters.source !== "ALL" ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.user ||
      filters.query,
  );
}

function Pagination({
  filters,
  currentPage,
  totalPages,
  totalResults,
}: {
  filters: HistoryFilters;
  currentPage: number;
  totalPages: number;
  totalResults: number;
}) {
  if (totalResults === 0) {
    return null;
  }

  const commonClassName =
    "nk-focus inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-bold";

  return (
    <nav
      className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-neutral bg-surface p-3"
      aria-label="Paginação do histórico"
    >
      {currentPage > 1 ? (
        <Link
          href={createHistoryHref(filters, currentPage - 1)}
          className={`${commonClassName} border-border-neutral text-text-primary transition hover:bg-app-background`}
        >
          Página anterior
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={`${commonClassName} cursor-not-allowed border-border-neutral/70 text-text-muted opacity-60`}
        >
          Página anterior
        </span>
      )}

      <p className="text-center text-sm font-semibold text-text-muted">
        Página <strong className="text-text-primary">{currentPage}</strong> de{" "}
        <strong className="text-text-primary">{totalPages}</strong>
      </p>

      {currentPage < totalPages ? (
        <Link
          href={createHistoryHref(filters, currentPage + 1)}
          className={`${commonClassName} border-brand-gold-dark bg-brand-gold text-brand-charcoal transition hover:bg-brand-gold-soft`}
        >
          Próxima página
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={`${commonClassName} cursor-not-allowed border-border-neutral/70 text-text-muted opacity-60`}
        >
          Próxima página
        </span>
      )}
    </nav>
  );
}

export default async function HistoryPage({
  searchParams,
}: HistoryPageProps) {
  const filters = parseHistoryFilters(await searchParams);
  const historyResult = await loadHistoryList(filters);
  const history = historyResult.data;
  const filtered = hasActiveFilters(filters);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
      <Link
        href="/"
        className="nk-focus inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-text-primary transition hover:bg-surface"
      >
        <ArrowLeftIcon className="size-5" />
        Voltar ao início
      </Link>

      <section className="nk-industrial-grid relative mt-4 overflow-hidden rounded-3xl border border-brand-gold/25 bg-brand-charcoal px-5 py-7 text-white shadow-[0_22px_55px_-38px_rgba(23,29,33,0.95)] sm:px-8 sm:py-9">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5 bg-brand-gold"
        />
        <div className="flex items-start gap-3">
          <span className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gold text-brand-charcoal">
            <ClockIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-black tracking-[0.2em] text-brand-gold uppercase">
              Auditoria · Somente leitura
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Histórico de movimentações
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 sm:text-base sm:leading-7">
              Consulte lotes registrados, responsáveis e impactos nos saldos
              sem alterar o estoque.
            </p>
          </div>
        </div>
      </section>

      <section
        className="nk-panel mt-5 p-4 sm:p-5"
        aria-labelledby="history-filters-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
              Consulta
            </p>
            <h2
              id="history-filters-title"
              className="mt-1 text-lg font-black text-text-primary"
            >
              Filtrar movimentações
            </h2>
          </div>
          <span className="rounded-full bg-app-background px-3 py-1 text-xs font-bold text-text-muted">
            {history
              ? `${quantityFormatter.format(history.pagination.totalResults)} ${
                  history.pagination.totalResults === 1
                    ? "resultado"
                    : "resultados"
                }`
              : "Resultados indisponíveis"}
          </span>
        </div>

        <form
          action="/historico"
          method="get"
          className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          <label>
            <span className="mb-1.5 block text-sm font-bold text-text-primary">
              Tipo
            </span>
            <select
              name="tipo"
              defaultValue={filters.type}
              className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
            >
              <option value="ALL">Todos os tipos</option>
              {movementTypes.map((type) => (
                <option key={type} value={type}>
                  {movementTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1.5 block text-sm font-bold text-text-primary">
              Origem
            </span>
            <select
              name="origem"
              defaultValue={filters.source}
              className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
            >
              <option value="ALL">Todas as origens</option>
              {movementSources.map((source) => (
                <option key={source} value={source}>
                  {movementSourceLabels[source]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1.5 block text-sm font-bold text-text-primary">
              Data inicial
            </span>
            <input
              type="date"
              name="dataInicial"
              defaultValue={filters.dateFrom}
              className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
            />
          </label>

          <label>
            <span className="mb-1.5 block text-sm font-bold text-text-primary">
              Data final
            </span>
            <input
              type="date"
              name="dataFinal"
              defaultValue={filters.dateTo}
              className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
            />
          </label>

          <label>
            <span className="mb-1.5 block text-sm font-bold text-text-primary">
              Usuário
            </span>
            <input
              type="search"
              name="usuario"
              maxLength={100}
              defaultValue={filters.user}
              placeholder="Nome registrado"
              className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
            />
          </label>

          <label className="md:col-span-2 xl:col-span-3">
            <span className="mb-1.5 block text-sm font-bold text-text-primary">
              Descrição ou ID do lote
            </span>
            <span className="relative block">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                name="busca"
                maxLength={100}
                defaultValue={filters.query}
                placeholder="Descrição ou UUID completo"
                className="nk-field min-h-12 w-full rounded-xl border py-2 pr-3 pl-11 text-base outline-none"
              />
            </span>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row md:col-span-2 xl:col-span-4 xl:justify-end">
            <button
              type="submit"
              className="nk-focus min-h-12 rounded-xl bg-brand-charcoal px-6 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
            >
              Filtrar
            </button>
            <Link
              href="/historico"
              className="nk-focus inline-flex min-h-12 items-center justify-center rounded-xl border border-border-neutral bg-surface px-5 text-sm font-bold text-text-primary transition hover:bg-app-background"
            >
              Limpar filtros
            </Link>
          </div>
        </form>

        {filters.dateRangeAdjusted ? (
          <p
            role="status"
            className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950"
          >
            O período informado era inválido e foi limitado para uma consulta
            segura.
          </p>
        ) : null}
      </section>

      {historyResult.error ? (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-5 text-sm leading-6 font-semibold text-red-900"
        >
          {historyResult.error} Tente atualizar a página em alguns instantes.
        </div>
      ) : null}

      {history ? (
        <section className="mt-6 pb-8" aria-labelledby="history-results-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
                Resultados
              </p>
              <h2
                id="history-results-title"
                className="mt-1 text-xl font-black text-text-primary"
              >
                Lotes registrados
              </h2>
            </div>
            <p className="text-sm font-semibold text-text-muted">
              Página {history.pagination.currentPage} de{" "}
              {history.pagination.totalPages}
            </p>
          </div>

          {history.batches.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-gold-soft text-brand-charcoal">
                <ClockIcon className="size-6" />
              </span>
              <p className="mt-4 font-black text-text-primary">
                {filtered
                  ? "Nenhuma movimentação encontrada."
                  : "O histórico ainda está vazio."}
              </p>
              <p className="mt-1 max-w-xl text-sm leading-6 text-text-muted">
                {filtered
                  ? "Ajuste ou limpe os filtros para fazer outra consulta."
                  : "Os lotes registrados aparecerão aqui sem a necessidade de criar dados de exemplo."}
              </p>
              {filtered ? (
                <Link
                  href="/historico"
                  className="nk-focus mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-charcoal px-5 text-sm font-black text-white"
                >
                  Limpar filtros
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3">
              {history.batches.map((batch) => (
                <article
                  key={batch.id}
                  className="min-w-0 rounded-2xl border border-border-neutral bg-surface p-4 shadow-sm sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${movementTypeStyles[batch.movementType]}`}
                      >
                        {movementTypeLabels[batch.movementType]}
                      </span>
                      <span className="rounded-full bg-app-background px-2.5 py-1 text-xs font-bold text-text-muted">
                        {movementSourceLabels[batch.source]}
                      </span>
                    </div>
                    <time
                      dateTime={batch.occurredAt}
                      className="text-sm font-semibold text-text-muted"
                    >
                      {formatDate(batch.occurredAt)}
                    </time>
                  </div>

                  <p className="mt-3 break-words font-bold leading-6 text-text-primary">
                    {batch.description?.trim() || "Sem descrição"}
                  </p>
                  <p className="mt-2 text-sm leading-6 font-semibold text-brand-gold-ink">
                    {batch.summary}
                  </p>

                  <div className="mt-3 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                    <span>
                      {batch.userName?.trim() || "Usuário não identificado"}
                    </span>
                    <span className="min-w-0 break-all font-mono text-xs">
                      Lote {batch.id.slice(0, 8)}
                    </span>
                    {batch.reversedBatchId ? (
                      <span className="font-semibold text-brand-gold-ink">
                        Relacionado a reversão
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 border-t border-border-neutral/70 pt-4 sm:text-right">
                    <Link
                      href={`/historico/${batch.id}`}
                      className="nk-focus inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-brand-gold-dark bg-brand-gold px-5 text-sm font-black text-brand-charcoal transition hover:bg-brand-gold-soft sm:w-auto"
                    >
                      Ver detalhes
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}

          <Pagination
            filters={filters}
            currentPage={history.pagination.currentPage}
            totalPages={history.pagination.totalPages}
            totalResults={history.pagination.totalResults}
          />
        </section>
      ) : null}
    </main>
  );
}
