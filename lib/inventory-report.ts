import { matchesCatalogSearch } from "@/lib/catalog-search";
import type { InventoryCommercialAlias, InventoryData } from "@/lib/inventory-types";

export const inventoryReportCategories = [
  "SERVO_WITH_KIT", "SERVO_LOOSE", "INSTALLATION_KIT", "REPAIR_KIT", "LOOSE_PART", "BUNDLE",
] as const;
export type InventoryReportCategory = (typeof inventoryReportCategories)[number];
export const inventoryReportLabels: Record<InventoryReportCategory, string> = {
  SERVO_WITH_KIT: "Servos com kit", SERVO_LOOSE: "Servo sem kit",
  INSTALLATION_KIT: "Kits avulsos", REPAIR_KIT: "Reparos",
  LOOSE_PART: "Peças avulsas", BUNDLE: "Conjuntos",
};
export type InventoryReportLine = {
  identity: string; category: InventoryReportCategory; code: string; quantity: number;
};
export type InventoryReport = { lines: InventoryReportLine[]; codeCount: number; unitCount: number };
export type InventoryReportSettings = {
  categoryOrder: InventoryReportCategory[];
  available: boolean;
  notice: string | null;
};

const codeCollator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const originalCollator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "variant" });
export function compareReportCodes(a: { code: string; identity: string }, b: { code: string; identity: string }) {
  return codeCollator.compare(a.code, b.code) || originalCollator.compare(a.code, b.code)
    || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
    || (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
}
export function isInventoryReportOrder(value: unknown): value is InventoryReportCategory[] {
  return Array.isArray(value) && value.length === inventoryReportCategories.length
    && new Set(value).size === inventoryReportCategories.length
    && value.every(category => inventoryReportCategories.includes(category));
}
export function moveReportCategory(order: readonly InventoryReportCategory[], index: number, direction: -1 | 1) {
  const next = [...order];
  const target = index + direction;
  if (index >= 0 && index < next.length && target >= 0 && target < next.length)
    [next[index], next[target]] = [next[target], next[index]];
  return next;
}
function canonicalCode(aliases: InventoryCommercialAlias[], codes: string[]) {
  const active = aliases.filter(alias => alias.isActive);
  // Retired metadata must not hide stock that still physically exists.
  const candidates = active.length ? active : aliases.length ? aliases : codes.map(code => ({ code, id: code }));
  return candidates.map(alias => ({ code: alias.code, identity: "id" in alias ? alias.id ?? alias.code : alias.code }))
    .sort(compareReportCodes)[0]?.code ?? "";
}
export function buildInventoryReport(inventory: InventoryData): InventoryReport {
  const targets = new Map<string, InventoryReportLine>();
  const add = (line: InventoryReportLine) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) throw new Error("Saldo inválido no relatório.");
    if (line.quantity === 0) return;
    if (!line.code.trim()) throw new Error("Um saldo positivo não possui código de catálogo.");
    const existing = targets.get(line.identity);
    if (existing && JSON.stringify(existing) !== JSON.stringify(line)) throw new Error("Identidade de estoque inconsistente.");
    targets.set(line.identity, line);
  };
  for (const item of inventory.physicalItems) add({
    identity: `ITEM:${item.id}`, code: item.code, quantity: item.looseQuantity,
    category: item.itemType === "SERVO" ? "SERVO_LOOSE" : item.itemType,
  });
  for (const configuration of inventory.configurations) add({
    identity: `CONFIGURATION:${configuration.id}`, category: "SERVO_WITH_KIT",
    code: canonicalCode(configuration.aliases, configuration.codes), quantity: configuration.assembledQuantity,
  });
  for (const bundle of inventory.bundles) add({
    identity: `BUNDLE:${bundle.id}`, category: "BUNDLE",
    code: canonicalCode(bundle.aliases, bundle.codes), quantity: bundle.readyQuantity,
  });
  const lines = [...targets.values()].sort(compareReportCodes);
  const unitCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (!Number.isSafeInteger(unitCount)) throw new Error("Total de estoque fora do limite seguro.");
  return { lines, codeCount: lines.length, unitCount };
}
export function orderedReportGroups(report: InventoryReport, order: readonly InventoryReportCategory[], search = "") {
  return order.map(category => ({ category, label: inventoryReportLabels[category],
    lines: report.lines.filter(line => line.category === category && matchesCatalogSearch(search, [line.code])).sort(compareReportCodes),
  }));
}
function csvCell(value: string) {
  // Quoting does not prevent spreadsheet formulas. Treat even official codes as untrusted cell text.
  const safe = /^[\s]*[=+@-]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function createInventoryReportCsv(report: InventoryReport, order: readonly InventoryReportCategory[]) {
  const rows = ["Categoria;Código;Quantidade", ...orderedReportGroups(report, order).flatMap(group =>
    group.lines.map(line => `${csvCell(group.label)};${csvCell(line.code)};${line.quantity}`))];
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
export function inventoryReportTimestamp(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}
export function inventoryReportFileDate(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
