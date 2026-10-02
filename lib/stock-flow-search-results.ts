import {
  compactCatalogSearch,
  matchesCatalogSearch,
  normalizeCatalogSearch,
} from "@/lib/catalog-search";
import type { InboundCommercialCode, InboundPhysicalItem, StockFlowBundleCode } from "@/lib/inbound-types";
import { physicalItemTypeLabels } from "@/lib/inbound-types";

export type StockFlowSearchOption = InboundPhysicalItem | InboundCommercialCode | StockFlowBundleCode;

export function stockFlowSearchKey(option: StockFlowSearchOption) {
  return option.kind === "ITEM" ? `ITEM:${option.id}`
    : option.kind === "COMMERCIAL_CODE" ? `COMMERCIAL_CODE:${option.commercialCodeId}`
      : `BUNDLE_CODE:${option.bundleCodeId}`;
}

export function stockFlowSearchCategory(option: StockFlowSearchOption) {
  if (option.kind === "COMMERCIAL_CODE") return "Servo com kit";
  if (option.kind === "BUNDLE_CODE") return "Conjunto";
  return { SERVO: "Servo sem kit", INSTALLATION_KIT: "Kit de instalação", REPAIR_KIT: "Reparo", LOOSE_PART: "Peça avulsa" }[option.itemType];
}

export function stockFlowSearchBalance(option: StockFlowSearchOption) {
  return option.kind === "ITEM" ? option.balance
    : option.kind === "COMMERCIAL_CODE" ? option.assembledBalance : option.readyBalance;
}

function searchValues(option: StockFlowSearchOption) {
  if (option.kind === "ITEM") return [option.code, option.description, option.model, stockFlowSearchCategory(option), physicalItemTypeLabels[option.itemType]];
  if (option.kind === "BUNDLE_CODE") return [option.code, option.description, ...option.aliases, "Conjunto"];
  return [option.code, option.description, ...option.aliases, option.servo.code,
    option.servo.description, option.servo.model, option.installationKit.code,
    option.installationKit.description, "Servo com kit"];
}

function searchRank(option: StockFlowSearchOption, query: string) {
  if (normalizeCatalogSearch(option.code) === query) return 0;
  const compact = compactCatalogSearch(query);
  if (!compact) return 3;
  const model = option.kind === "ITEM" ? option.model
    : option.kind === "COMMERCIAL_CODE" ? option.servo.model : null;
  const aliases = option.kind === "ITEM" ? [] : option.aliases;
  if ([option.code, model, ...aliases].some((value) => value && compactCatalogSearch(value) === compact)) return 1;
  if (compactCatalogSearch(option.code).startsWith(compact)) return 2;
  return 3;
}

export function buildStockFlowSearchResults<T extends StockFlowSearchOption>(options: T[], search: string) {
  const query = normalizeCatalogSearch(search);
  if (!query) return { results: [] as T[], total: 0 };
  const matches = options.filter((option) => matchesCatalogSearch(query, searchValues(option)))
    .map((option) => ({ option, rank: searchRank(option, query) }))
    .sort((first, second) => first.rank - second.rank ||
      first.option.code.localeCompare(second.option.code, "pt-BR", { numeric: true, sensitivity: "base" }) ||
      stockFlowSearchKey(first.option).localeCompare(stockFlowSearchKey(second.option)));
  // Bound broad discovery, but never hide exact code/alias/model matches.
  const limit = Math.max(30, matches.filter((match) => match.rank <= 1).length);
  return { results: matches.slice(0, limit).map((match) => match.option), total: matches.length };
}
