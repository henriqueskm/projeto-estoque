import type { SupplierOrderLineInput, UpdateSupplierOrderInput } from "@/lib/supplier-orders-types";

// Read-back of the canonical rows, not a second writer or stock calculation.
// Includes positions and identities: matching only count/total hides substitutions.
export function supplierOrderEditMatches(input: UpdateSupplierOrderInput, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const order = value as Record<string, unknown>;
  if (order.id !== input.supplier_order_id || order.negotiation_number !== input.negotiation_number
    || order.order_date !== input.order_date || order.notes !== input.notes
    || !Array.isArray(order.supplier_order_items)
    || order.supplier_order_items.length !== input.lines.length) return false;
  const lines = order.supplier_order_items as unknown[];
  return input.lines.every((line: SupplierOrderLineInput, position) => {
    const found = lines.find(candidate => candidate && typeof candidate === "object"
      && (candidate as Record<string, unknown>).position === position);
    if (!found || typeof found !== "object") return false;
    const saved = found as Record<string, unknown>;
    return (!line.id || saved.id === line.id) && saved.ordered_quantity === line.quantity
      && saved.notes === line.notes && (line.kind === "ITEM"
        ? saved.item_id === line.item_id && saved.commercial_configuration_id === null && saved.commercial_configuration_code_id === null
        : saved.item_id === null && saved.commercial_configuration_id === line.commercial_configuration_id
          && saved.commercial_configuration_code_id === line.commercial_configuration_code_id);
  });
}
