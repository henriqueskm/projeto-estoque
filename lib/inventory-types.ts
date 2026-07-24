import type {
  ConfigurationStockState,
  PhysicalStockItemType,
  PhysicalStockSummary,
} from "@/lib/stock-calculations";

export type StockState = "AVAILABLE" | "LOW" | "ZERO";

export type InventorySummary = PhysicalStockSummary;

export type InventoryPhysicalItem = {
  id: string;
  code: string;
  description: string;
  itemType: PhysicalStockItemType;
  typeLabel: string;
  model: string | null;
  minimumStock: number;
  looseQuantity: number;
  mountedQuantity: number;
  totalQuantity: number;
  state: StockState;
};

export type InventoryCommercialAlias = {
  code: string;
  isActive: boolean;
};

export type InventoryCommercialConfiguration = {
  id: string;
  codes: string[];
  aliases: InventoryCommercialAlias[];
  description: string;
  imageUrl: string | null;
  isActive: boolean;
  servo: {
    id: string;
    code: string;
    description: string;
    model: string | null;
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
  assembledQuantity: number;
  minimumStock: number;
  state: ConfigurationStockState;
  hasAliases: boolean;
};

export type InventoryData = {
  summary: InventorySummary;
  physicalItems: InventoryPhysicalItem[];
  configurations: InventoryCommercialConfiguration[];
  physicalCatalogCount: number;
  configurationCatalogCount: number;
};

export type InventoryDataResult =
  | { data: InventoryData; error: null }
  | { data: null; error: string };
