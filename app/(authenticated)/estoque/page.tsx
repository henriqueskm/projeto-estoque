import Link from "next/link";
import { CommercialConfigurationImage } from "@/components/commercial-configuration-image";
import { ArrowLeftIcon, SearchIcon, StockIcon } from "@/components/icons";
import {
  loadInventoryData,
  parseInventoryFilters,
} from "@/lib/inventory-data";
import type {
  InventoryCommercialConfiguration,
  InventoryFilters,
  InventoryPhysicalItem,
  InventorySearchParams,
  StockState,
} from "@/lib/inventory-types";

type InventoryPageProps = {
  searchParams: Promise<InventorySearchParams>;
};

const quantityFormatter = new Intl.NumberFormat("pt-BR");

const physicalStateDetails: Record<
  StockState,
  { label: string; className: string }
> = {
  AVAILABLE: {
    label: "Disponível",
    className: "bg-emerald-100 text-emerald-900",
  },
  LOW: {
    label: "Estoque baixo",
    className: "bg-amber-100 text-amber-950",
  },
  ZERO: {
    label: "Zerado",
    className: "bg-red-100 text-red-900",
  },
};

function createInventoryHref(
  filters: InventoryFilters,
  changes: Partial<InventoryFilters> = {},
) {
  const nextFilters = { ...filters, ...changes };
  const params = new URLSearchParams();

  params.set("aba", nextFilters.tab);

  if (nextFilters.query) {
    params.set("q", nextFilters.query);
  }

  if (nextFilters.tab === "fisicos") {
    if (nextFilters.type !== "todos") {
      params.set("tipo", nextFilters.type);
    }

    if (nextFilters.stockState !== "todos") {
      params.set("situacao", nextFilters.stockState);
    }
  } else if (nextFilters.mountedState !== "todos") {
    params.set("montado", nextFilters.mountedState);
  }

  if (nextFilters.page > 1) {
    params.set("pagina", String(nextFilters.page));
  }

  return `/estoque?${params.toString()}`;
}

function Quantity({ value }: { value: number }) {
  return (
    <span className="font-mono font-extrabold tabular-nums text-text-primary">
      {quantityFormatter.format(value)}
    </span>
  );
}

function PhysicalStateBadge({ state }: { state: StockState }) {
  const details = physicalStateDetails[state];

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${details.className}`}
    >
      {details.label}
    </span>
  );
}

function ConfigurationStateBadge({
  assembledQuantity,
}: {
  assembledQuantity: number;
}) {
  const hasBalance = assembledQuantity > 0;

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
        hasBalance
          ? "bg-violet-100 text-violet-900"
          : "bg-slate-100 text-slate-700"
      }`}
    >
      {hasBalance ? "Montado disponível" : "Sem unidades montadas"}
    </span>
  );
}

function CommercialCodeBadges({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Códigos comerciais">
      {codes.map((code) => (
        <span
          key={code}
          className="rounded-lg bg-violet-100 px-2.5 py-1 font-mono text-sm font-black text-violet-900"
        >
          {code}
        </span>
      ))}
    </div>
  );
}

type PhysicalBalanceDetail = {
  label: string;
  accessibleDescription?: string;
  value: number;
  containerClassName: string;
  labelClassName: string;
};

