export type SupplierOrderGlobalActionVisibilityInput = {
  canMarkAll: boolean;
  readyWaitingPickupQuantity: number;
  waitingStockQuantity: number;
};

export type SupplierOrderGlobalActionVisibility = {
  showMarkAll: boolean;
  showStockEntry: boolean;
  showDock: boolean;
};

export function getSupplierOrderGlobalActionVisibility({
  canMarkAll,
  readyWaitingPickupQuantity,
  waitingStockQuantity,
}: SupplierOrderGlobalActionVisibilityInput): SupplierOrderGlobalActionVisibility {
  const showMarkAll = canMarkAll && readyWaitingPickupQuantity > 0;
  const showStockEntry = waitingStockQuantity > 0;

  return {
    showMarkAll,
    showStockEntry,
    showDock: showMarkAll || showStockEntry,
  };
}
