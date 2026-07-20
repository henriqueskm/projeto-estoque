import type { PhysicalStockItemType } from "@/lib/stock-calculations";

export type InventoryItemActionTarget = {
  kind: "ITEM";
  itemId: string;
  code: string;
  description: string;
  itemType: PhysicalStockItemType;
  looseQuantity: number;
  mountedQuantity: number;
  minimumStock: number;
};

export type InventoryConfigurationActionTarget = {
  kind: "CONFIGURATION";
  configurationId: string;
  commercialCodes: string[];
  description: string;
  assembledQuantity: number;
};

export type InventoryActionTarget =
  | InventoryItemActionTarget
  | InventoryConfigurationActionTarget;

export type StockAdjustmentReceipt = {
  movementBatchId: string | null;
  adjustmentApplied: boolean;
  quantityBefore: number;
  quantityChange: number;
  quantityAfter: number;
};

export type StockAdjustmentActionResult =
  | { ok: true; receipt: StockAdjustmentReceipt }
  | { ok: false; error: string };

export type MinimumStockReceipt = {
  changeApplied: boolean;
  changeId: string | null;
  previousMinimumStock: number;
  newMinimumStock: number;
};

export type MinimumStockActionResult =
  | { ok: true; receipt: MinimumStockReceipt }
  | { ok: false; error: string };
