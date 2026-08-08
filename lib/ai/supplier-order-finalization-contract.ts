import type { SupplierOrderSummary } from "@/lib/supplier-orders-types";

export function supplierOrderFinalizationProfileHasName(name: unknown) {
  return typeof name === "string" && Boolean(name.trim());
}

export function supplierOrderCanBeFinalized(order: SupplierOrderSummary) {
  return order.cancelledAt === null && !order.isFinalized && order.closureKind === null &&
    order.status === "COMPLETED" && order.waitingPickupQuantity === 0;
}