function getPhysicalBalanceDetails(
  item: InventoryPhysicalItem,
): PhysicalBalanceDetail[] {
  if (item.itemType === "SERVO") {
    return [
      {
        label: "Sem kit",
        accessibleDescription: "Servos armazenados sem kit",
        value: item.looseQuantity,
        containerClassName: "bg-app-background",
        labelClassName: "text-text-muted",
      },
      {
        label: "Com kit",
        accessibleDescription:
          "Servos que estão dentro de configurações montadas",
        value: item.mountedQuantity,
        containerClassName: "bg-violet-50",
        labelClassName: "text-violet-800",
      },
      {
        label: "Total de servos",
        value: item.totalQuantity,
        containerClassName: "bg-emerald-50",
        labelClassName: "text-emerald-800",
      },
      {
        label: "Mínimo",
        value: item.minimumStock,
        containerClassName: "bg-app-background",
        labelClassName: "text-text-muted",
      },
    ];
  }

  if (item.itemType === "INSTALLATION_KIT") {
    return [
      {
        label: "Separados",
        accessibleDescription: "Kits disponíveis fora das caixas",
        value: item.looseQuantity,
        containerClassName: "bg-app-background",
        labelClassName: "text-text-muted",
      },
      {
        label: "Dentro de caixas",
        accessibleDescription: "Kits presentes em configurações montadas",
        value: item.mountedQuantity,
        containerClassName: "bg-violet-50",
        labelClassName: "text-violet-800",
      },
      {
        label: "Total de kits",
        value: item.totalQuantity,
        containerClassName: "bg-emerald-50",
        labelClassName: "text-emerald-800",
      },
      {
        label: "Mínimo",
        value: item.minimumStock,
        containerClassName: "bg-app-background",
        labelClassName: "text-text-muted",
      },
    ];
  }

  return [
    {
      label: "Quantidade",
      value: item.looseQuantity,
      containerClassName: "bg-emerald-50",
      labelClassName: "text-emerald-800",
    },
    {
      label: "Mínimo",
      value: item.minimumStock,
      containerClassName: "bg-app-background",
      labelClassName: "text-text-muted",
    },
  ];
}

