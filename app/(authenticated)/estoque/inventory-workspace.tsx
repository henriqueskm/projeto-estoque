"use client";

import {
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import { InventoryRowActions } from "@/components/inventory-row-actions";
import { getServoFamilyLabel } from "@/lib/inventory-family";
import type {
  InventoryCommercialConfiguration,
  InventoryData,
  InventoryPhysicalItem,
  StockState,
} from "@/lib/inventory-types";
import type {
  ConfigurationStockState,
  PhysicalStockItemType,
} from "@/lib/stock-calculations";

type InventoryWorkspaceProps = {
  inventory: InventoryData;
  initialStatusFilter?: InventoryStatusFilter;
};

export type InventoryStatusFilter =
  | "all"
  | "with-stock"
  | "attention"
  | "zero"
  | "low"
  | "with-minimum";

type InventorySort = "code" | "description" | "quantity";

type PhysicalGroupDefinition = {
  itemType: PhysicalStockItemType;
  title: string;
  description: string;
};

const quantityFormatter = new Intl.NumberFormat("pt-BR");

const physicalGroups: PhysicalGroupDefinition[] = [
  {
    itemType: "SERVO",
    title: "Servoembreagens",
    description: "Servos avulsos e presentes em caixas",
  },
  {
    itemType: "INSTALLATION_KIT",
    title: "Kits de instalação",
    description: "Kits separados e presentes em caixas",
  },
  {
    itemType: "REPAIR_KIT",
    title: "Jogos de reparo",
    description: "Jogos e kits de reparo",
  },
  {
    itemType: "LOOSE_PART",
    title: "Peças avulsas",
    description: "Componentes avulsos cadastrados",
  },
];

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

const configurationStateDetails: Record<
  ConfigurationStockState,
  { label: string; className: string }
> = {
  AVAILABLE: {
    label: "Montado disponível",
    className: "bg-violet-100 text-violet-900",
  },
  LOW: {
    label: "Estoque baixo",
    className: "bg-amber-100 text-amber-950",
  },
  ZERO: {
    label: "Zerado",
    className: "bg-red-100 text-red-900",
  },
  EMPTY: {
    label: "Sem unidades montadas",
    className: "bg-slate-100 text-slate-700",
  },
};

const stickyHeaderClassName =
  "sticky top-16 z-30 bg-brand-charcoal px-2 py-2 text-[0.62rem] font-bold uppercase tracking-wide text-slate-200 sm:px-3 sm:text-xs";

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function compareText(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function matchesSearch(
  normalizedQuery: string,
  values: Array<string | null | undefined>,
) {
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) =>
    value ? normalizeSearch(value).includes(normalizedQuery) : false,
  );
}

function matchesStatus(
  quantity: number,
  minimumStock: number,
  state: StockState | ConfigurationStockState,
  filter: InventoryStatusFilter,
) {
  if (filter === "with-stock") {
    return quantity > 0;
  }

  if (filter === "zero") {
    return minimumStock > 0 && quantity === 0;
  }

  if (filter === "attention") {
    return minimumStock > 0 && (state === "LOW" || quantity === 0);
  }

  if (filter === "low") {
    return minimumStock > 0 && state === "LOW";
  }

  if (filter === "with-minimum") {
    return minimumStock > 0;
  }

  return true;
}

function Quantity({ value }: { value: number }) {
  return (
    <span className="font-mono font-extrabold tabular-nums text-text-primary">
      {quantityFormatter.format(value)}
    </span>
  );
}

function PhysicalStateBadge({ item }: { item: InventoryPhysicalItem }) {
  const details =
    item.totalQuantity === 0 && item.minimumStock === 0
      ? {
          label: "Sem saldo",
          className: "bg-slate-100 text-slate-700",
        }
      : physicalStateDetails[item.state];

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[0.65rem] leading-4 font-bold sm:text-xs ${details.className}`}
    >
      {details.label}
    </span>
  );
}

function ConfigurationStateBadge({
  state,
}: {
  state: ConfigurationStockState;
}) {
  const details = configurationStateDetails[state];

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[0.65rem] leading-4 font-bold sm:text-xs ${details.className}`}
    >
      {details.label}
    </span>
  );
}

