import Link from "next/link";
import { ArrowLeftIcon, SearchIcon, StockIcon } from "@/components/icons";
import { InventoryRowActions } from "@/components/inventory-row-actions";
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
      className={`inline-flex rounded-full px-2 py-0.5 text-[0.65rem] leading-4 font-bold sm:text-xs ${details.className}`}
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
      className={`inline-flex rounded-full px-2 py-0.5 text-[0.65rem] leading-4 font-bold sm:text-xs ${
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
    <div className="flex flex-wrap gap-1" aria-label="Códigos comerciais">
      {codes.map((code) => (
        <span
          key={code}
          className="rounded-md bg-violet-100 px-1.5 py-0.5 font-mono text-xs font-black text-violet-900 sm:text-sm"
        >
          {code}
        </span>
      ))}
    </div>
  );
}

function PhysicalBalanceSummary({ item }: { item: InventoryPhysicalItem }) {
  if (item.itemType === "SERVO") {
    return (
      <span title="Servos sem kit e servos presentes em configurações montadas">
        {quantityFormatter.format(item.looseQuantity)} sem kit ·{" "}
        {quantityFormatter.format(item.mountedQuantity)} com kit
      </span>
    );
  }

  if (item.itemType === "INSTALLATION_KIT") {
    return (
      <span title="Kits separados e kits presentes dentro de caixas montadas">
        {quantityFormatter.format(item.looseQuantity)} separados ·{" "}
        {quantityFormatter.format(item.mountedQuantity)} em caixas
      </span>
    );
  }

  return null;
}

const stickyHeaderClassName =
  "sticky top-16 z-30 bg-brand-charcoal px-2 py-2.5 text-[0.65rem] font-bold uppercase tracking-wide text-slate-200 sm:px-3 sm:text-xs";

function PhysicalTable({ items }: { items: InventoryPhysicalItem[] }) {
  return (
    <div className="relative rounded-2xl border border-border-neutral bg-surface shadow-sm">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          Itens avulsos, quantidades, estoque mínimo e ações disponíveis
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[18%] sm:w-[14%]`}
            >
              Código
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[45%] sm:w-[48%]`}
            >
              Descrição
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[15%] text-right sm:w-[16%]`}
            >
              <span className="sm:hidden">Qtd.</span>
              <span className="hidden sm:inline">Quantidade</span>
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[10%] text-right sm:w-[12%]`}
            >
              Mín.
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[12%] text-center sm:w-[10%]`}
            >
              <span className="sr-only sm:not-sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="align-middle transition hover:bg-app-background/70"
            >
              <th
                scope="row"
                className="border-t border-border-neutral/70 px-2 py-3 font-normal sm:px-3"
              >
                <span className="break-all font-mono text-xs font-black text-text-primary sm:text-sm">
                  {item.code}
                </span>
              </th>
              <td className="border-t border-border-neutral/70 px-2 py-3 sm:px-3">
                <p className="line-clamp-2 break-words text-xs leading-4 font-bold text-text-primary sm:text-sm sm:leading-5">
                  {item.description}
                </p>
                <p className="mt-0.5 break-words text-[0.65rem] leading-4 font-semibold text-text-muted sm:text-xs">
                  {item.typeLabel}
                  {item.itemType === "SERVO" && item.model
                    ? ` · ${item.model}`
                    : ""}
                </p>
                {item.itemType === "SERVO" ||
                item.itemType === "INSTALLATION_KIT" ? (
                  <p className="mt-1 text-[0.65rem] leading-4 text-text-muted sm:text-xs">
                    <PhysicalBalanceSummary item={item} />
                  </p>
                ) : null}
                <span className="mt-1 inline-flex">
                  <PhysicalStateBadge state={item.state} />
                </span>
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-3 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={item.totalQuantity} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-3 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={item.minimumStock} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-3 text-center sm:px-3">
                <InventoryRowActions
                  target={{
                    kind: "ITEM",
                    itemId: item.id,
                    code: item.code,
                    description: item.description,
                    itemType: item.itemType,
                    looseQuantity: item.looseQuantity,
                    mountedQuantity: item.mountedQuantity,
                    minimumStock: item.minimumStock,
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigurationTable({
  configurations,
}: {
  configurations: InventoryCommercialConfiguration[];
}) {
  return (
    <div className="relative rounded-2xl border border-violet-200 bg-surface shadow-sm">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          Caixas completas, saldos montados e ações disponíveis
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[23%] sm:w-[20%]`}
            >
              Código
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[47%] sm:w-[54%]`}
            >
              Configuração
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[15%] text-right sm:w-[14%]`}
            >
              <span className="sm:hidden">Qtd.</span>
              <span className="hidden sm:inline">Caixas</span>
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[15%] text-center sm:w-[12%]`}
            >
              <span className="sr-only sm:not-sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {configurations.map((configuration) => (
            <tr
              key={configuration.id}
              className="align-middle transition hover:bg-violet-50/50"
            >
              <th
                scope="row"
                className="border-t border-border-neutral/70 px-2 py-3 font-normal sm:px-3"
              >
                <CommercialCodeBadges codes={configuration.codes} />
                {configuration.hasAliases ? (
                  <span className="mt-1 block text-[0.6rem] leading-3 font-bold text-violet-800 sm:text-[0.65rem]">
                    Saldo compartilhado
                  </span>
                ) : null}
              </th>
              <td className="border-t border-border-neutral/70 px-2 py-3 sm:px-3">
                <p className="line-clamp-2 break-words text-xs leading-4 font-bold text-text-primary sm:text-sm sm:leading-5">
                  {configuration.description}
                </p>
                <p className="mt-1 break-words text-[0.65rem] leading-4 text-text-muted sm:text-xs">
                  Servo {configuration.servo.code} · Kit{" "}
                  {configuration.installationKit.code}
                </p>
                <span className="mt-1 inline-flex">
                  <ConfigurationStateBadge
                    assembledQuantity={configuration.assembledQuantity}
                  />
                </span>
              </td>
              <td className="border-t border-border-neutral/70 bg-violet-50/50 px-1 py-3 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={configuration.assembledQuantity} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-3 text-center sm:px-3">
                <InventoryRowActions
                  target={{
                    kind: "CONFIGURATION",
                    configurationId: configuration.id,
                    commercialCodes: configuration.codes,
                    description: configuration.description,
                    assembledQuantity: configuration.assembledQuantity,
                  }}
                  imageUrl={configuration.imageUrl}
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
      label: "Caixas completas",
      value: inventory?.summary.completeBoxesTotal,
    },
    {
      label: "Servos avulsos",
      value: inventory?.summary.looseServoTotal,
    },
    {
      label: "Kits avulsos",
      value: inventory?.summary.looseKitTotal,
    },
    {
      label: "Reparos",
      value: inventory?.summary.repairKitTotal,
    },
    {
      label: "Peças avulsas",
      value: inventory?.summary.loosePartTotal,
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
          Caixas completas representam configurações montadas. Os demais
          indicadores mostram os saldos físicos separados por tipo.
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
          Itens avulsos
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
          Caixas completas
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
                  ? "Itens avulsos"
                  : "Caixas completas"}
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
            <PhysicalTable items={inventory.physicalItems} />
          ) : (
            <ConfigurationTable configurations={inventory.configurations} />
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
