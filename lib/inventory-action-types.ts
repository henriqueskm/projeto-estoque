import type { PhysicalStockItemType } from "@/lib/stock-calculations";
import type {
  InventoryBundleComponent,
  InventoryCommercialAlias,
} from "@/lib/inventory-types";

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
  commercialAliases: Array<{
    code: string;
    isActive: boolean;
  }>;
  description: string;
  isActive: boolean;
  assembledQuantity: number;
  minimumStock: number;
  servo: {
    id: string;
    code: string;
    description: string;
    isActive: boolean;
    looseQuantity: number;
  };
  installationKit: {
    id: string;
    code: string;
    description: string;
    isActive: boolean;
    looseQuantity: number;
  };
};

export type InventoryBundleActionTarget = {
  kind: "BUNDLE";
  bundleId: string;
  commercialCodes: string[];
  commercialAliases: InventoryCommercialAlias[];
  description: string;
  isActive: boolean;
  readyQuantity: number;
  minimumStock: number;
  maximumAssemblable: number;
  recipe: InventoryBundleComponent[];
};

export type BundleOperationActionResult =
  | {
      ok: true;
      receipt: {
        movementBatchId: string;
        bundleId: string;
        bundleCode: string;
        quantity: number;
        quantityBefore: number;
        quantityAfter: number;
      };
    }
  | { ok: false; error: string };

export type InventoryActionTarget =
  | InventoryItemActionTarget
  | InventoryConfigurationActionTarget
  | InventoryBundleActionTarget;

export type StockAdjustmentReceipt = {
  movementBatchId: string | null;
  adjustmentApplied: boolean;
  quantityBefore: number;
  quantityChange: number;
  quantityAfter: number;
};

export type StockAdjustmentActionResult =
  | { ok: true; receipt: StockAdjustmentReceipt }
  | { ok: false; error: string; stale?: true };

export type MinimumStockReceipt = {
  changeApplied: boolean;
  changeId: string | null;
  previousMinimumStock: number;
  newMinimumStock: number;
};

export type MinimumStockActionResult =
  | { ok: true; receipt: MinimumStockReceipt }
  | { ok: false; error: string };

export type ConfigurationOperationType = "ASSEMBLY" | "DISASSEMBLY";

export type ConfigurationOperationReceipt = {
  movementBatchId: string;
  operationType: ConfigurationOperationType;
  configurationId: string;
  commercialCode: string | null;
  quantity: number;
  servoId: string;
  installationKitId: string;
  servoQuantityBefore: number;
  servoQuantityAfter: number;
  kitQuantityBefore: number;
  kitQuantityAfter: number;
  configurationQuantityBefore: number;
  configurationQuantityAfter: number;
  operationApplied: true;
};

export type ConfigurationOperationActionResult =
  | { ok: true; receipt: ConfigurationOperationReceipt }
  | { ok: false; error: string };
