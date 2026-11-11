import { connection } from "next/server";
import { WorkspaceScroll } from "@/components/workspace-state-provider";
import { HistoryFilterDisclosure } from "@/components/history-filter-disclosure";
import Link from "next/link";
import { createHistoryHref } from "@/lib/history-query";
import { measurePerformanceAudit } from "@/lib/performance-audit";
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
  type HistoryBatchListItem,
  type HistoryFilters,
  type HistorySearchParams,
  type MovementType,
  type MovementTypeFilter,
} from "@/lib/history-types";

type HistoryPageProps = {
  searchParams: Promise<HistorySearchParams>;
};

const timeZone = "America/Sao_Paulo";
const quantityFormatter = new Intl.NumberFormat("pt-BR");
const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone,
});
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone,
});
const dayLabelFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  timeZone,
});
const maximumVisibleLines = 4;

const movementTypeStyles: Record<MovementType, string> = {
  INBOUND: "bg-emerald-100 text-emerald-900",
  OUTBOUND: "bg-red-100 text-red-900",
  ASSEMBLY: "bg-violet-100 text-violet-900",
  DISASSEMBLY: "bg-violet-100 text-violet-900",
  ADJUSTMENT: "bg-amber-100 text-amber-950",
  REVERSAL: "bg-brand-gold-soft text-brand-charcoal",
};

// The common questions get big shortcuts; the rest stays under "Mais filtros".
const typeShortcuts: Array<{ type: MovementTypeFilter; label: string }> = [
  { type: "ALL", label: "Todos" },
  { type: "INBOUND", label: "Entradas" },
  { type: "OUTBOUND", label: "Saídas" },
  { type: "ADJUSTMENT", label: "Ajustes" },
];

const sourceHints: Record<string, string> = {
  AI_CHAT: "pela Assistente",
  ORDER_PHOTO: "por foto do pedido",
};

function dayKey(value: string | Date) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dayKeyFormatter.format(date);
}

function dayLabel(key: string, value: string, today: string, yesterday: string) {
  if (!key) return "Data indisponível";
  if (key === today) return "Hoje";
  if (key === yesterday) return "Ontem";
  const label = dayLabelFormatter.format(new Date(value));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timeFormatter.format(date);
}

function groupByDay(batches: HistoryBatchListItem[]) {
  const groups: Array<{ key: string; firstValue: string; batches: HistoryBatchListItem[] }> = [];

  batches.forEach((batch) => {
    const key = dayKey(batch.occurredAt);
    const last = groups.at(-1);

    if (last && last.key === key) last.batches.push(batch);
    else groups.push({ key, firstValue: batch.occurredAt, batches: [batch] });
  });

  return groups;
}

// Entrada always adds and Saída always removes; internal moves keep their sign.
function signedQuantity(type: MovementType, quantity: number) {
  if (type === "INBOUND") return Math.abs(quantity);
  if (type === "OUTBOUND") return -Math.abs(quantity);
  return quantity;
}

function MovedLines({ batch }: { batch: HistoryBatchListItem }) {
  if (batch.lines.length === 0) {
    return (
      <p className="mt-3 text-base font-semibold text-text-muted">
        {batch.summary}
      </p>
    );
  }

  const visible = batch.lines.slice(0, maximumVisibleLines);
  const hidden = batch.lines.length - visible.length;

  return (
    <ul className="mt-3 space-y-1.5">
      {visible.map((line, index) => {
        const quantity = signedQuantity(batch.movementType, line.quantity);
        const isPositive = quantity > 0;

        return (
          <li key={`${line.code}-${index}`} className="flex min-w-0 items-baseline gap-3">
            <span
              className={`w-16 shrink-0 text-right font-mono text-lg font-black tabular-nums ${
                isPositive ? "text-emerald-800" : "text-red-800"
              }`}
            >
              {isPositive ? "+" : "−"}
              {quantityFormatter.format(Math.abs(quantity))}
            </span>
            <span className="min-w-0 break-all font-mono text-lg font-black text-text-primary">
              {line.code}
            </span>
          </li>
        );
      })}
      {hidden > 0 ? (
        <li className="pl-[4.75rem] text-sm font-bold text-text-muted">
          e mais {hidden} {hidden === 1 ? "item" : "itens"}
        </li>
      ) : null}
    </ul>
  );
}

