"use client";

import Link from "next/link";

import { useWorkspaceScroll } from "@/components/workspace-state-provider";
import { useSemanticWorkspaceState } from "@/components/semantic-back-provider";
import { inventoryWorkspaceDefaults } from "@/lib/workspace-state";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { CompatibleKitImages } from "@/components/compatible-kit-images";
import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import { InventoryRowActions } from "@/components/inventory-row-actions";
import { PhysicalCatalogCreateButton } from "@/components/physical-catalog-dialog";
import { InventoryBundleTable } from "@/components/inventory-bundle-table";
import { PurchaseRecommendationLauncher } from "@/components/purchase-recommendation-launcher";
import { getServoFamilyLabel } from "@/lib/inventory-family";
import { inventoryShortcutPlan, type InventoryShortcut } from "@/lib/inventory-shortcuts";
import { dismissSearchKeyboard } from "@/lib/search-input";
import {
  matchesCatalogSearch as matchesSearch,
  normalizeCatalogSearch as normalizeSearch,
} from "@/lib/catalog-search";
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
  hasExplicitStatusFilter?: boolean;
  initialTarget?: InventoryDeepLinkTarget;
  isPurchaseRecommendationsInitiallyOpen?: boolean;
};

export type InventoryDeepLinkTarget =
  | { kind: "item"; id: string }
  | { kind: "commercial_configuration"; id: string };

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
    title: "Servo sem kit",
    description: "Servos disponíveis sem kit",
  },
  {
    itemType: "INSTALLATION_KIT",
    title: "Kits de instalação",
    description: "Kits separados e presentes em Servos com kit",
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
  "bg-brand-charcoal px-2 py-2 text-[0.62rem] font-bold uppercase tracking-wide text-slate-200 first:rounded-tl-lg last:rounded-tr-lg sm:px-3 sm:text-xs lg:sticky lg:top-0 lg:z-30";

function compareText(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
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
    <span className="break-all font-mono text-base font-extrabold tabular-nums text-text-primary sm:text-lg">
      {quantityFormatter.format(value)}
    </span>
  );
}

const compactBadgeClassName =
  "inline-flex rounded-full px-2 py-0.5 text-[0.65rem] leading-4 font-bold sm:text-xs";
const largeBadgeClassName =
  "inline-flex rounded-full px-3 py-1 text-sm leading-5 font-black";

function PhysicalStateBadge({
  item,
  large = false,
}: {
  item: InventoryPhysicalItem;
  large?: boolean;
}) {
  const details =
    item.looseQuantity === 0 && item.minimumStock === 0
      ? {
          label: "Sem saldo",
          className: "bg-slate-100 text-slate-700",
        }
      : physicalStateDetails[item.state];

  return (
    <span
      className={`${large ? largeBadgeClassName : compactBadgeClassName} ${details.className}`}
    >
      {details.label}
    </span>
  );
}

function ConfigurationStateBadge({
  state,
  large = false,
}: {
  state: ConfigurationStockState;
  large?: boolean;
}) {
  const details = configurationStateDetails[state];

  return (
    <span
      className={`${large ? largeBadgeClassName : compactBadgeClassName} ${details.className}`}
    >
      {details.label}
    </span>
  );
}

// On phones each row becomes a readable card: code with its description, a
// big labelled quantity and the situation in words. Desktop keeps the table.
function physicalQuantityLabel(item: InventoryPhysicalItem) {
  if (item.itemType === "SERVO") return "sem kit";
  if (item.itemType === "INSTALLATION_KIT") return "avulsos";
  return "em estoque";
}

function MobileCardQuantity({ value, label }: { value: number; label: string }) {
  return (
    <span className="shrink-0 text-right">
      <span className="block font-mono text-2xl leading-7 font-black tabular-nums text-text-primary">
        {quantityFormatter.format(value)}
      </span>
      <span className="block text-sm font-bold text-text-muted">{label}</span>
    </span>
  );
}

