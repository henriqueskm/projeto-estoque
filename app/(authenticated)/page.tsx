import Link from "next/link";
import type { ReactNode } from "react";
import {
  AssistantIcon,
  CameraIcon,
  ClockIcon,
  InboundIcon,
  OutboundIcon,
  SearchIcon,
  StockIcon,
} from "@/components/icons";
import {
  loadHomeData,
  type RecentMovement,
  type SearchResult,
} from "@/lib/home-data";

type ActionCard = {
  title: string;
  description: string;
  icon: ReactNode;
  href?: string;
  cardClassName: string;
  iconClassName: string;
  labelClassName: string;
};

type HomePageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

const actions: ActionCard[] = [
  {
    title: "Entrada",
    description: "Adicionar itens ao estoque",
    icon: <InboundIcon className="size-7" />,
    href: "/entrada",
    cardClassName: "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300",
    iconClassName: "bg-emerald-700 text-white",
    labelClassName: "text-emerald-800",
  },
  {
    title: "Saída",
    description: "Registrar retirada ou envio",
    icon: <OutboundIcon className="size-7" />,
    href: "/saida",
    cardClassName: "border-red-200 bg-red-50/70 hover:border-red-300",
    iconClassName: "bg-red-700 text-white",
    labelClassName: "text-red-800",
  },
  {
    title: "Pedido por foto",
    description: "Interpretar foto de um pedido",
    icon: <CameraIcon className="size-7" />,
    cardClassName:
      "border-brand-gold/45 bg-brand-gold-soft/45 hover:border-brand-gold",
    iconClassName: "bg-brand-charcoal text-brand-gold",
    labelClassName: "text-brand-gold-ink",
  },
  {
    title: "Assistente IA",
    description: "Consultar e preparar operações",
    icon: <AssistantIcon className="size-7" />,
    cardClassName: "border-violet-200 bg-violet-50/70 hover:border-violet-300",
    iconClassName: "bg-violet-700 text-white",
    labelClassName: "text-violet-800",
  },
];

const searchTypeStyles: Record<SearchResult["type"], string> = {
  SERVO: "bg-emerald-100 text-emerald-800",
  INSTALLATION_KIT: "bg-sky-100 text-sky-800",
  REPAIR_KIT: "bg-amber-100 text-amber-900",
  LOOSE_PART: "bg-brand-gold-soft text-brand-charcoal",
  COMMERCIAL_CONFIGURATION: "bg-violet-100 text-violet-800",
};

const movementTypeStyles: Record<RecentMovement["type"], string> = {
  INBOUND: "bg-emerald-100 text-emerald-800",
  OUTBOUND: "bg-red-100 text-red-800",
  ASSEMBLY: "bg-sky-100 text-sky-800",
  DISASSEMBLY: "bg-indigo-100 text-indigo-800",
  ADJUSTMENT: "bg-amber-100 text-amber-900",
  REVERSAL: "bg-brand-gold-soft text-brand-charcoal",
};

const quantityFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function formatDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : dateFormatter.format(date);
}

