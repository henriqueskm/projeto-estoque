import type { PhysicalStockItemType } from "@/lib/stock-calculations";

export const inventoryPageSize = 24;

export type InventoryTab = "fisicos" | "configuracoes";
export type PhysicalTypeFilter =
  | "todos"
  | "servo"
  | "kit-instalacao"
  | "jogo-reparo"
  | "peca-avulsa";
export type StockState = "AVAILABLE" | "LOW" | "ZERO";
export type StockStateFilter =
  | "todos"
  | "disponivel"
  | "baixo"
  | "zerado";
export type MountedStateFilter = "todos" | "com-saldo" | "sem-saldo";

export type InventorySearchParams = {
  aba?: string | string[];
  q?: string | string[];
  tipo?: string | string[];
  situacao?: string | string[];
  montado?: string | string[];
  pagina?: string | string[];
};

export type InventoryFilters = {
  tab: InventoryTab;
  query: string;
  type: PhysicalTypeFilter;
  stockState: StockStateFilter;
  mountedState: MountedStateFilter;
  page: number;
};

export type InventorySummary = {
  activePhysicalItems: number;
  looseUnits: number;
  mountedConfigurations: number;
  lowStockItems: number;
  zeroStockItems: number;
};

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

export type InventoryCommercialConfiguration = {
  id: string;
  codes: string[];
  description: string;
  servo: {
    code: string;
    description: string;
    model: string | null;
  };
  installationKit: {
    code: string;
    description: string;
  };
  assembledQuantity: number;
  state: "AVAILABLE" | "EMPTY";
  hasAliases: boolean;
};

export type InventoryPagination = {
  currentPage: number;
  totalPages: number;
  totalResults: number;
  pageSize: number;
};

export type InventoryData = {
  summary: InventorySummary;
  physicalItems: InventoryPhysicalItem[];
  configurations: InventoryCommercialConfiguration[];
  physicalCatalogCount: number;
  configurationCatalogCount: number;
  pagination: InventoryPagination;
};

export type InventoryDataResult =
  | { data: InventoryData; error: null }
  | { data: null; error: string };