function Pagination({
  filters,
  currentPage,
  totalPages,
}: {
  filters: HistoryFilters;
  currentPage: number;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const className =
    "nk-focus inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border px-4 text-base font-bold";

  return (
    <nav
      className="mt-6 flex gap-3"
      aria-label="Mais movimentações"
    >
      {currentPage > 1 ? (
        <Link
          href={createHistoryHref(filters, currentPage - 1)}
          className={`${className} border-border-neutral bg-surface text-text-primary transition hover:bg-app-background`}
        >
          ← Mais recentes
        </Link>
      ) : null}
      {currentPage < totalPages ? (
        <Link
          href={createHistoryHref(filters, currentPage + 1)}
          className={`${className} border-brand-gold-dark bg-brand-gold text-brand-charcoal transition hover:bg-brand-gold-soft`}
        >
          Mais antigas →
        </Link>
      ) : null}
    </nav>
  );
}

export default async function HistoryPage({
  searchParams,
}: HistoryPageProps) {
  // Operational data waits for a real navigation, never a runtime prefetch.
  await connection();
  const filters = parseHistoryFilters(await searchParams);
  const historyResult = await measurePerformanceAudit("history", "page_data", () => loadHistoryList(filters));
  const history = historyResult.data;
  const advancedFilterCount = [
    filters.source !== "ALL",
    filters.dateFrom,
    filters.dateTo,
    filters.user,
  ].filter(Boolean).length;
  const filtered = filters.type !== "ALL" || Boolean(filters.query) || advancedFilterCount > 0;
  const now = new Date();
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const shortcuts = typeShortcuts.some((shortcut) => shortcut.type === filters.type)
    ? typeShortcuts
    : [...typeShortcuts, { type: filters.type, label: movementTypeLabels[filters.type as MovementType] }];

  return (
    <main data-nk-perf-ready="/historico" className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <WorkspaceScroll workspace="historico" />
      <Link
        href="/"
        className="nk-focus inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-base font-bold text-text-primary transition hover:bg-surface"
      >
        <ArrowLeftIcon className="size-5" />
        Voltar ao início
      </Link>

      <h1 className="mt-3 text-3xl font-black tracking-tight text-text-primary">
        Histórico
      </h1>
      <p className="mt-1 text-base leading-7 text-text-muted">
        Tudo o que entrou, saiu ou foi ajustado no estoque.
      </p>

      <nav aria-label="Tipo de movimentação" className="mt-5 flex flex-wrap gap-2">
        {shortcuts.map((shortcut) => {
          const isActive = shortcut.type === filters.type;

          return (
            <Link
              key={shortcut.type}
              href={createHistoryHref({ ...filters, type: shortcut.type }, 1)}
              aria-current={isActive ? "page" : undefined}
              className={`nk-focus inline-flex min-h-12 items-center rounded-full border px-5 text-base font-bold transition ${
                isActive
                  ? "border-brand-charcoal bg-brand-charcoal text-white"
                  : "border-border-neutral bg-surface text-text-primary hover:bg-app-background"
              }`}
            >
              {shortcut.label}
            </Link>
          );
        })}
      </nav>

      <form action="/historico" method="get" className="mt-4">
        {filters.type !== "ALL" ? (
          <input type="hidden" name="tipo" value={filters.type} />
        ) : null}
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Buscar no histórico</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              name="busca"
              maxLength={100}
              defaultValue={filters.query}
              placeholder="Buscar pela observação"
              className="nk-field min-h-12 w-full rounded-xl border py-2 pr-3 pl-11 text-base outline-none"
            />
          </label>
          <button
            type="submit"
            className="nk-focus min-h-12 shrink-0 rounded-xl bg-brand-charcoal px-5 text-base font-black text-white transition hover:bg-brand-charcoal-soft"
          >
            Buscar
          </button>
        </div>

        <HistoryFilterDisclosure key={createHistoryHref(filters, 1)} activeCount={advancedFilterCount}>
          <div className="mt-3 grid gap-3 rounded-2xl border border-border-neutral bg-surface p-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-base font-bold text-text-primary">
                De
              </span>
              <input
                type="date"
                name="dataInicial"
                defaultValue={filters.dateFrom}
                className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-base font-bold text-text-primary">
                Até
              </span>
              <input
                type="date"
                name="dataFinal"
                defaultValue={filters.dateTo}
                className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-base font-bold text-text-primary">
                Pessoa
              </span>
              <input
                type="search"
                name="usuario"
                maxLength={100}
                defaultValue={filters.user}
                placeholder="Nome"
                className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-base font-bold text-text-primary">
                Feito por
              </span>
              <select
                name="origem"
                defaultValue={filters.source}
                className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
              >
                <option value="ALL">Qualquer forma</option>
                {movementSources.map((source) => (
                  <option key={source} value={source}>
                    {movementSourceLabels[source]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
              <button
                type="submit"
                className="nk-focus min-h-12 rounded-xl bg-brand-charcoal px-6 text-base font-black text-white transition hover:bg-brand-charcoal-soft"
              >
                Aplicar
              </button>
              <Link
                href="/historico"
                className="nk-focus inline-flex min-h-12 items-center justify-center rounded-xl border border-border-neutral bg-surface px-5 text-base font-bold text-text-primary transition hover:bg-app-background"
              >
                Limpar tudo
              </Link>
            </div>
          </div>
        </HistoryFilterDisclosure>

        {filters.dateRangeAdjusted ? (
          <p
            role="status"
            className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold text-amber-950"
          >
            O período informado era inválido e foi ajustado.
          </p>
        ) : null}
      </form>

      {historyResult.error ? (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-5 text-base leading-7 font-semibold text-red-900"
        >
          {historyResult.error} Tente atualizar a página em alguns instantes.
        </div>
      ) : null}

      {history ? (
        <section className="mt-6 pb-8" aria-label="Movimentações">
          {history.batches.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-gold-soft text-brand-charcoal">
                <ClockIcon className="size-6" />
              </span>
              <p className="mt-4 text-lg font-black text-text-primary">
                {filtered
                  ? "Nada encontrado."
                  : "Ainda não há movimentações."}
              </p>
              {filtered ? (
                <Link
                  href="/historico"
                  className="nk-focus mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-charcoal px-5 text-base font-black text-white"
                >
                  Ver tudo
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="space-y-6">
              {groupByDay(history.batches).map((group) => (
                <section key={group.key || group.firstValue} aria-label={dayLabel(group.key, group.firstValue, today, yesterday)}>
                  <h2 className="mb-2 text-lg font-black text-text-primary">
                    {dayLabel(group.key, group.firstValue, today, yesterday)}
                  </h2>
                  <ul className="space-y-3">
                    {group.batches.map((batch) => {
                      const sourceHint = sourceHints[batch.source];
                      const note = batch.description?.trim();

                      return (
                        <li key={batch.id}>
                          <Link
                            href={`/historico/${batch.id}`}
                            className="nk-focus block min-w-0 rounded-2xl border border-border-neutral bg-surface p-4 shadow-sm transition hover:border-brand-gold-dark"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span
                                className={`rounded-full px-3 py-1 text-sm font-black ${movementTypeStyles[batch.movementType]}`}
                              >
                                {movementTypeLabels[batch.movementType]}
                              </span>
                              <time
                                dateTime={batch.occurredAt}
                                className="text-base font-bold text-text-muted tabular-nums"
                              >
                                {formatTime(batch.occurredAt)}
                              </time>
                            </div>

                            <MovedLines batch={batch} />

                            {note ? (
                              <p className="mt-3 break-words text-base leading-6 text-text-primary">
                                {note}
                              </p>
                            ) : null}

                            <p className="mt-3 text-base text-text-muted">
                              {batch.userName?.trim() || "Nome não cadastrado"}
                              {sourceHint ? ` · ${sourceHint}` : ""}
                              {batch.reversedBatchId ? " · desfaz outra movimentação" : ""}
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <Pagination
            filters={filters}
            currentPage={history.pagination.currentPage}
            totalPages={history.pagination.totalPages}
          />
        </section>
      ) : null}
    </main>
  );
}