function mobileCardClassName(isHighlighted: boolean) {
  return `scroll-mt-24 border-t border-border-neutral/70 px-3 py-3 first:border-t-0 ${
    isHighlighted
      ? "bg-brand-gold-soft/60 outline-2 outline-offset-[-2px] outline-brand-gold-dark"
      : ""
  }`;
}

function PhysicalCards({
  items,
  highlightedItemId,
  onCatalogSuccess,
}: {
  items: InventoryPhysicalItem[];
  highlightedItemId?: string;
  onCatalogSuccess: (message: string) => void;
}) {
  return (
    <ul className="bg-surface sm:hidden" aria-label="Itens">
      {items.map((item) => (
        <li
          key={item.id}
          id={`inventory-card-item-${item.id}`}
          tabIndex={item.id === highlightedItemId ? -1 : undefined}
          className={mobileCardClassName(item.id === highlightedItemId)}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-lg font-black text-text-primary">
                  {item.code}
                </span>
                {item.itemType === "INSTALLATION_KIT" ? (
                  <CompatibleKitImages
                    kitCode={item.code}
                    options={item.compatibleKitImages}
                  />
                ) : null}
              </p>
              <p className="mt-0.5 break-words text-base leading-6 text-text-primary">
                {item.description}
              </p>
            </div>
            <MobileCardQuantity
              value={item.looseQuantity}
              label={physicalQuantityLabel(item)}
            />
          </div>
          {item.itemType === "SERVO" ||
          item.itemType === "INSTALLATION_KIT" ||
          item.itemType === "LOOSE_PART" ||
          item.embeddedQuantity ? (
            <p className="mt-1 text-base leading-6 text-text-muted">
              <PhysicalBalanceSummary item={item} />
            </p>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <PhysicalStateBadge item={item} large />
              <span className="text-base font-bold text-text-muted">
                mín. {quantityFormatter.format(item.minimumStock)}
              </span>
            </p>
            <InventoryRowActions
              onCatalogSuccess={onCatalogSuccess}
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
          </div>
        </li>
      ))}
    </ul>
  );
}

function ConfigurationCards({
  configurations,
  highlightedConfigurationId,
}: {
  configurations: InventoryCommercialConfiguration[];
  highlightedConfigurationId?: string;
}) {
  return (
    <ul className="bg-surface sm:hidden" aria-label="Servos com kit">
      {configurations.map((configuration) => (
        <li
          key={configuration.id}
          id={`inventory-card-configuration-${configuration.id}`}
          tabIndex={
            configuration.id === highlightedConfigurationId ? -1 : undefined
          }
          className={mobileCardClassName(
            configuration.id === highlightedConfigurationId,
          )}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap gap-x-2 gap-y-1" aria-label="Códigos comerciais">
                {configuration.codes.length > 0 ? (
                  configuration.codes.map((code) => (
                    <span
                      key={code}
                      className="break-all font-mono text-lg font-black text-text-primary"
                    >
                      {code}
                    </span>
                  ))
                ) : (
                  <span className="text-base font-bold text-text-muted">
                    Sem código comercial
                  </span>
                )}
              </p>
              <p className="mt-0.5 break-words text-base leading-6 text-text-primary">
                {configuration.description}
              </p>
              <p className="mt-0.5 break-words text-base leading-6 text-text-muted">
                Servo {configuration.servo.code} · Kit{" "}
                {configuration.installationKit.code}
              </p>
              {configuration.hasAliases ? (
                <p className="mt-0.5 text-sm font-bold text-violet-800">
                  Saldo compartilhado
                </p>
              ) : null}
            </div>
            <MobileCardQuantity
              value={configuration.assembledQuantity}
              label="com kit"
            />
          </div>
          {configuration.embeddedInBundlesQuantity ? (
            <p className="mt-1 text-base leading-6 text-text-muted">
              {configuration.assembledQuantity} livres ·{" "}
              {configuration.embeddedInBundlesQuantity} em conjuntos · total
              físico {configuration.totalPhysicalQuantity}
            </p>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <ConfigurationStateBadge state={configuration.state} large />
              <span className="text-base font-bold text-text-muted">
                mín. {quantityFormatter.format(configuration.minimumStock)}
              </span>
            </p>
            <InventoryRowActions
              target={configurationActionTarget(configuration)}
              hasImage={configuration.hasImage}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function configurationActionTarget(
  configuration: InventoryCommercialConfiguration,
) {
  return {
    kind: "CONFIGURATION" as const,
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
      looseQuantity: configuration.installationKit.looseQuantity,
    },
  };
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
          className="max-w-full break-all rounded-md bg-app-background px-1.5 py-0.5 font-mono text-sm font-black text-text-primary sm:text-base"
        >
          {code}
        </span>
      ))}
    </div>
  );
}

function PhysicalBalanceSummary({ item }: { item: InventoryPhysicalItem }) {
  if (item.embeddedQuantity || item.itemType === "LOOSE_PART") {
    return (
      <span>
        {quantityFormatter.format(item.looseQuantity)} livres ·{" "}
        {item.itemType === "SERVO" || item.itemType === "INSTALLATION_KIT" ? `${quantityFormatter.format(item.mountedQuantity)} em Servos com kit · ` : ""}
        {quantityFormatter.format(item.embeddedQuantity ?? 0)} em conjuntos · total
        físico {quantityFormatter.format(item.totalQuantity)}
      </span>
    );
  }
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
      <span title="Kits separados e kits presentes em Servos com kit montados">
        {quantityFormatter.format(item.looseQuantity)} separados ·{" "}
        {quantityFormatter.format(item.mountedQuantity)} em Servos com kit
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
      <h3 className="min-w-0">
        <button
          id={id}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="nk-focus flex min-h-14 w-full scroll-mt-24 items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-app-background sm:px-4"
        >
          <span className="min-w-0">
            <span className="block text-lg font-black text-text-primary sm:text-base">
              {title}
            </span>
            {description ? (
              <span className="mt-0.5 block text-sm font-semibold text-text-muted sm:truncate sm:text-xs">
                {description}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-brand-gold-soft px-2.5 py-1 text-sm font-black text-brand-charcoal sm:text-xs">
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

function PhysicalTable({
  items,
  highlightedItemId,
  onCatalogSuccess,
}: {
  items: InventoryPhysicalItem[];
  highlightedItemId?: string;
  onCatalogSuccess: (message: string) => void;
}) {
  return (
    <>
    <PhysicalCards
      items={items}
      highlightedItemId={highlightedItemId}
      onCatalogSuccess={onCatalogSuccess}
    />
    <div className="relative hidden bg-surface sm:block">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          Itens avulsos, quantidades, estoque mínimo e ações disponíveis
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[22%] sm:w-[14%]`}
            >
              Código
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} sm:w-[48%]`}
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
              className={`${stickyHeaderClassName} w-[14%] text-right sm:w-[12%]`}
            >
              Mín.
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-12 text-center sm:w-[10%]`}
            >
              <span className="sr-only sm:not-sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              id={`inventory-item-${item.id}`}
              tabIndex={item.id === highlightedItemId ? -1 : undefined}
              className={`align-middle transition hover:bg-app-background/70 ${
                item.id === highlightedItemId
                  ? "bg-brand-gold-soft/60 outline-2 outline-offset-[-2px] outline-brand-gold-dark"
                  : ""
              }`}
            >
              <th
                scope="row"
                className="border-t border-border-neutral/70 px-2 py-2.5 font-normal sm:px-3"
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="break-all font-mono text-sm font-black text-text-primary sm:text-base">
                    {item.code}
                  </span>
                  {item.itemType === "INSTALLATION_KIT" ? (
                    <CompatibleKitImages
                      kitCode={item.code}
                      options={item.compatibleKitImages}
                    />
                  ) : null}
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
                item.itemType === "INSTALLATION_KIT" || item.itemType === "LOOSE_PART" || item.embeddedQuantity ? (
                  <p className="mt-0.5 text-[0.65rem] leading-4 text-text-muted sm:text-xs">
                    <PhysicalBalanceSummary item={item} />
                  </p>
                ) : null}
                <span className="mt-1 inline-flex">
                  <PhysicalStateBadge item={item} />
                </span>
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-2.5 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={item.looseQuantity} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-2.5 text-right text-sm sm:px-3 sm:text-base">
                <Quantity value={item.minimumStock} />
              </td>
              <td className="border-t border-border-neutral/70 px-1 py-2.5 text-center sm:px-3">
                <InventoryRowActions
                  onCatalogSuccess={onCatalogSuccess}
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
    </>
  );
}

function ConfigurationTable({
  configurations,
  highlightedConfigurationId,
}: {
  configurations: InventoryCommercialConfiguration[];
  highlightedConfigurationId?: string;
}) {
  return (
    <>
    <ConfigurationCards
      configurations={configurations}
      highlightedConfigurationId={highlightedConfigurationId}
    />
    <div className="relative hidden bg-surface sm:block">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          Servos com kit, saldos montados, estoque mínimo e ações disponíveis
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
              className={`${stickyHeaderClassName} sm:w-[46%]`}
            >
              Configuração
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[14%] text-right sm:w-[12%]`}
            >
              <span className="sm:hidden">Qtd.</span>
              <span className="hidden sm:inline">Com kit</span>
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-[14%] text-right sm:w-[12%]`}
            >
              Mín.
            </th>
            <th
              scope="col"
              className={`${stickyHeaderClassName} w-12 text-center sm:w-[12%]`}
            >
              <span className="sr-only sm:not-sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {configurations.map((configuration) => (
            <tr
              key={configuration.id}
              id={`inventory-configuration-${configuration.id}`}
              tabIndex={
                configuration.id === highlightedConfigurationId
                  ? -1
                  : undefined
              }
              className={`align-middle transition hover:bg-violet-50/50 ${
                configuration.id === highlightedConfigurationId
                  ? "bg-brand-gold-soft/60 outline-2 outline-offset-[-2px] outline-brand-gold-dark"
                  : ""
              }`}
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
                {configuration.embeddedInBundlesQuantity ? <p className="mt-1 text-xs text-text-muted">{configuration.assembledQuantity} livres · {configuration.embeddedInBundlesQuantity} em conjuntos · total físico {configuration.totalPhysicalQuantity}</p> : null}
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
                  target={configurationActionTarget(configuration)}
                  hasImage={configuration.hasImage}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
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
  hasExplicitStatusFilter = false,
  initialTarget,
  isPurchaseRecommendationsInitiallyOpen = false,
}: InventoryWorkspaceProps) {
  // A row is unmounted after archive: success feedback belongs to the workspace.
  const [catalogFeedback, setCatalogFeedback] = useState<string | null>(null);
  // Activity tears down Effects too. Do not clear the receipt on a same-route
  // semantic pop used solely to consume the just-completed dialog checkpoint.
  useEffect(() => () => setCatalogFeedback(null), []);
  function handleCatalogSuccess(message: string) {
    setCatalogFeedback(message);
    document.getElementById("physical-items-title")?.focus({ preventScroll: true });
  }
  const targetedPhysicalItem =
    initialTarget?.kind === "item"
      ? inventory.physicalItems.find((item) => item.id === initialTarget.id)
      : undefined;
  const targetedConfiguration =
    initialTarget?.kind === "commercial_configuration"
      ? inventory.configurations.find(
          (configuration) => configuration.id === initialTarget.id,
        )
      : undefined;
  const targetedConfigurationFamily = targetedConfiguration
    ? getServoFamilyLabel(
        targetedConfiguration.servo.model,
        targetedConfiguration.servo.description,
      )
    : null;
  const workspace = useSemanticWorkspaceState("estoque", {
    ...inventoryWorkspaceDefaults, statusFilter: "all" as InventoryStatusFilter, sort: "code" as InventorySort,
  }, initialTarget ? {
    query: "", statusFilter: initialStatusFilter, areFiltersOpen: initialStatusFilter !== "all",
    openPhysicalGroups: targetedPhysicalItem ? [targetedPhysicalItem.itemType] : [],
    openFamilies: targetedConfigurationFamily ? [targetedConfigurationFamily] : [],
  } : hasExplicitStatusFilter ? { statusFilter: initialStatusFilter, areFiltersOpen: initialStatusFilter !== "all" } : undefined);
  const { query, statusFilter, sort, areFiltersOpen } = workspace.state;
  const setQuery = (value: string) => workspace.setState(current => ({ ...current, query: value }));
  const setStatusFilter = (value: InventoryStatusFilter) => workspace.setState(current => ({ ...current, statusFilter: value }));
  const setSort = (value: InventorySort) => workspace.setState(current => ({ ...current, sort: value }));
  const setAreFiltersOpen = (value: SetStateAction<boolean>) => workspace.setState(current => ({ ...current, areFiltersOpen: typeof value === "function" ? value(current.areFiltersOpen) : value }));
  const openPhysicalGroups = useMemo(() => new Set(workspace.state.openPhysicalGroups), [workspace.state.openPhysicalGroups]);
  const openFamilies = useMemo(() => new Set(workspace.state.openFamilies), [workspace.state.openFamilies]);
  const setOpenPhysicalGroups = (update: SetStateAction<Set<string>>) => workspace.setState(current => ({ ...current, openPhysicalGroups: Array.from(typeof update === "function" ? update(new Set(current.openPhysicalGroups)) : update) }));
  const setOpenFamilies = (update: SetStateAction<Set<string>>) => workspace.setState(current => ({ ...current, openFamilies: Array.from(typeof update === "function" ? update(new Set(current.openFamilies)) : update) }));
  const cancelScrollRestore = useWorkspaceScroll("estoque", inventoryWorkspaceDefaults, !initialTarget && !isPurchaseRecommendationsInitiallyOpen);
  const normalizedQuery = normalizeSearch(query.trim());
  const [scrollRequest, setScrollRequest] = useState<{ target: string } | null>(null);
  const hasSearch = normalizedQuery.length > 0;
  const hasActiveFilters = statusFilter !== "all" || sort !== "code";

  useEffect(() => {
    if (!scrollRequest) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(scrollRequest.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollRequest]);

  useEffect(() => {
    if (!initialTarget) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const kind =
        initialTarget.kind === "item" ? "item" : "configuration";
      // Phones show the card and desktop shows the table row: use the visible one.
      const row = [
        document.getElementById(`inventory-card-${kind}-${initialTarget.id}`),
        document.getElementById(`inventory-${kind}-${initialTarget.id}`),
      ].find((element) => element && element.getClientRects().length > 0);

      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialTarget]);

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
          item.looseQuantity,
          item.minimumStock,
          item.state,
          statusFilter,
        ),
    );

    return result.sort((first, second) => {
      if (sort === "quantity") {
        return (
          second.looseQuantity - first.looseQuantity ||
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

  const filteredBundles = useMemo(
    () =>
      inventory.bundles
        .filter(
          (bundle) =>
            matchesSearch(normalizedQuery, [
              ...bundle.aliases.map((alias) => alias.code),
              bundle.description,
              bundle.family,
              ...bundle.recipe.flatMap((component) => [
                component.code,
                component.description,
              ]),
            ]) &&
            matchesStatus(
              bundle.readyQuantity,
              bundle.minimumStock,
              bundle.state,
              statusFilter,
            ),
        )
        .sort((a, b) =>
          sort === "quantity"
            ? b.readyQuantity - a.readyQuantity ||
              compareText(
                a.codes[0] ?? a.description,
                b.codes[0] ?? b.description,
              )
            : compareText(
                sort === "description"
                  ? a.description
                  : (a.codes[0] ?? a.description),
                sort === "description"
                  ? b.description
                  : (b.codes[0] ?? b.description),
              ),
        ),
    [inventory.bundles, normalizedQuery, sort, statusFilter],
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

    for (const bundle of filteredBundles) {
      if (!configurationsByFamily.has(bundle.family)) configurationsByFamily.set(bundle.family, []);
    }
    return Array.from(configurationsByFamily, ([label, configurations]) => ({
      label,
      configurations,
      bundles: filteredBundles.filter(bundle => bundle.family === label),
    })).sort((first, second) => compareText(first.label, second.label));
  }, [filteredConfigurations, filteredBundles]);

  const summaryCards = [
    {
      label: "Servos com kit",
      shortcut: "CONFIGURATION" as const,
      value: inventory.summary.completeBoxesTotal,
    },
    {
      label: "Servos sem kit",
      shortcut: "SERVO" as const,
      value: inventory.summary.looseServoTotal,
    },
    {
      label: "Kits avulsos",
      shortcut: "INSTALLATION_KIT" as const,
      value: inventory.summary.looseKitTotal,
    },
    {
      label: "Reparos",
      shortcut: "REPAIR_KIT" as const,
      value: inventory.summary.repairKitTotal,
    },
    {
      label: "Peças avulsas",
      shortcut: "LOOSE_PART" as const,
      value: inventory.summary.loosePartTotal,
    },
  ];
  const statusShortcuts = useMemo(() => {
    const countFor = (filter: InventoryStatusFilter) =>
      inventory.physicalItems.filter((item) =>
        matchesStatus(item.looseQuantity, item.minimumStock, item.state, filter),
      ).length +
      inventory.configurations.filter((configuration) =>
        matchesStatus(
          configuration.assembledQuantity,
          configuration.minimumStock,
          configuration.state,
          filter,
        ),
      ).length +
      inventory.bundles.filter((bundle) =>
        matchesStatus(bundle.readyQuantity, bundle.minimumStock, bundle.state, filter),
      ).length;
    const shortcuts: Array<{
      filter: InventoryStatusFilter;
      label: string;
      count: number | null;
    }> = [
      { filter: "all", label: "Todos", count: null },
      { filter: "attention", label: "Precisa de atenção", count: countFor("attention") },
      { filter: "zero", label: "Zerados", count: countFor("zero") },
      { filter: "low", label: "Baixos", count: countFor("low") },
    ];

    return shortcuts;
  }, [inventory.bundles, inventory.configurations, inventory.physicalItems]);
  const totalResults =
    filteredPhysicalItems.length + filteredConfigurations.length + filteredBundles.length;

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

  function openSummaryShortcut(shortcut: InventoryShortcut) {
    const plan = inventoryShortcutPlan(shortcut);
    const physicalGroup = plan.physicalGroup;
    if (physicalGroup) {
      // One shortcut click is one semantic action, even when it clears filters.
      workspace.setState(current => ({ ...current, query: "", statusFilter: "all", openPhysicalGroups: Array.from(new Set([...current.openPhysicalGroups, physicalGroup])) }));
    }
    // Effect runs after the opened/cleared view commits, including repeat clicks.
    cancelScrollRestore();
    setScrollRequest({ target: plan.scrollTarget });
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hidden text-[0.68rem] font-black tracking-[0.16em] text-brand-gold-ink uppercase sm:block">
            Consulta operacional
          </p>
          <h1 className="text-3xl font-black tracking-tight text-text-primary">
            Estoque
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href="/relatorio-estoque" prefetch={false} className="nk-focus inline-flex min-h-12 items-center rounded-xl border border-border-neutral bg-surface px-4 text-base font-bold text-text-primary hover:bg-app-background sm:min-h-11 sm:px-3 sm:text-sm">Relatório</Link>
          <PurchaseRecommendationLauncher
            initiallyOpen={isPurchaseRecommendationsInitiallyOpen}
          />
          <p className="hidden text-right text-xs font-semibold text-text-muted sm:block sm:text-sm">
            {quantityFormatter.format(
              inventory.physicalCatalogCount +
                inventory.configurationCatalogCount + inventory.bundles.length,
            )}{" "}
            cadastros
          </p>
        </div>
      </header>

      <section className="mt-3" aria-labelledby="inventory-summary-title">
        <h2 id="inventory-summary-title" className="sr-only">
          Indicadores do estoque
        </h2>
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 lg:grid-cols-5">
          {summaryCards.map((summary) => (
            <button
              key={summary.label}
              type="button"
              aria-label={`Ver ${summary.label}`}
              onClick={() => openSummaryShortcut(summary.shortcut)}
              className="nk-focus flex min-h-14 cursor-pointer items-center justify-between gap-2 rounded-xl border border-border-neutral bg-surface px-3 py-2 text-left shadow-sm transition hover:bg-app-background"
            >
              <span className="text-base leading-5 font-bold text-text-muted sm:text-xs sm:leading-4">
                {summary.label}
              </span>
              <span className="shrink-0 font-mono text-xl font-black tabular-nums text-text-primary sm:text-2xl">
                {quantityFormatter.format(summary.value)}
              </span>
            </button>
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
              enterKeyHint="search"
              onKeyDown={dismissSearchKeyboard}
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
                className="nk-focus absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-2xl font-bold text-text-muted hover:bg-app-background sm:right-2 sm:size-8 sm:text-lg"
              >
                ×
              </button>
            ) : null}
          </label>
          <button
            type="button"
            aria-label="Filtros do estoque"
            aria-expanded={areFiltersOpen}
            aria-controls="inventory-filter-panel"
            onClick={() => setAreFiltersOpen((current) => !current)}
            className={`nk-focus hidden min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black transition sm:inline-flex sm:px-4 ${
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

        {/* Phones: the common situations are big shortcuts; the rest stays under "Mais filtros". */}
        <div className="sm:hidden">
          <nav aria-label="Situação do estoque" className="mt-3 flex flex-wrap gap-2">
            {statusShortcuts.map((shortcut) => {
              const isActive = shortcut.filter === statusFilter;

              return (
                <button
                  key={shortcut.filter}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setStatusFilter(shortcut.filter)}
                  className={`nk-focus inline-flex min-h-12 items-center gap-2 rounded-full border px-4 text-base font-bold transition ${
                    isActive
                      ? "border-brand-charcoal bg-brand-charcoal text-white"
                      : "border-border-neutral bg-surface text-text-primary hover:bg-app-background"
                  }`}
                >
                  {shortcut.label}
                  {shortcut.count !== null ? (
                    <span
                      className={`font-mono tabular-nums ${isActive ? "text-white" : "text-text-muted"}`}
                    >
                      {quantityFormatter.format(shortcut.count)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            aria-expanded={areFiltersOpen}
            aria-controls="inventory-filter-panel"
            onClick={() => setAreFiltersOpen((current) => !current)}
            className="nk-focus mt-3 flex min-h-12 w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-border-neutral bg-surface px-4 text-base font-bold text-text-primary"
          >
            <span>{areFiltersOpen ? "Menos filtros" : "Mais filtros"}</span>
            <span className="text-sm text-text-muted">
              {hasActiveFilters
                ? `${(statusFilter !== "all" ? 1 : 0) + (sort !== "code" ? 1 : 0)} ${
                    (statusFilter !== "all" ? 1 : 0) + (sort !== "code" ? 1 : 0) === 1
                      ? "filtro ativo"
                      : "filtros ativos"
                  }`
                : "Ordem, com estoque…"}
            </span>
          </button>
        </div>

        {areFiltersOpen ? (
          <div
            id="inventory-filter-panel"
            className="mt-2 grid gap-3 rounded-xl border border-border-neutral bg-surface p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end sm:p-3"
          >
            <label>
              <span className="mb-1.5 block text-base font-bold text-text-primary sm:mb-1 sm:text-xs">
                Situação
              </span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as InventoryStatusFilter,
                  )
                }
                className="nk-field min-h-12 w-full rounded-lg border px-3 text-base outline-none sm:min-h-11 sm:text-sm"
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
              <span className="mb-1.5 block text-base font-bold text-text-primary sm:mb-1 sm:text-xs">
                Ordenar por
              </span>
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as InventorySort)
                }
                className="nk-field min-h-12 w-full rounded-lg border px-3 text-base outline-none sm:min-h-11 sm:text-sm"
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
              className="nk-focus min-h-12 rounded-lg border border-border-neutral px-4 text-base font-bold text-text-primary transition hover:bg-app-background disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11 sm:text-sm"
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
          <p className="mt-1 text-base text-text-muted sm:text-sm">
            Ajuste a pesquisa ou limpe os filtros.
          </p>
        </div>
      ) : null}

      <section className="mt-5" aria-labelledby="physical-items-title">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="hidden text-[0.65rem] font-black tracking-[0.14em] text-brand-gold-ink uppercase sm:block">
              Catálogo físico
            </p>
            <h2
              id="physical-items-title"
              tabIndex={-1}
              className="text-lg font-black text-text-primary sm:text-xl"
            >
              Itens avulsos
            </h2>
          </div>
          <span className="text-sm font-bold text-text-muted sm:text-xs">
            {quantityFormatter.format(filteredPhysicalItems.length)} registros
          </span>
        </div>
        <div className="mb-3">
          <PhysicalCatalogCreateButton onCatalogSuccess={handleCatalogSuccess}
            servoOptions={inventory.physicalItems.filter(item => item.itemType === "SERVO").map(item => ({ id: item.id, code: item.code, description: item.description }))} />
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
                  <PhysicalTable
                    onCatalogSuccess={handleCatalogSuccess}
                    items={group.items}
                    highlightedItemId={
                      initialTarget?.kind === "item"
                        ? initialTarget.id
                        : undefined
                    }
                  />
                ) : (
                  <p className="px-4 py-5 text-base text-text-muted sm:text-sm">
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
            <p className="hidden text-[0.65rem] font-black tracking-[0.14em] text-violet-800 uppercase sm:block">
              Saldo montado
            </p>
            <h2
              id="configurations-title"
              className="scroll-mt-24 text-lg font-black text-text-primary sm:text-xl"
            >
              Servos com kit e conjuntos
            </h2>
          </div>
          <span className="text-right text-sm font-bold text-text-muted sm:text-xs">
            {quantityFormatter.format(filteredConfigurations.length)}{" "}
            configurações · {quantityFormatter.format(filteredBundles.length)} conjuntos
          </span>
        </div>
        <div className="space-y-2">
          {configurationFamilies.map((family, index) => {
            const isOpen =
              (hasSearch && family.configurations.length + family.bundles.length > 0) ||
              openFamilies.has(family.label);

            return (
              <InventoryAccordion
                key={family.label}
                id={`inventory-family-${index}`}
                title={family.label}
                description="Configurações físicas e conjuntos comerciais"
                count={family.configurations.length + family.bundles.length}
                isOpen={isOpen}
                onToggle={() => toggleSetValue(setOpenFamilies, family.label)}
              >
                {family.configurations.length > 0 ? <ConfigurationTable
                  configurations={family.configurations}
                  highlightedConfigurationId={
                    initialTarget?.kind === "commercial_configuration"
                      ? initialTarget.id
                      : undefined
                  }
                /> : null}
                {family.bundles.length > 0 ? <InventoryBundleTable bundles={family.bundles} /> : null}
              </InventoryAccordion>
            );
          })}
          {configurationFamilies.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-neutral bg-surface px-4 py-5 text-sm text-text-muted">
              Nenhum Servo com kit corresponde aos filtros.
            </p>
          ) : null}
        </div>
      </section>
      {catalogFeedback ? <div role="status" className="fixed right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 z-[70] mx-auto flex max-w-md items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-950">
        <span>{catalogFeedback}</span><button type="button" onClick={() => setCatalogFeedback(null)} aria-label="Fechar confirmação de catálogo" className="nk-focus min-h-11 shrink-0 rounded px-2 underline">Fechar</button>
      </div> : null}
    </>
  );
}
