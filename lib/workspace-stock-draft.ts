import { assessNewLoosePartCode, getCatalogCodeWriteIdentity } from "@/lib/catalog-code-policy";
import type { InboundCatalog, InboundCatalogOption } from "@/lib/inbound-types";
import type { OutboundCatalog, OutboundCatalogOption } from "@/lib/outbound-types";
import type { StockDraftLine } from "@/lib/workspace-state";

export type StockFlowLine<Option> = { option: Option; quantity: string };
export function serializeStockFlowLines(lines: StockFlowLine<InboundCatalogOption>[]): StockDraftLine[] {
  return lines.map(({ option, quantity }) => {
    if (option.kind === "ITEM") return { kind: "ITEM", itemId: option.id, quantity };
    if (option.kind === "COMMERCIAL_CODE") return { kind: "COMMERCIAL_CODE", commercialCodeId: option.commercialCodeId, quantity };
    if (option.kind === "BUNDLE_CODE") return { kind: "BUNDLE_CODE", bundleCodeId: option.bundleCodeId, quantity };
    return { kind: "NEW_LOOSE_PART", code: option.code, description: option.description, quantity };
  });
}
export function reconcileStockFlowLines(lines: StockDraftLine[], catalog: InboundCatalog, mode: "entrada"): { lines: StockFlowLine<InboundCatalogOption>[]; changed: boolean };
export function reconcileStockFlowLines(lines: StockDraftLine[], catalog: OutboundCatalog, mode: "saida"): { lines: StockFlowLine<OutboundCatalogOption>[]; changed: boolean };
export function reconcileStockFlowLines(lines: StockDraftLine[], catalog: InboundCatalog | OutboundCatalog, mode: "entrada" | "saida"): { lines: StockFlowLine<InboundCatalogOption>[]; changed: boolean };
export function reconcileStockFlowLines(lines: StockDraftLine[], catalog: InboundCatalog | OutboundCatalog, mode: "entrada" | "saida") {
  let changed = false;
  const options = [...catalog.physicalItems, ...catalog.commercialCodes, ...catalog.bundleCodes];
  const seen = new Set<string>();
  const restored: StockFlowLine<InboundCatalogOption>[] = [];
  for (const line of lines) {
    let option: InboundCatalogOption | undefined;
    if (line.kind === "ITEM") option = catalog.physicalItems.find(x => x.id === line.itemId);
    if (line.kind === "COMMERCIAL_CODE") option = catalog.commercialCodes.find(x => x.commercialCodeId === line.commercialCodeId);
    if (line.kind === "BUNDLE_CODE") option = catalog.bundleCodes.find(x => x.bundleCodeId === line.bundleCodeId);
    if (line.kind === "NEW_LOOSE_PART" && mode === "entrada") {
      const assessment = assessNewLoosePartCode(options, line.code);
      const found = !assessment.allowed && assessment.resolution.kind === "FOUND" ? assessment.resolution.target : null;
      const identity = getCatalogCodeWriteIdentity(line.code);
      // Keep the ORIGINAL request identity/key on retry after an interrupted create.
      // Only an exact, unique loose part with the same submitted description qualifies.
      const acknowledgedCatalogItem = found?.kind === "ITEM" && found.itemType === "LOOSE_PART"
        && identity.kind === "VALID" && found.code === identity.canonicalCode
        && found.description === line.description.trim() ? found : null;
      if (assessment.allowed || acknowledgedCatalogItem) {
        option = { kind: "NEW_LOOSE_PART", code: line.code, description: line.description, itemType: "LOOSE_PART", model: null, balance: acknowledgedCatalogItem?.balance ?? 0 };
      }
    }
    const identity = option ? JSON.stringify(serializeStockFlowLines([{ option, quantity: "" }])[0]) : "";
    if (!option || seen.has(identity)) { changed = true; continue; }
    seen.add(identity);
    restored.push({ option, quantity: line.quantity });
  }
  return { lines: restored, changed };
}
