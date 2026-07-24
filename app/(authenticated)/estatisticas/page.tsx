import Link from "next/link";
import { StatisticsIcon, StockIcon } from "@/components/icons";
import {
  loadStatisticsData,
  parseStatisticsPeriod,
} from "@/lib/statistics-data";
import {
  statisticsPeriods,
  type StatisticsComparison,
  type StatisticsConfigurationRanking,
  type StatisticsData,
  type StatisticsItemRanking,
  type StatisticsSearchParams,
  type StatisticsTimelinePoint,
} from "@/lib/statistics-types";

type StatisticsPageProps = {
  searchParams: Promise<StatisticsSearchParams>;
};

const quantityFormatter = new Intl.NumberFormat("pt-BR");
const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const periodDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});
const chartAxisDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Sao_Paulo",
});

function formatPeriodDate(value: string) {
  return periodDateFormatter.format(new Date(value)).replace(".", "");
}

function formatChartAxisDate(value: string) {
  return chartAxisDateFormatter
    .format(new Date(value))
    .replace(".", "")
    .replace(" de ", " ");
}

function ComparisonLabel({
  comparison,
}: {
  comparison: StatisticsComparison;
}) {
  const previousLabel = `${quantityFormatter.format(
    comparison.previous,
  )} no período anterior`;

  if (comparison.previous === 0) {
    return (
      <span className="text-sky-800">Sem dados no período anterior</span>
    );
  }

  if (comparison.direction === "STABLE") {
    return (
      <span className="text-text-muted">
        Sem alteração vs. período anterior
      </span>
    );
  }

  const directionLabel = comparison.direction === "UP" ? "↑" : "↓";
  const style =
    comparison.direction === "UP" ? "text-emerald-800" : "text-red-800";

  return (
    <span className={style}>
      {directionLabel}{" "}
      {percentageFormatter.format(Math.abs(comparison.percentage ?? 0))}% vs.
      período anterior
      <span className="sr-only"> ({previousLabel})</span>
    </span>
  );
}

function MetricCard({
  label,
  value,
  helper,
  tone,
  children,
}: {
  label: string;
  value: number;
  helper: string;
  tone: "green" | "red" | "blue" | "violet";
  children?: React.ReactNode;
}) {
  const toneStyles = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-950",
    red: "border-red-200 bg-red-50 text-red-950",
    blue: "border-sky-200 bg-sky-50 text-sky-950",
    violet: "border-violet-200 bg-violet-50 text-violet-950",
  };

  return (
    <article className={`rounded-2xl border p-3.5 ${toneStyles[tone]}`}>
      <p className="text-xs font-black tracking-[0.12em] uppercase">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">
        {quantityFormatter.format(value)}
      </p>
      <p className="mt-1 text-xs leading-5 font-semibold opacity-75">{helper}</p>
      {children ? (
        <p className="mt-2 border-t border-current/15 pt-2 text-xs leading-5 font-bold">
          {children}
        </p>
      ) : null}
    </article>
  );
}

function getLabelIndexes(pointCount: number, maximumLabels: number) {
  if (pointCount <= maximumLabels) {
    return new Set(Array.from({ length: pointCount }, (_, index) => index));
  }

  return new Set(
    Array.from({ length: maximumLabels }, (_, index) =>
      Math.round((index * (pointCount - 1)) / (maximumLabels - 1)),
    ),
  );
}

