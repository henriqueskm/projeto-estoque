import type { SupplierOrderLineInput } from "@/lib/supplier-orders-types";

type FormLine = {
  existingId: string | null;
  kind: "ITEM" | "COMMERCIAL_CONFIGURATION";
  itemId: string | null;
  configurationId: string | null;
  commercialCodeId: string | null;
  quantity: number;
  notes: string;
  readyQuantity: number;
  pickedQuantity: number;
  cancelledQuantity: number;
};

// The editor omits an ID only for a NEW line. The database assigns that ID.
export function buildSupplierOrderFormLines(lines: readonly FormLine[]): SupplierOrderLineInput[] | null {
  const payload: SupplierOrderLineInput[] = [];
  for (const line of lines) {
    const minimum = Math.max(1, line.pickedQuantity + line.cancelledQuantity, line.readyQuantity + line.cancelledQuantity);
    if (!Number.isInteger(line.quantity) || line.quantity < minimum || line.quantity > 2_147_483_647 || line.notes.trim().length > 1000) return null;
    const common = { ...(line.existingId ? { id: line.existingId } : {}), quantity: line.quantity, notes: line.notes.trim() || null };
    if (line.kind === "ITEM" && line.itemId) payload.push({ ...common, kind: "ITEM", item_id: line.itemId });
    else if (line.kind === "COMMERCIAL_CONFIGURATION" && line.configurationId) payload.push({ ...common, kind: "COMMERCIAL_CONFIGURATION",
      commercial_configuration_id: line.configurationId, commercial_configuration_code_id: line.commercialCodeId });
    else return null;
  }
  return payload.length > 0 ? payload : null;
}