function CommercialCodeBadges({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <span className="text-xs font-bold text-text-muted">
        Sem código comercial
      </span>
    );
  }

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

function InventoryAccordion({
  children,
  count,
  description,
  id,
  isOpen,
  onToggle,
  title,
}: {
  children: ReactNode;
  count: number;
  description?: string;
  id: string;
  isOpen: boolean;
  onToggle: () => void;
  title: string;
}) {
  const panelId = `${id}-panel`;

  return (
    <section className="rounded-xl border border-border-neutral bg-surface shadow-sm">
      <h3>
        <button
          id={id}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="nk-focus flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-app-background sm:px-4"
        >
          <span className="min-w-0">
            <span className="block text-sm font-black text-text-primary sm:text-base">
              {title}
            </span>
            {description ? (
              <span className="mt-0.5 block truncate text-[0.68rem] font-semibold text-text-muted sm:text-xs">
                {description}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-brand-gold-soft px-2.5 py-1 text-xs font-black text-brand-charcoal">
              {quantityFormatter.format(count)}
            </span>
            <ChevronDownIcon
              className={`size-5 text-text-muted transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>
      </h3>
      {isOpen ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={id}
          className="border-t border-border-neutral"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

function PhysicalTable({ items }: { items: InventoryPhysicalItem[] }) {
  return (
    <div className="relative bg-surface">
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
                className="border-t border-border-neutral/70 px-2 py-2.5 font-normal sm:px-3"
              >
                <span className="break-all font-mono text-xs font-black text-text-primary sm:text-sm">
                  {item.code}
                </span>
              </th>
              <td className="border-t border-border-neutral/70 px-2 py-2.5 sm:px-3">
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
                  <p className="mt-0.5 text-[0.65rem] leading-4 text-text-muted sm:text-xs">
                    <PhysicalBalanceSummary item={item} />
                  </p>
                ) : null}
                <span className="mt-1 inline-flex">
                  <PhysicalStateBadge item={item} />
                </span>
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-2.5 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={item.totalQuantity} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-2.5 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={item.minimumStock} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-2.5 text-center sm:px-3">
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
    <div className="relative bg-surface">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          Caixas completas, saldos montados, estoque mínimo e ações disponíveis
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[22%] sm:w-[18%]`}
            >
              Código
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[38%] sm:w-[46%]`}
            >
              Configuração
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[14%] text-right sm:w-[12%]`}
            >
              <span className="sm:hidden">Qtd.</span>
              <span className="hidden sm:inline">Caixas</span>
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[12%] text-right sm:w-[12%]`}
            >
              Mín.
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[14%] text-center sm:w-[12%]`}
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
                className="border-t border-border-neutral/70 px-2 py-2.5 font-normal sm:px-3"
              >
                <CommercialCodeBadges codes={configuration.codes} />
                {configuration.hasAliases ? (
                  <span className="mt-1 block text-[0.6rem] leading-3 font-bold text-violet-800 sm:text-[0.65rem]">
                    Saldo compartilhado
                  </span>
                ) : null}
              </th>
              <td className="border-t border-border-neutral/70 px-2 py-2.5 sm:px-3">
                <p className="line-clamp-2 break-words text-xs leading-4 font-bold text-text-primary sm:text-sm sm:leading-5">
                  {configuration.description}
                </p>
                <p className="mt-1 break-words text-[0.65rem] leading-4 text-text-muted sm:text-xs">
                  Servo {configuration.servo.code} · Kit{" "}
                  {configuration.installationKit.code}
                </p>
                <span className="mt-1 inline-flex">
                  <ConfigurationStateBadge state={configuration.state} />
                </span>
              </td>
              <td className="border-t border-border-neutral/70 bg-violet-50/50 px-1 py-2.5 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={configuration.assembledQuantity} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-2.5 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={configuration.minimumStock} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-2.5 text-center sm:px-3">
                <InventoryRowActions
                  target={{
                    kind: "CONFIGURATION",
                    configurationId: configuration.id,
                    commercialCodes: configuration.codes,
                    commercialAliases: configuration.aliases,
                    description: configuration.description,
                    isActive: configuration.isActive,
                    assembledQuantity: configuration.assembledQuantity,
                    minimumStock: configuration.minimumStock,
                    servo: {
                      id: configuration.servo.id,
                      code: configuration.servo.code,
                      description: configuration.servo.description,
                      isActive: configuration.servo.isActive,
                      looseQuantity: configuration.servo.looseQuantity,
                    },
                    installationKit: {
                      id: configuration.installationKit.id,
                      code: configuration.installationKit.code,
                      description: configuration.installationKit.description,
                      isActive: configuration.installationKit.isActive,
                      looseQuantity:
                        configuration.installationKit.looseQuantity,
                    },
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

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="size-5"
    >
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function InventoryWorkspace({
  inventory,
  initialStatusFilter = "all",
}: InventoryWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<InventoryStatusFilter>(initialStatusFilter);
  const [sort, setSort] = useState<InventorySort>("code");
  const [areFiltersOpen, setAreFiltersOpen] = useState(
    initialStatusFilter !== "all",
  );
  const [openPhysicalGroups, setOpenPhysicalGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [openFamilies, setOpenFamilies] = useState<Set<string>>(
    () => new Set(),
  );
  const normalizedQuery = normalizeSearch(query.trim());
  const hasSearch = normalizedQuery.length > 0;
  const hasActiveFilters = statusFilter !== "all" || sort !== "code";

  const filteredPhysicalItems = useMemo(() => {
    const result = inventory.physicalItems.filter(
      (item) =>
        matchesSearch(normalizedQuery, [
          item.code,
          item.description,
          item.model,
          item.typeLabel,
        ]) &&
        matchesStatus(
          item.totalQuantity,
          item.minimumStock,
          item.state,
          statusFilter,
        ),
    );

    return result.sort((first, second) => {
      if (sort === "quantity") {
        return (
          second.totalQuantity - first.totalQuantity ||
          compareText(first.code, second.code)
        );
      }

      if (sort === "description") {
        return (
          compareText(
            first.model ?? first.description,
            second.model ?? second.description,
          ) || compareText(first.code, second.code)
        );
      }

      return compareText(first.code, second.code);
    });
  }, [inventory.physicalItems, normalizedQuery, sort, statusFilter]);

  const filteredConfigurations = useMemo(() => {
    const result = inventory.configurations.filter((configuration) => {
      const familyLabel = getServoFamilyLabel(
        configuration.servo.model,
        configuration.servo.description,
      );

      return (
        matchesSearch(normalizedQuery, [
          ...configuration.aliases.map((alias) => alias.code),
          configuration.description,
          configuration.servo.code,
          configuration.servo.description,
          configuration.servo.model,
          configuration.installationKit.code,
          configuration.installationKit.description,
          familyLabel,
        ]) &&
        matchesStatus(
          configuration.assembledQuantity,
          configuration.minimumStock,
          configuration.state,
          statusFilter,
        )
      );
    });

    return result.sort((first, second) => {
      if (sort === "quantity") {
        return (
          second.assembledQuantity - first.assembledQuantity ||
          compareText(
            first.codes[0] ?? first.description,
            second.codes[0] ?? second.description,
          )
        );
      }

      if (sort === "description") {
        return (
          compareText(first.description, second.description) ||
          compareText(
            first.codes[0] ?? first.id,
            second.codes[0] ?? second.id,
          )
        );
      }

      return compareText(
        first.codes[0] ?? first.description,
        second.codes[0] ?? second.description,
      );
    });
  }, [inventory.configurations, normalizedQuery, sort, statusFilter]);

  const groupedPhysicalItems = useMemo(
    () =>
      physicalGroups
        .map((group) => ({
          ...group,
          items: filteredPhysicalItems.filter(
            (item) => item.itemType === group.itemType,
          ),
        }))
        .filter(
          (group) =>
            group.items.length > 0 || (!hasSearch && !hasActiveFilters),
        ),
    [filteredPhysicalItems, hasActiveFilters, hasSearch],
  );

  const configurationFamilies = useMemo(() => {
    const configurationsByFamily = new Map<
      string,
      InventoryCommercialConfiguration[]
    >();

    filteredConfigurations.forEach((configuration) => {
      const familyLabel = getServoFamilyLabel(
        configuration.servo.model,
        configuration.servo.description,
      );
      const familyConfigurations =
        configurationsByFamily.get(familyLabel) ?? [];
      familyConfigurations.push(configuration);
      configurationsByFamily.set(familyLabel, familyConfigurations);
    });

    return Array.from(configurationsByFamily, ([label, configurations]) => ({
      label,
      configurations,
    })).sort((first, second) => compareText(first.label, second.label));
  }, [filteredConfigurations]);

  const summaryCards = [
    {
      label: "Caixas completas",
      value: inventory.summary.completeBoxesTotal,
    },
    {
      label: "Servos avulsos",
      value: inventory.summary.looseServoTotal,
    },
    {
      label: "Kits avulsos",
      value: inventory.summary.looseKitTotal,
    },
    {
      label: "Reparos",
      value: inventory.summary.repairKitTotal,
    },
    {
      label: "Peças avulsas",
      value: inventory.summary.loosePartTotal,
    },
  ];
  const totalResults =
    filteredPhysicalItems.length + filteredConfigurations.length;

  function toggleSetValue(
    setter: Dispatch<SetStateAction<Set<string>>>,
    value: string,
  ) {
    setter((current) => {
      const next = new Set(current);

      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }

      return next;
    });
  }

  return (
    <>
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[0.68rem] font-black tracking-[0.16em] text-brand-gold-ink uppercase">
            Consulta operacional
          </p>
          <h1 className="text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
            Estoque
          </h1>
        </div>
        <p className="text-right text-xs font-semibold text-text-muted sm:text-sm">
          {quantityFormatter.format(
            inventory.physicalCatalogCount +
              inventory.configurationCatalogCount,
          )}{" "}
          cadastros
        </p>
      </header>

      <section className="mt-3" aria-labelledby="inventory-summary-title">
        <h2 id="inventory-summary-title" className="sr-only">
          Indicadores do estoque
        </h2>
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 lg:grid-cols-5">
          {summaryCards.map((summary) => (
            <article
              key={summary.label}
              className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-border-neutral bg-surface px-3 py-2 shadow-sm"
            >
              <p className="text-[0.68rem] leading-4 font-bold text-text-muted sm:text-xs">
                {summary.label}
              </p>
              <p className="shrink-0 font-mono text-xl font-black tabular-nums text-text-primary sm:text-2xl">
                {quantityFormatter.format(summary.value)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-3" aria-labelledby="inventory-tools-title">
        <h2 id="inventory-tools-title" className="sr-only">
          Pesquisa e filtros
        </h2>
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Pesquisar estoque</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar código, modelo ou descrição"
              className="nk-field min-h-12 w-full rounded-xl border py-2 pr-10 pl-10 text-base outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpar pesquisa"
                className="nk-focus absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-lg font-bold text-text-muted hover:bg-app-background"
              >
                ×
              </button>
            ) : null}
          </label>
          <button
            type="button"
            aria-expanded={areFiltersOpen}
            aria-controls="inventory-filter-panel"
            onClick={() => setAreFiltersOpen((current) => !current)}
            className={`nk-focus inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black transition sm:px-4 ${
              hasActiveFilters
                ? "border-brand-gold-dark bg-brand-gold-soft text-brand-charcoal"
                : "border-border-neutral bg-surface text-text-primary hover:bg-app-background"
            }`}
          >
            <FilterIcon />
            <span className="hidden min-[430px]:inline">Filtros</span>
            {hasActiveFilters ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-brand-charcoal text-[0.65rem] text-white">
                {(statusFilter !== "all" ? 1 : 0) +
                  (sort !== "code" ? 1 : 0)}
              </span>
            ) : null}
          </button>
        </div>

        {areFiltersOpen ? (
          <div
            id="inventory-filter-panel"
            className="mt-2 grid gap-3 rounded-xl border border-border-neutral bg-surface p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          >
            <label>
              <span className="mb-1 block text-xs font-bold text-text-primary">
                Situação
              </span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as InventoryStatusFilter,
                  )
                }
                className="nk-field min-h-11 w-full rounded-lg border px-3 text-sm outline-none"
              >
                <option value="all">Todos</option>
                <option value="with-stock">Somente com estoque</option>
                <option value="attention">Precisa de atenção</option>
                <option value="zero">Estoque zerado</option>
                <option value="low">Estoque baixo</option>
                <option value="with-minimum">Com mínimo configurado</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-text-primary">
                Ordenar por
              </span>
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as InventorySort)
                }
                className="nk-field min-h-11 w-full rounded-lg border px-3 text-sm outline-none"
              >
                <option value="code">Código</option>
                <option value="description">Descrição ou modelo</option>
                <option value="quantity">Quantidade</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setSort("code");
              }}
              disabled={!hasActiveFilters}
              className="nk-focus min-h-11 rounded-lg border border-border-neutral px-4 text-sm font-bold text-text-primary transition hover:bg-app-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              Limpar filtros
            </button>
          </div>
        ) : null}
      </section>

      {totalResults === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border-neutral bg-surface px-5 py-8 text-center">
          <p className="font-black text-text-primary">
            Nenhum resultado encontrado.
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Ajuste a pesquisa ou limpe os filtros.
          </p>
        </div>
      ) : null}

      <section className="mt-5" aria-labelledby="physical-items-title">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-[0.65rem] font-black tracking-[0.14em] text-brand-gold-ink uppercase">
              Catálogo físico
            </p>
            <h2
              id="physical-items-title"
              className="text-lg font-black text-text-primary sm:text-xl"
            >
              Itens avulsos
            </h2>
          </div>
          <span className="text-xs font-bold text-text-muted">
            {quantityFormatter.format(filteredPhysicalItems.length)} registros
          </span>
        </div>
        <div className="space-y-2">
          {groupedPhysicalItems.map((group) => {
            const isOpen =
              (hasSearch && group.items.length > 0) ||
              openPhysicalGroups.has(group.itemType);

            return (
              <InventoryAccordion
                key={group.itemType}
                id={`inventory-physical-${group.itemType.toLocaleLowerCase()}`}
                title={group.title}
                description={group.description}
                count={group.items.length}
                isOpen={isOpen}
                onToggle={() =>
                  toggleSetValue(setOpenPhysicalGroups, group.itemType)
                }
              >
                {group.items.length > 0 ? (
                  <PhysicalTable items={group.items} />
                ) : (
                  <p className="px-4 py-5 text-sm text-text-muted">
                    Nenhum cadastro neste grupo.
                  </p>
                )}
              </InventoryAccordion>
            );
          })}
          {groupedPhysicalItems.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-neutral bg-surface px-4 py-5 text-sm text-text-muted">
              Nenhum item avulso corresponde aos filtros.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-6 pb-8" aria-labelledby="configurations-title">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-[0.65rem] font-black tracking-[0.14em] text-violet-800 uppercase">
              Saldo montado
            </p>
            <h2
              id="configurations-title"
              className="text-lg font-black text-text-primary sm:text-xl"
            >
              Caixas completas
            </h2>
          </div>
          <span className="text-right text-xs font-bold text-text-muted">
            {quantityFormatter.format(filteredConfigurations.length)}{" "}
            configurações
          </span>
        </div>
        <div className="space-y-2">
          {configurationFamilies.map((family, index) => {
            const isOpen =
              (hasSearch && family.configurations.length > 0) ||
              openFamilies.has(family.label);

            return (
              <InventoryAccordion
                key={family.label}
                id={`inventory-family-${index}`}
                title={family.label}
                description="Configurações físicas e códigos comerciais"
                count={family.configurations.length}
                isOpen={isOpen}
                onToggle={() => toggleSetValue(setOpenFamilies, family.label)}
              >
                <ConfigurationTable
                  configurations={family.configurations}
                />
              </InventoryAccordion>
            );
          })}
          {configurationFamilies.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-neutral bg-surface px-4 py-5 text-sm text-text-muted">
              Nenhuma caixa completa corresponde aos filtros.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}