function MovementChart({ points }: { points: StatisticsTimelinePoint[] }) {
  const maximum = Math.max(
    1,
    ...points.flatMap((point) => [point.inbound, point.outbound]),
  );
  const mobileLabelIndexes = getLabelIndexes(
    points.length,
    points.length <= 7 ? 7 : 4,
  );
  const desktopLabelIndexes = getLabelIndexes(points.length, 6);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-emerald-600" />
          Entradas
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-red-600" />
          Saídas externas
        </span>
      </div>
      <div
        className="grid h-48 items-end gap-px border-b border-border-neutral sm:h-52 sm:gap-1"
        style={{
          gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
        }}
        role="group"
        aria-label="Gráfico de entradas e saídas externas no período"
      >
        {points.map((point, index) => {
          const inboundHeight =
            point.inbound > 0
              ? Math.max(5, (point.inbound / maximum) * 100)
              : 0;
          const outboundHeight =
            point.outbound > 0
              ? Math.max(5, (point.outbound / maximum) * 100)
              : 0;
          const accessibleLabel = `${point.fullLabel}: ${point.inbound} entradas e ${point.outbound} saídas externas`;
          const labelPosition =
            index === 0
              ? "left-0"
              : index === points.length - 1
                ? "right-0"
                : "left-1/2 -translate-x-1/2";

          return (
            <div
              key={point.key}
              tabIndex={0}
              title={accessibleLabel}
              aria-label={accessibleLabel}
              className="nk-focus group relative flex h-full min-w-0 items-end justify-center gap-px rounded-t"
            >
              <span
                aria-hidden="true"
                className="w-[42%] max-w-5 rounded-t bg-emerald-600 transition group-hover:bg-emerald-500"
                style={{ height: `${inboundHeight}%` }}
              />
              <span
                aria-hidden="true"
                className="w-[42%] max-w-5 rounded-t bg-red-600 transition group-hover:bg-red-500"
                style={{ height: `${outboundHeight}%` }}
              />
              <span
                className={`pointer-events-none absolute bottom-[calc(100%+0.4rem)] z-10 hidden w-max max-w-44 rounded-lg bg-brand-charcoal px-2.5 py-2 text-center text-[0.68rem] leading-4 font-bold text-white shadow-xl group-hover:block group-focus-visible:block ${labelPosition}`}
              >
                {accessibleLabel}
              </span>
              {mobileLabelIndexes.has(index) ? (
                <span
                  className={`absolute top-[calc(100%+0.35rem)] whitespace-nowrap text-[0.58rem] font-bold text-text-muted sm:hidden ${labelPosition}`}
                >
                  {formatChartAxisDate(point.key)}
                </span>
              ) : null}
              {desktopLabelIndexes.has(index) ? (
                <span
                  className={`absolute top-[calc(100%+0.35rem)] hidden whitespace-nowrap text-[0.65rem] font-bold text-text-muted sm:block ${labelPosition}`}
                >
                  {formatChartAxisDate(point.key)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-xs leading-5 font-semibold text-text-muted">
        Montagens, desmontagens e ajustes internos não entram nessas séries.
        Toque, foque ou passe o cursor sobre uma coluna para ver os valores.
      </p>
    </div>
  );
}

function OutboundCategories({
  categories,
}: {
  categories: StatisticsData["outboundByCategory"];
}) {
  const rows = [
    {
      label: "Caixas completas",
      quantity: categories.completeBoxes,
      tone: "bg-violet-700",
    },
    {
      label: "Servos avulsos",
      quantity: categories.looseServos,
      tone: "bg-slate-800",
    },
    {
      label: "Kits avulsos",
      quantity: categories.looseInstallationKits,
      tone: "bg-sky-700",
    },
    {
      label: "Jogos de reparo",
      quantity: categories.repairKits,
      tone: "bg-amber-600",
    },
    {
      label: "Peças avulsas",
      quantity: categories.looseParts,
      tone: "bg-emerald-700",
    },
  ];
  const maximum = Math.max(1, ...rows.map((row) => row.quantity));

  return (
    <section className="rounded-2xl border border-border-neutral bg-surface p-4 sm:p-5">
      <p className="text-xs font-black tracking-[0.14em] text-brand-gold-ink uppercase">
        Saídas externas
      </p>
      <h2 className="mt-1 text-xl font-black text-text-primary">
        Saídas por categoria
      </h2>
      <p className="mt-1 text-xs leading-5 font-semibold text-text-muted">
        Quantidades que deixaram fisicamente o estoque no período.
      </p>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="font-bold text-text-primary">{row.label}</span>
              <strong className="font-mono tabular-nums text-text-primary">
                {quantityFormatter.format(row.quantity)}
              </strong>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-app-background"
              role="img"
              aria-label={`${row.label}: ${quantityFormatter.format(
                row.quantity,
              )} unidades`}
            >
              <span
                className={`block h-full rounded-full ${row.tone}`}
                style={{
                  width:
                    row.quantity > 0
                      ? `${Math.max(4, (row.quantity / maximum) * 100)}%`
                      : "0%",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PeriodHighlights({
  highlights,
}: {
  highlights: StatisticsData["highlights"];
}) {
  const rows: Array<{
    key: string;
    label: string;
    code: string;
    description: string;
    quantity: number;
  }> = [];

  if (highlights.configuration) {
    rows.push({
      key: "configuration",
      label: "Caixa mais saída",
      code:
        highlights.configuration.aliases.join(" / ") ||
        "Sem código comercial ativo",
      description: `Servo ${highlights.configuration.servoCode} + ${highlights.configuration.installationKitCode}`,
      quantity: highlights.configuration.quantity,
    });
  }

  const itemHighlights = [
    ["loose-servo", "Servo avulso mais saído", highlights.looseServo],
    [
      "loose-kit",
      "Kit avulso mais saído",
      highlights.looseInstallationKit,
    ],
    ["repair-kit", "Jogo de reparo mais saído", highlights.repairKit],
    ["loose-part", "Peça avulsa mais saída", highlights.loosePart],
  ] as const;

  itemHighlights.forEach(([key, label, item]) => {
    if (item) {
      rows.push({
        key,
        label,
        code: item.code,
        description: item.description,
        quantity: item.quantity,
      });
    }
  });

  return (
    <section className="rounded-2xl border border-border-neutral bg-surface p-4 sm:p-5">
      <p className="text-xs font-black tracking-[0.14em] text-brand-gold-ink uppercase">
        Resumo executivo
      </p>
      <h2 className="mt-1 text-xl font-black text-text-primary">
        Destaques do período
      </h2>
      {rows.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <li
              key={row.key}
              className="rounded-xl border border-border-neutral bg-app-background px-3 py-2.5"
            >
              <p className="text-[0.65rem] font-black tracking-wide text-text-muted uppercase">
                {row.label}
              </p>
              <div className="mt-1 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block text-sm text-text-primary">
                    {row.code}
                  </strong>
                  <span className="block truncate text-xs text-text-muted">
                    {row.description}
                  </span>
                </div>
                <strong className="shrink-0 font-mono text-sm tabular-nums text-text-primary">
                  {quantityFormatter.format(row.quantity)}
                </strong>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-border-neutral bg-app-background px-3 py-4 text-sm font-semibold text-text-muted">
          Sem saídas externas para destacar neste período.
        </p>
      )}
      {highlights.withoutMovementTotal > 0 ? (
        <p className="mt-3 text-sm font-bold text-text-muted">
          {quantityFormatter.format(highlights.withoutMovementTotal)}{" "}
          {highlights.withoutMovementTotal === 1
            ? "cadastro ativo sem movimento"
            : "cadastros ativos sem movimento"}{" "}
          no período.
        </p>
      ) : null}
    </section>
  );
}

function EmptyRanking() {
  return (
    <p className="rounded-xl border border-dashed border-border-neutral bg-app-background px-3 py-4 text-sm font-semibold text-text-muted">
      Sem saídas nesta categoria no período.
    </p>
  );
}

function ItemRanking({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: StatisticsItemRanking[];
}) {
  return (
    <section className="rounded-2xl border border-border-neutral bg-surface p-4">
      <h3 className="font-black text-text-primary">{title}</h3>
      <p className="mt-1 text-xs leading-5 font-semibold text-text-muted">
        {description}
      </p>
      <div className="mt-3">
        {items.length === 0 ? (
          <EmptyRanking />
        ) : (
          <ol className="space-y-2">
            {items.slice(0, 5).map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl bg-app-background px-3 py-2.5"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-charcoal text-xs font-black text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm text-text-primary">
                    {item.code}
                  </strong>
                  <span className="block truncate text-xs text-text-muted">
                    {item.description}
                  </span>
                </span>
                <strong className="shrink-0 text-sm tabular-nums text-text-primary">
                  {quantityFormatter.format(item.quantity)}
                </strong>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function ConfigurationRanking({
  items,
}: {
  items: StatisticsConfigurationRanking[];
}) {
  return (
    <section className="rounded-2xl border border-border-neutral bg-surface p-4">
      <h3 className="font-black text-text-primary">Caixas completas mais saídas</h3>
      <p className="mt-1 text-xs leading-5 font-semibold text-text-muted">
        Agrupadas pela configuração física; aliases não duplicam quantidades.
      </p>
      <div className="mt-3">
        {items.length === 0 ? (
          <EmptyRanking />
        ) : (
          <ol className="space-y-2">
            {items.slice(0, 5).map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl bg-violet-50 px-3 py-2.5"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-700 text-xs font-black text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm text-violet-950">
                    {item.aliases.join(" / ") || "Sem código ativo"}
                  </strong>
                  <span className="block truncate text-xs text-violet-800">
                    Servo {item.servoCode} + {item.installationKitCode}
                  </span>
                </span>
                <strong className="shrink-0 text-sm tabular-nums text-violet-950">
                  {quantityFormatter.format(item.quantity)}
                </strong>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function UnmovedSection({
  itemCount,
  configurationCount,
  items,
  configurations,
}: {
  itemCount: number;
  configurationCount: number;
  items: Array<{ id: string; code: string; description: string }>;
  configurations: Array<{
    id: string;
    aliases: string[];
    description: string;
  }>;
}) {
  return (
    <section className="rounded-2xl border border-border-neutral bg-surface p-4 sm:p-5">
      <div>
        <p className="text-xs font-black tracking-[0.14em] text-brand-gold-ink uppercase">
          Catálogo ativo
        </p>
        <h2 className="mt-1 text-xl font-black text-text-primary">
          Sem movimento no período
        </h2>
        <p className="mt-1 text-sm leading-6 font-semibold text-text-muted">
          Ausência de histórico no intervalo, independentemente do saldo atual.
        </p>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <details className="rounded-xl border border-border-neutral bg-app-background p-3">
          <summary className="nk-focus cursor-pointer rounded-lg text-sm font-black text-text-primary">
            Itens avulsos · {quantityFormatter.format(itemCount)}
          </summary>
          {items.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">
              Todos os itens ativos tiveram movimento.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-border-neutral bg-surface px-3 py-2"
                >
                  <strong className="text-sm text-text-primary">{item.code}</strong>
                  <span className="ml-2 text-xs text-text-muted">
                    {item.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
        <details className="rounded-xl border border-border-neutral bg-app-background p-3">
          <summary className="nk-focus cursor-pointer rounded-lg text-sm font-black text-text-primary">
            Caixas completas · {quantityFormatter.format(configurationCount)}
          </summary>
          {configurations.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">
              Todas as configurações ativas tiveram movimento.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {configurations.map((configuration) => (
                <li
                  key={configuration.id}
                  className="rounded-lg border border-border-neutral bg-surface px-3 py-2"
                >
                  <strong className="text-sm text-text-primary">
                    {configuration.aliases.join(" / ") || "Sem código ativo"}
                  </strong>
                  <span className="ml-2 text-xs text-text-muted">
                    {configuration.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </section>
  );
}

export default async function StatisticsPage({
  searchParams,
}: StatisticsPageProps) {
  const period = parseStatisticsPeriod(await searchParams);
  const result = await loadStatisticsData(period);
  const statistics = result.data;
  const attentionCount = statistics
    ? statistics.currentStock.lowStockItems +
      statistics.currentStock.outOfStockItems
    : 0;

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div>
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-charcoal text-brand-gold">
            <StatisticsIcon className="size-5" />
          </span>
          <div>
            <p className="text-[0.68rem] font-black tracking-[0.16em] text-brand-gold-ink uppercase">
              Histórico operacional
            </p>
            <h1 className="text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
              Estatísticas
            </h1>
            <p className="mt-1 text-sm font-semibold text-text-muted">
              Entradas, saídas externas e movimentações internas separadas.
            </p>
          </div>
        </div>
      </div>

      <nav
        aria-label="Período das estatísticas"
        className="mt-4 flex items-center gap-1 rounded-2xl border border-border-neutral bg-surface p-1.5"
      >
        {statisticsPeriods.map((option) => {
          const active = option === period;

          return (
            <Link
              key={option}
              href={`/estatisticas?periodo=${option}`}
              aria-current={active ? "page" : undefined}
              className={`nk-focus inline-flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm font-black transition ${
                active
                  ? "bg-brand-charcoal text-white shadow-sm"
                  : "text-text-muted hover:bg-app-background hover:text-text-primary"
              }`}
            >
              {option} dias
            </Link>
          );
        })}
      </nav>

      {result.error ? (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-5 text-sm leading-6 font-semibold text-red-900"
        >
          {result.error} Tente atualizar a página em alguns instantes.
        </div>
      ) : null}

      {statistics ? (
        <>
          <p className="mt-3 text-xs font-semibold text-text-muted">
            Período: {formatPeriodDate(statistics.periodStart)} a{" "}
            {formatPeriodDate(
              new Date(
                new Date(statistics.periodEndExclusive).getTime() -
                  24 * 60 * 60 * 1_000,
              ).toISOString(),
            )}
          </p>

          <section
            className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4"
            aria-label="Indicadores principais"
          >
            <MetricCard
              label="Entradas"
              value={statistics.totals.inbound}
              helper="Unidades recebidas externamente"
              tone="green"
            >
              <ComparisonLabel comparison={statistics.comparisons.inbound} />
            </MetricCard>
            <MetricCard
              label="Saídas externas"
              value={statistics.totals.outbound}
              helper="Unidades que deixaram o estoque"
              tone="red"
            >
              <ComparisonLabel comparison={statistics.comparisons.outbound} />
            </MetricCard>
            <MetricCard
              label="Montagens"
              value={statistics.totals.assembled}
              helper="Movimentação interna"
              tone="blue"
            />
            <MetricCard
              label="Desmontagens"
              value={statistics.totals.disassembled}
              helper="Movimentação interna"
              tone="violet"
            />
          </section>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <section className="rounded-2xl border border-border-neutral bg-surface p-4 sm:p-5 xl:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-black tracking-[0.14em] text-brand-gold-ink uppercase">
                    Movimento no tempo
                  </p>
                  <h2 className="mt-1 text-xl font-black text-text-primary">
                    Entradas e saídas externas
                  </h2>
                </div>
                <span className="rounded-full bg-app-background px-3 py-1 text-xs font-bold text-text-muted">
                  {period <= 30 ? "Agrupamento diário" : "Agrupamento semanal"}
                </span>
              </div>
              <div className="mt-5">
                <MovementChart points={statistics.timeline} />
              </div>
            </section>

            <section className="rounded-2xl border border-border-neutral bg-surface p-4 sm:p-5">
              <p className="text-xs font-black tracking-[0.14em] text-brand-gold-ink uppercase">
                Saídas de servos
              </p>
              <h2 className="mt-1 text-xl font-black text-text-primary">
                Com kit vs. sem kit
              </h2>
              <p className="mt-1 text-xs leading-5 font-semibold text-text-muted">
                Considera somente caixas completas e servos que saíram
                avulsos. Kits avulsos, reparos e peças entram no total geral,
                mas não nesta comparação.
              </p>
              <div className="mt-5 overflow-hidden rounded-full bg-app-background">
                <div className="flex h-5">
                  <span
                    className="bg-violet-700"
                    style={{
                      width: `${statistics.servoSales.withKitPercentage}%`,
                    }}
                    title={`Com kit: ${percentageFormatter.format(
                      statistics.servoSales.withKitPercentage,
                    )}%`}
                  />
                  <span
                    className="bg-brand-charcoal"
                    style={{
                      width: `${statistics.servoSales.withoutKitPercentage}%`,
                    }}
                    title={`Sem kit: ${percentageFormatter.format(
                      statistics.servoSales.withoutKitPercentage,
                    )}%`}
                  />
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-violet-50 p-3 text-violet-950">
                  <dt className="text-xs font-black uppercase">Com kit</dt>
                  <dd className="mt-1 text-xl font-black tabular-nums">
                    {quantityFormatter.format(statistics.servoSales.withKit)}
                  </dd>
                  <dd className="text-sm font-bold">
                    {percentageFormatter.format(
                      statistics.servoSales.withKitPercentage,
                    )}
                    %
                  </dd>
                </div>
                <div className="rounded-xl bg-slate-100 p-3 text-slate-950">
                  <dt className="text-xs font-black uppercase">Sem kit</dt>
                  <dd className="mt-1 text-xl font-black tabular-nums">
                    {quantityFormatter.format(statistics.servoSales.withoutKit)}
                  </dd>
                  <dd className="text-sm font-bold">
                    {percentageFormatter.format(
                      statistics.servoSales.withoutKitPercentage,
                    )}
                    %
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <OutboundCategories
              categories={statistics.outboundByCategory}
            />
            <PeriodHighlights highlights={statistics.highlights} />
          </div>

          <section className="mt-4" aria-labelledby="rankings-title">
            <div className="mb-3">
              <p className="text-xs font-black tracking-[0.14em] text-brand-gold-ink uppercase">
                Rankings
              </p>
              <h2
                id="rankings-title"
                className="mt-1 text-xl font-black text-text-primary"
              >
                Mais movimentados no período
              </h2>
            </div>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <ConfigurationRanking
                items={statistics.rankings.configurations}
              />
              <ItemRanking
                title="Servos avulsos mais saídos"
                description="Vendidos diretamente, sem kit."
                items={statistics.rankings.looseServos}
              />
              <ItemRanking
                title="Kits usados em caixas"
                description="Consumidos por montagens internas."
                items={statistics.rankings.kitsUsedInAssemblies}
              />
              <ItemRanking
                title="Kits saídos avulsos"
                description="Saídas externas sem caixa completa."
                items={statistics.rankings.looseKits}
              />
              <ItemRanking
                title="Jogos de reparo mais saídos"
                description="Saídas externas de reparos."
                items={statistics.rankings.repairKits}
              />
              <ItemRanking
                title="Peças avulsas mais saídas"
                description="Saídas externas de peças independentes."
                items={statistics.rankings.looseParts}
              />
            </div>
          </section>

          <div className="mt-4">
            <UnmovedSection
              itemCount={statistics.withoutMovement.items.length}
              configurationCount={
                statistics.withoutMovement.configurations.length
              }
              items={statistics.withoutMovement.items}
              configurations={statistics.withoutMovement.configurations}
            />
          </div>

          <section className="mt-4 rounded-2xl border border-brand-gold/30 bg-brand-gold-soft/45 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-charcoal text-brand-gold">
                <StockIcon className="size-5" />
              </span>
              <div>
                <p className="text-xs font-black tracking-[0.14em] text-brand-gold-ink uppercase">
                  Situação atual · não muda com o filtro
                </p>
                <h2 className="mt-1 text-lg font-black text-text-primary">
                  {attentionCount > 0
                    ? `${quantityFormatter.format(
                        attentionCount,
                      )} itens precisam de atenção`
                    : "Estoque em dia"}
                </h2>
                <p className="mt-1 text-sm font-semibold text-text-muted">
                  {attentionCount > 0
                    ? `${quantityFormatter.format(
                        statistics.currentStock.lowStockItems,
                      )} com estoque baixo · ${quantityFormatter.format(
                        statistics.currentStock.outOfStockItems,
                      )} zerados`
                    : "Nenhum item precisa de atenção no momento."}
                </p>
              </div>
            </div>
            {attentionCount > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
                <Link
                  href="/estoque?status=low"
                  aria-label={`Ver ${quantityFormatter.format(
                    statistics.currentStock.lowStockItems,
                  )} itens com estoque baixo`}
                  className="nk-focus rounded-xl border border-amber-200 bg-amber-50 p-3 transition hover:border-amber-400 hover:bg-amber-100"
                >
                  <span className="block text-xs font-black text-amber-950 uppercase">
                    Estoque baixo
                  </span>
                  <strong className="mt-1 block text-xl font-black text-amber-950">
                    {quantityFormatter.format(
                      statistics.currentStock.lowStockItems,
                    )}
                  </strong>
                </Link>
                <Link
                  href="/estoque?status=zero"
                  aria-label={`Ver ${quantityFormatter.format(
                    statistics.currentStock.outOfStockItems,
                  )} itens com estoque zerado`}
                  className="nk-focus rounded-xl border border-red-200 bg-red-50 p-3 transition hover:border-red-400 hover:bg-red-100"
                >
                  <span className="block text-xs font-black text-red-950 uppercase">
                    Estoque zerado
                  </span>
                  <strong className="mt-1 block text-xl font-black text-red-950">
                    {quantityFormatter.format(
                      statistics.currentStock.outOfStockItems,
                    )}
                  </strong>
                </Link>
              </div>
            ) : (
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <dt className="text-xs font-black text-emerald-950 uppercase">
                    Estoque baixo
                  </dt>
                  <dd className="mt-1 text-xl font-black text-emerald-950">
                    {quantityFormatter.format(
                      statistics.currentStock.lowStockItems,
                    )}
                  </dd>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <dt className="text-xs font-black text-emerald-950 uppercase">
                    Estoque zerado
                  </dt>
                  <dd className="mt-1 text-xl font-black text-emerald-950">
                    {quantityFormatter.format(
                      statistics.currentStock.outOfStockItems,
                    )}
                  </dd>
                </div>
              </dl>
            )}
            {attentionCount > 0 ? (
              <Link
                href="/estoque?status=attention"
                className="nk-focus mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
              >
                <StockIcon className="size-4" />
                Ver itens que precisam de atenção
              </Link>
            ) : (
              <Link
                href="/estoque"
                className="nk-focus mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-neutral bg-surface px-4 text-sm font-black text-text-primary transition hover:bg-app-background"
              >
                <StockIcon className="size-4" />
                Ver estoque
              </Link>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