function PhysicalBalanceGrid({
  item,
  variant,
}: {
  item: InventoryPhysicalItem;
  variant: "card" | "table";
}) {
  const details = getPhysicalBalanceDetails(item);
  const columnsClassName =
    details.length === 2
      ? "grid-cols-2"
      : variant === "card"
        ? "grid-cols-2 sm:grid-cols-4"
        : "grid-cols-2 xl:grid-cols-4";

  return (
    <dl
      className={`grid gap-2 ${columnsClassName} ${
        variant === "card"
          ? "mt-4 border-t border-border-neutral/70 pt-4"
          : ""
      }`}
    >
      {details.map((detail) => (
        <div
          key={detail.label}
          className={`rounded-xl px-3 py-3 ${detail.containerClassName}`}
        >
          <dt
            title={detail.accessibleDescription}
            className={`text-xs font-bold uppercase tracking-wide ${detail.labelClassName}`}
          >
            {detail.label}
            {detail.accessibleDescription ? (
              <span className="sr-only">
                : {detail.accessibleDescription}
              </span>
            ) : null}
          </dt>
          <dd className="mt-1 text-lg lg:text-right">
            <Quantity value={detail.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PhysicalCards({ items }: { items: InventoryPhysicalItem[] }) {
  return (
    <div className="grid gap-3 lg:hidden">
      {items.map((item) => (
        <article
          key={item.id}
          className="min-w-0 rounded-2xl border border-border-neutral bg-surface p-4 shadow-sm sm:p-5"
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xl font-black tracking-tight text-text-primary">
                {item.code}
              </p>
              <p className="mt-1 break-words text-sm leading-6 font-semibold text-text-primary">
                {item.description}
              </p>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-text-muted">
                {item.typeLabel}
              </p>
            </div>
            <PhysicalStateBadge state={item.state} />
          </div>

          {item.itemType === "SERVO" ? (
            <p className="mt-3 text-sm text-text-muted">
              Modelo:{" "}
              <strong className="text-text-primary">
                {item.model || "Modelo não informado"}
              </strong>
            </p>
          ) : null}

          <PhysicalBalanceGrid item={item} variant="card" />
        </article>
      ))}
    </div>
  );
}

function PhysicalTable({ items }: { items: InventoryPhysicalItem[] }) {
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border-neutral bg-surface shadow-sm lg:block">
      <table className="w-full table-fixed border-collapse text-left">
        <thead className="bg-brand-charcoal text-xs uppercase tracking-wide text-slate-200">
          <tr>
            <th scope="col" className="w-[29%] px-4 py-3 font-bold">
              Item
            </th>
            <th scope="col" className="w-[14%] px-3 py-3 font-bold">
              Tipo
            </th>
            <th scope="col" className="w-[42%] px-3 py-3 font-bold">
              Saldos
            </th>
            <th scope="col" className="w-[15%] px-4 py-3 font-bold">
              Situação
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-t border-border-neutral/70 align-top"
            >
              <th scope="row" className="px-4 py-4 font-normal">
                <p className="font-mono text-base font-black text-text-primary">
                  {item.code}
                </p>
                <p className="mt-1 break-words text-sm leading-5 font-semibold text-text-primary">
                  {item.description}
                </p>
                {item.itemType === "SERVO" ? (
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    Modelo: {item.model || "Modelo não informado"}
                  </p>
                ) : null}
              </th>
              <td className="px-3 py-4 text-sm leading-5 font-semibold text-text-muted">
                {item.typeLabel}
              </td>
              <td className="px-3 py-4">
                <PhysicalBalanceGrid item={item} variant="table" />
              </td>
              <td className="px-4 py-4">
                <PhysicalStateBadge state={item.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigurationCards({
  configurations,
}: {
  configurations: InventoryCommercialConfiguration[];
}) {
  return (
    <div className="grid gap-3 lg:hidden">
      {configurations.map((configuration) => (
        <article
          key={configuration.id}
          className="min-w-0 rounded-2xl border border-violet-200 bg-surface p-4 shadow-sm sm:p-5"
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <CommercialCodeBadges codes={configuration.codes} />
            <ConfigurationStateBadge
              assembledQuantity={configuration.assembledQuantity}
            />
          </div>
          <h3 className="mt-3 break-words text-base leading-6 font-extrabold text-text-primary">
            {configuration.description}
          </h3>
          <CommercialConfigurationImage
            commercialCodes={configuration.codes}
            imageUrl={configuration.imageUrl}
          />
          {configuration.hasAliases ? (
            <p className="mt-2 text-xs font-bold leading-5 text-violet-800">
              Saldo compartilhado entre estes códigos
            </p>
          ) : null}

          <div className="mt-4 grid gap-2 border-t border-border-neutral/70 pt-4 sm:grid-cols-2">
            <div className="rounded-xl bg-emerald-50 px-3 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                Servo
              </p>
              <p className="mt-1 font-mono font-black text-text-primary">
                {configuration.servo.code}
              </p>
              <p className="mt-1 break-words text-sm leading-5 text-text-muted">
                {configuration.servo.description}
              </p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Modelo:{" "}
                {configuration.servo.model || "Modelo não informado"}
              </p>
            </div>
            <div className="rounded-xl bg-sky-50 px-3 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-sky-800">
                Kit
              </p>
              <p className="mt-1 font-mono font-black text-text-primary">
                {configuration.installationKit.code}
              </p>
              <p className="mt-1 break-words text-sm leading-5 text-text-muted">
                {configuration.installationKit.description}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-violet-50 px-3 py-3">
            <span className="text-sm font-bold text-violet-900">
              Caixas montadas
            </span>
            <span className="text-xl">
              <Quantity value={configuration.assembledQuantity} />
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ConfigurationTable({
  configurations,
}: {
  configurations: InventoryCommercialConfiguration[];
}) {
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-violet-200 bg-surface shadow-sm lg:block">
      <table className="w-full table-fixed border-collapse text-left">
        <thead className="bg-brand-charcoal text-xs uppercase tracking-wide text-slate-200">
          <tr>
            <th scope="col" className="w-[22%] px-4 py-3 font-bold">
              Códigos comerciais
            </th>
            <th scope="col" className="w-[31%] px-4 py-3 font-bold">
              Configuração
            </th>
            <th scope="col" className="w-[17%] px-4 py-3 font-bold">
              Servo
            </th>
            <th scope="col" className="w-[14%] px-4 py-3 font-bold">
              Kit
            </th>
            <th scope="col" className="w-[7%] px-3 py-3 text-right font-bold">
              Caixas montadas
            </th>
            <th scope="col" className="w-[9%] px-4 py-3 font-bold">
              Estado
            </th>
          </tr>
        </thead>
        <tbody>
          {configurations.map((configuration) => (
            <tr
              key={configuration.id}
              className="border-t border-border-neutral/70 align-top"
            >
              <th scope="row" className="px-4 py-4 font-normal">
                <CommercialCodeBadges codes={configuration.codes} />
                {configuration.hasAliases ? (
                  <p className="mt-2 text-xs font-bold leading-5 text-violet-800">
                    Saldo compartilhado entre estes códigos
                  </p>
                ) : null}
              </th>
              <td className="px-4 py-4 text-sm leading-5 font-semibold text-text-primary">
                {configuration.description}
                <CommercialConfigurationImage
                  commercialCodes={configuration.codes}
                  imageUrl={configuration.imageUrl}
                  compact
                />
              </td>
              <td className="px-4 py-4">
                <p className="font-mono text-sm font-black text-text-primary">
                  {configuration.servo.code}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {configuration.servo.description}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Modelo:{" "}
                  {configuration.servo.model || "Modelo não informado"}
                </p>
              </td>
              <td className="px-4 py-4">
                <p className="font-mono text-sm font-black text-text-primary">
                  {configuration.installationKit.code}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {configuration.installationKit.description}
                </p>
              </td>
              <td className="bg-violet-50/60 px-3 py-4 text-right">
                <Quantity value={configuration.assembledQuantity} />
              </td>
              <td className="px-4 py-4">
                <ConfigurationStateBadge
                  assembledQuantity={configuration.assembledQuantity}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  filters,
  currentPage,
  totalPages,
  totalResults,
}: {
  filters: InventoryFilters;
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
      aria-label="Paginação do estoque"
    >
      {currentPage > 1 ? (
        <Link
          href={createInventoryHref(filters, { page: currentPage - 1 })}
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
        Página{" "}
        <strong className="text-text-primary">{currentPage}</strong> de{" "}
        <strong className="text-text-primary">{totalPages}</strong>
        <span className="block text-xs font-normal sm:inline">
          {" "}
          · {quantityFormatter.format(totalResults)}{" "}
          {totalResults === 1 ? "resultado" : "resultados"}
        </span>
      </p>

      {currentPage < totalPages ? (
        <Link
          href={createInventoryHref(filters, { page: currentPage + 1 })}
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

export default async function InventoryPage({
  searchParams,
}: InventoryPageProps) {
  const filters = parseInventoryFilters(await searchParams);
  const inventoryResult = await loadInventoryData(filters);
  const inventory = inventoryResult.data;
  const activeTabCount =
    filters.tab === "fisicos"
      ? inventory?.physicalCatalogCount
      : inventory?.configurationCatalogCount;
  const currentItems =
    filters.tab === "fisicos"
      ? (inventory?.physicalItems ?? [])
      : (inventory?.configurations ?? []);
  const summaryCards = [
    {
      label: "Itens físicos ativos",
      value: inventory?.summary.activePhysicalItems,
    },
    {
      label: "Unidades avulsas",
      value: inventory?.summary.looseUnits,
    },
    {
      label: "Configurações montadas",
      value: inventory?.summary.mountedConfigurations,
    },
    {
      label: "Estoque baixo",
      value: inventory?.summary.lowStockItems,
    },
    {
      label: "Itens zerados",
      value: inventory?.summary.zeroStockItems,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
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
            <StockIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-black tracking-[0.2em] text-brand-gold uppercase">
              Consulta · Somente leitura
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Estoque completo
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200 sm:text-base sm:leading-7">
              Consulte itens físicos, saldos avulsos e configurações comerciais
              sem alterar o estoque.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-5" aria-labelledby="inventory-summary-title">
        <h2 id="inventory-summary-title" className="sr-only">
          Indicadores do estoque
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {summaryCards.map((summary) => (
            <article
              key={summary.label}
              className="rounded-2xl border border-border-neutral bg-surface p-4 shadow-sm"
            >
              <p className="text-xs leading-5 font-bold text-text-muted sm:text-sm">
                {summary.label}
              </p>
              <p className="mt-2 text-2xl font-black text-text-primary sm:text-3xl">
                {summary.value === undefined
                  ? "—"
                  : quantityFormatter.format(summary.value)}
              </p>
            </article>
          ))}
        </div>
        <p className="mt-2 text-xs leading-5 text-text-muted">
          Unidades avulsas e configurações montadas são contadas separadamente.
          Cada configuração montada contém um servo e um kit físico.
        </p>
      </section>

      <nav
        className="mt-7 grid grid-cols-2 rounded-2xl border border-border-neutral bg-surface p-1 shadow-sm"
        aria-label="Tipo de consulta do estoque"
      >
        <Link
          href={createInventoryHref(filters, {
            tab: "fisicos",
            type: "todos",
            stockState: "todos",
            mountedState: "todos",
            page: 1,
          })}
          aria-current={filters.tab === "fisicos" ? "page" : undefined}
          className={`nk-focus inline-flex min-h-12 items-center justify-center rounded-xl px-3 text-center text-sm font-black transition ${
            filters.tab === "fisicos"
              ? "bg-brand-charcoal text-white shadow-sm"
              : "text-text-muted hover:bg-app-background hover:text-text-primary"
          }`}
        >
          Itens físicos
        </Link>
        <Link
          href={createInventoryHref(filters, {
            tab: "configuracoes",
            type: "todos",
            stockState: "todos",
            mountedState: "todos",
            page: 1,
          })}
          aria-current={filters.tab === "configuracoes" ? "page" : undefined}
          className={`nk-focus inline-flex min-h-12 items-center justify-center rounded-xl px-3 text-center text-sm font-black transition ${
            filters.tab === "configuracoes"
              ? "bg-violet-800 text-white shadow-sm"
              : "text-text-muted hover:bg-violet-50 hover:text-violet-900"
          }`}
        >
          Configurações comerciais
        </Link>
      </nav>

      <section className="nk-panel mt-4 p-4 sm:p-5" aria-labelledby="filters-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
              Catálogo
            </p>
            <h2
              id="filters-title"
              className="mt-1 text-lg font-black text-text-primary"
            >
              Pesquisar e filtrar
            </h2>
          </div>
          <span className="rounded-full bg-app-background px-3 py-1 text-xs font-bold text-text-muted">
            {activeTabCount === undefined
              ? "Catálogo indisponível"
              : `${quantityFormatter.format(activeTabCount)} ${
                  activeTabCount === 1 ? "cadastro ativo" : "cadastros ativos"
                }`}
          </span>
        </div>

        <form
          action="/estoque"
          method="get"
          className="mt-4 grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_13rem_13rem_auto]"
        >
          <input type="hidden" name="aba" value={filters.tab} />
          <label className="min-w-0">
            <span className="mb-1.5 block text-sm font-bold text-text-primary">
              Pesquisa
            </span>
            <span className="relative block">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                name="q"
                maxLength={100}
                defaultValue={filters.query}
                placeholder={
                  filters.tab === "fisicos"
                    ? "Código, descrição, modelo ou tipo"
                    : "Código comercial, servo ou kit"
                }
                className="nk-field min-h-12 w-full rounded-xl border py-2 pr-3 pl-11 text-base outline-none"
              />
            </span>
          </label>

          {filters.tab === "fisicos" ? (
            <>
              <label>
                <span className="mb-1.5 block text-sm font-bold text-text-primary">
                  Tipo
                </span>
                <select
                  name="tipo"
                  defaultValue={filters.type}
                  className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
                >
                  <option value="todos">Todos os tipos</option>
                  <option value="servo">Servoembreagens</option>
                  <option value="kit-instalacao">Kits de instalação</option>
                  <option value="jogo-reparo">Jogos de reparo</option>
                  <option value="peca-avulsa">Peças avulsas</option>
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-bold text-text-primary">
                  Situação
                </span>
                <select
                  name="situacao"
                  defaultValue={filters.stockState}
                  className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
                >
                  <option value="todos">Todas</option>
                  <option value="disponivel">Disponível</option>
                  <option value="baixo">Estoque baixo</option>
                  <option value="zerado">Zerado</option>
                </select>
              </label>
            </>
          ) : (
            <label className="lg:col-span-2">
              <span className="mb-1.5 block text-sm font-bold text-text-primary">
                Saldo montado
              </span>
              <select
                name="montado"
                defaultValue={filters.mountedState}
                className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
              >
                <option value="todos">Todas</option>
                <option value="com-saldo">Com saldo montado</option>
                <option value="sem-saldo">Sem saldo montado</option>
              </select>
            </label>
          )}

          <div className="flex flex-col gap-2 sm:flex-row lg:items-end">
            <button
              type="submit"
              className="nk-focus min-h-12 flex-1 rounded-xl bg-brand-charcoal px-5 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
            >
              Aplicar filtros
            </button>
            <Link
              href={`/estoque?aba=${filters.tab}`}
              className="nk-focus inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-border-neutral bg-surface px-4 text-sm font-bold text-text-primary transition hover:bg-app-background"
            >
              Limpar filtros
            </Link>
          </div>
        </form>
      </section>

      {inventoryResult.error ? (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-5 text-sm leading-6 font-semibold text-red-900"
        >
          {inventoryResult.error} Tente atualizar a página em alguns instantes.
        </div>
      ) : null}

      {inventory ? (
        <section className="mt-5 pb-8" aria-labelledby="inventory-results-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
                Resultados
              </p>
              <h2
                id="inventory-results-title"
                className="mt-1 text-xl font-black text-text-primary"
              >
                {filters.tab === "fisicos"
                  ? "Itens físicos"
                  : "Configurações comerciais"}
              </h2>
            </div>
            <p className="text-sm font-semibold text-text-muted">
              {quantityFormatter.format(
                inventory.pagination.totalResults,
              )}{" "}
              {inventory.pagination.totalResults === 1
                ? "resultado"
                : "resultados"}
            </p>
          </div>

          {activeTabCount === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-10 text-center">
              <p className="font-black text-text-primary">
                Nenhum cadastro ativo para exibir.
              </p>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                O catálogo desta aba está vazio.
              </p>
            </div>
          ) : currentItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-10 text-center">
              <p className="font-black text-text-primary">
                Nenhum resultado encontrado.
              </p>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                Ajuste a pesquisa ou limpe os filtros para consultar o catálogo.
              </p>
              <Link
                href={`/estoque?aba=${filters.tab}`}
                className="nk-focus mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-charcoal px-5 text-sm font-black text-white"
              >
                Limpar filtros
              </Link>
            </div>
          ) : filters.tab === "fisicos" ? (
            <>
              <PhysicalCards items={inventory.physicalItems} />
              <PhysicalTable items={inventory.physicalItems} />
            </>
          ) : (
            <>
              <ConfigurationCards
                configurations={inventory.configurations}
              />
              <ConfigurationTable
                configurations={inventory.configurations}
              />
            </>
          )}

          <Pagination
            filters={filters}
            currentPage={inventory.pagination.currentPage}
            totalPages={inventory.pagination.totalPages}
            totalResults={inventory.pagination.totalResults}
          />
        </section>
      ) : null}
    </main>
  );
}
