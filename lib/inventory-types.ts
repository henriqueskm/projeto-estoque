import type {
  ConfigurationStockState,
  PhysicalStockItemType,
  PhysicalStockSummary,
} from "@/lib/stock-calculations";
import type { CompatibleKitImageOption } from "@/lib/compatible-kit-images";

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
  embeddedQuantity?: number;
  totalQuantity: number;
  state: StockState;
  compatibleKitImages: CompatibleKitImageOption[];
};

export type InventoryCommercialAlias = {
  id?: string;
  code: string;
  isActive: boolean;
};

export type InventoryCommercialConfiguration = {
  id: string;
  codes: string[];
  aliases: InventoryCommercialAlias[];
  description: string;
  hasImage: boolean;
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
  embeddedInBundlesQuantity?: number;
  totalPhysicalQuantity?: number;
  minimumStock: number;
  state: ConfigurationStockState;
  hasAliases: boolean;
};

export type InventoryBundleComponent = {
  kind: "ITEM" | "COMMERCIAL_CONFIGURATION";
  id: string;
  code: string;
  description: string;
  quantityPerBundle: number;
  availableQuantity: number;
  isActive: boolean;
  family: string | null;
};

export type InventoryCommercialBundle = {
  id: string;
  codes: string[];
  aliases: InventoryCommercialAlias[];
  description: string;
  isActive: boolean;
  readyQuantity: number;
  minimumStock: number;
  state: ConfigurationStockState;
  maximumAssemblable: number;
  recipe: InventoryBundleComponent[];
  family: string;
};

export type InventoryData = {
  summary: InventorySummary;
  physicalItems: InventoryPhysicalItem[];
  configurations: InventoryCommercialConfiguration[];
  bundles: InventoryCommercialBundle[];
  physicalCatalogCount: number;
  configurationCatalogCount: number;
};

export type InventoryDataResult =
  | { data: InventoryData; error: null }
  | { data: null; error: string };