function CompatibilityList({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: NonNullable<SearchResult["compatibleServos"]>;
  emptyMessage: string;
}) {
  return (
    <div className="mt-4 border-t border-border-neutral/70 pt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-primary">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm leading-6 text-text-muted">{emptyMessage}</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.code}
              className="min-w-0 rounded-xl bg-app-background px-3 py-2 text-sm leading-5 text-text-muted"
            >
              <span className="font-mono font-bold text-text-primary">
                {item.code}
              </span>
              <span aria-hidden="true"> — </span>
              <span className="break-words">{item.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchResults({
  query,
  results,
}: {
  query: string;
  results: SearchResult[];
}) {
  return (
    <section className="mt-7" aria-labelledby="search-results-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
            Pesquisa
          </p>
          <h2
            id="search-results-title"
            className="mt-1 text-xl font-bold tracking-tight text-text-primary"
          >
            Resultados para “{query}”
          </h2>
        </div>
        <p className="text-sm font-semibold text-text-muted">
          {results.length} {results.length === 1 ? "resultado" : "resultados"}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-8 text-center">
          <p className="font-bold text-text-primary">
            Nenhuma correspondência encontrada.
          </p>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            Tente pesquisar por outro código, descrição ou modelo.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {results.map((result) => (
            <article
              key={`${result.kind}-${result.id}-${result.code}`}
              className="rounded-2xl border border-border-neutral bg-surface p-4 shadow-sm sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xl font-extrabold tracking-tight text-text-primary">
                    {result.code}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-text-muted">
                    {result.description}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${searchTypeStyles[result.type]}`}
                >
                  {result.typeLabel}
                </span>
              </div>

              {result.kind === "item" && result.model ? (
                <p className="mt-4 border-t border-border-neutral/70 pt-3 text-sm text-text-muted">
                  Modelo: <strong className="text-text-primary">{result.model}</strong>
                </p>
              ) : null}

              {result.kind === "item" &&
              result.type === "REPAIR_KIT" &&
              result.compatibleServos ? (
                <CompatibilityList
                  title="Servos compatíveis"
                  items={result.compatibleServos}
                  emptyMessage="Nenhum servo compatível cadastrado."
                />
              ) : null}

              {result.kind === "item" &&
              result.type === "SERVO" &&
              result.compatibleRepairs ? (
                <CompatibilityList
                  title="Jogos de reparo compatíveis"
                  items={result.compatibleRepairs}
                  emptyMessage="Nenhum jogo de reparo cadastrado."
                />
              ) : null}

              {result.kind === "configuration" &&
              result.servo &&
              result.installationKit ? (
                <div className="mt-4 grid gap-3 border-t border-border-neutral/70 pt-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-emerald-50 px-3 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                      Servo
                    </p>
                    <p className="mt-1 font-mono text-sm font-extrabold text-text-primary">
                      {result.servo.code}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                      {result.servo.description}
                      {result.servo.model ? ` · ${result.servo.model}` : ""}
                    </p>
                  </div>
                  <div className="rounded-xl bg-sky-50 px-3 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-sky-800">
                      Kit
                    </p>
                    <p className="mt-1 font-mono text-sm font-extrabold text-text-primary">
                      {result.installationKit.code}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                      {result.installationKit.description}
                    </p>
                  </div>
                </div>
              ) : null}

              {result.kind === "configuration" &&
              result.compatibleRepairs ? (
                <CompatibilityList
                  title="Jogos de reparo compatíveis"
                  items={result.compatibleRepairs}
                  emptyMessage="Nenhum jogo de reparo cadastrado."
                />
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (rawQuery ?? "").trim().slice(0, 100);
  const homeResult = await loadHomeData(query);
  const homeData = homeResult.data;
  const summaries = [
    {
      label: "Servoembreagens",
      value: homeData?.summary.servoTotal ?? null,
    },
    {
      label: "Kits avulsos",
      value: homeData?.summary.looseKitTotal ?? null,
    },
    {
      label: "Reparos",
      value: homeData?.summary.repairKitTotal ?? null,
    },
    {
      label: "Estoque baixo",
      value: homeData?.summary.lowStockItems ?? null,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
      <section className="nk-industrial-grid relative overflow-hidden rounded-3xl border border-brand-gold/25 bg-brand-charcoal px-5 py-7 text-white shadow-[0_22px_55px_-38px_rgba(23,29,33,0.95)] sm:px-8 sm:py-9">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5 bg-brand-gold"
        />
        <p className="text-xs font-black tracking-[0.2em] text-brand-gold uppercase">
          NK Servos · Visão geral
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
          Operação de estoque
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-slate-200">
          Consulte saldos e acesse rapidamente as principais operações do
          Negócios K.
        </p>
      </section>

      <section className="nk-panel mt-5 p-4 sm:p-5" aria-labelledby="search-label">
        <h2 id="search-label" className="sr-only">
          Pesquisa de estoque
        </h2>
        <form action="/" method="get" className="flex flex-col gap-3 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">
              Pesquisar por código, descrição ou modelo
            </span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-muted" />
            <input
              name="q"
              type="search"
              defaultValue={query}
              maxLength={100}
              placeholder="Pesquisar por código, descrição ou modelo..."
              className="nk-field min-h-14 w-full rounded-2xl border py-3 pr-4 pl-12 text-base shadow-sm outline-none transition placeholder:text-text-muted"
            />
          </label>
          <button
            type="submit"
            className="nk-focus min-h-14 rounded-2xl bg-brand-charcoal px-6 text-sm font-black text-white shadow-sm transition hover:bg-brand-charcoal-soft"
          >
            Pesquisar
          </button>
          {query ? (
            <Link
              href="/"
              className="nk-focus inline-flex min-h-14 items-center justify-center rounded-2xl border border-border-neutral bg-surface px-5 text-sm font-bold text-text-primary shadow-sm transition hover:bg-app-background"
            >
              Limpar
            </Link>
          ) : null}
        </form>
      </section>

      {homeResult.error ? (
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-medium text-red-800"
        >
          {homeResult.error} Tente atualizar a página em alguns instantes.
        </div>
      ) : null}

      {query && homeData ? (
        <SearchResults query={query} results={homeData.searchResults} />
      ) : null}

      <section className="mt-9" aria-labelledby="quick-actions-title">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
              Operações
            </p>
            <h2
              id="quick-actions-title"
              className="mt-1 text-xl font-bold tracking-tight text-text-primary"
            >
              Ações rápidas
            </h2>
          </div>
          <span className="rounded-full bg-brand-gold-soft px-3 py-1 text-xs font-bold text-brand-charcoal">
            2 em breve
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {actions.map((action) => {
            const className = `nk-focus group min-h-44 rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${action.cardClassName}`;
            const content = (
              <>
                <span
                  className={`flex size-12 items-center justify-center rounded-2xl shadow-sm ${action.iconClassName}`}
                >
                  {action.icon}
                </span>
                <span className="mt-5 block text-base leading-tight font-extrabold text-text-primary sm:text-lg">
                  {action.title}
                </span>
                <span className="mt-2 hidden text-sm leading-5 text-text-muted sm:block">
                  {action.description}
                </span>
                <span
                  className={`mt-3 block text-xs font-bold uppercase tracking-wide sm:hidden ${action.labelClassName}`}
                >
                  {action.href ? "Abrir" : "Em breve"}
                </span>
              </>
            );

            return action.href ? (
              <Link
                key={action.title}
                href={action.href}
                aria-label={`Abrir ${action.title}`}
                className={className}
              >
                {content}
              </Link>
            ) : (
              <button
                key={action.title}
                type="button"
                aria-label={`${action.title}. Funcionalidade em breve.`}
                className={className}
              >
                {content}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="summary-title">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand-charcoal text-brand-gold">
            <StockIcon className="size-5" />
          </span>
          <h2
            id="summary-title"
            className="text-xl font-bold tracking-tight text-text-primary"
          >
            Resumo do estoque
          </h2>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaries.map((summary) => (
            <article
              key={summary.label}
              className="rounded-2xl border border-border-neutral bg-surface p-4 shadow-sm sm:p-5"
            >
              <p className="text-sm leading-5 font-semibold text-text-muted">
                {summary.label}
              </p>
              <p className="mt-3 text-3xl font-extrabold text-text-primary">
                {summary.value === null
                  ? "—"
                  : quantityFormatter.format(summary.value)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="mt-10 pb-8"
        aria-labelledby="latest-movements-title"
      >
        <h2
          id="latest-movements-title"
          className="text-xl font-bold tracking-tight text-text-primary"
        >
          Últimas movimentações
        </h2>

        {!homeData ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-surface px-5 py-8 text-center">
            <p className="font-bold text-text-primary">
              Não foi possível carregar as movimentações.
            </p>
          </div>
        ) : homeData.recentMovements.length === 0 ? (
          <div className="mt-4 flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-gold-soft text-brand-charcoal">
              <ClockIcon className="size-6" />
            </span>
            <p className="mt-4 text-base font-bold text-text-primary">
              Nenhuma movimentação para exibir.
            </p>
            <p className="mt-1 text-sm leading-6 text-text-muted">
              As movimentações registradas aparecerão aqui.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border-neutral bg-surface shadow-sm">
            {homeData.recentMovements.map((movement, index) => (
              <article
                key={movement.id}
                className={`p-4 sm:p-5 ${index > 0 ? "border-t border-border-neutral/70" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${movementTypeStyles[movement.type]}`}
                  >
                    {movement.typeLabel}
                  </span>
                  <span className="rounded-full bg-app-background px-2.5 py-1 text-xs font-semibold text-text-muted">
                    {movement.sourceLabel}
                  </span>
                </div>
                <p className="mt-3 font-semibold leading-6 text-text-primary">
                  {movement.description?.trim() || "Sem descrição informada."}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                  <span>{movement.userName?.trim() || "Usuário não identificado"}</span>
                  <time dateTime={movement.occurredAt}>
                    {formatDate(movement.occurredAt)}
                  </time>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
