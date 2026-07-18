import type { PhysicalItemType } from "@/lib/inbound-types";

export const historyPageSize = 25;

export const movementTypes = [
  "INBOUND",
  "OUTBOUND",
  "ASSEMBLY",
  "DISASSEMBLY",
  "ADJUSTMENT",
  "REVERSAL",
] as const;

export const movementSources = [
  "MANUAL",
  "AI_CHAT",
  "ORDER_PHOTO",
] as const;

export type MovementType = (typeof movementTypes)[number];
export type MovementSource = (typeof movementSources)[number];
export type MovementTypeFilter = "ALL" | MovementType;
export type MovementSourceFilter = "ALL" | MovementSource;

export const movementTypeLabels: Record<MovementType, string> = {
  INBOUND: "Entrada",
  OUTBOUND: "Saída",
  ASSEMBLY: "Montagem",
  DISASSEMBLY: "Desmontagem",
  ADJUSTMENT: "Ajuste",
  REVERSAL: "Reversão",
};

export const movementSourceLabels: Record<MovementSource, string> = {
  MANUAL: "Manual",
  AI_CHAT: "Assistente IA",
  ORDER_PHOTO: "Pedido por foto",
};

export const historyItemTypeLabels: Record<PhysicalItemType, string> = {
  SERVO: "Servo",
  INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Jogo de reparo",
  LOOSE_PART: "Peça avulsa",
};

export type HistorySearchParams = {
  tipo?: string | string[];
  origem?: string | string[];
  dataInicial?: string | string[];
  dataFinal?: string | string[];
  usuario?: string | string[];
  busca?: string | string[];
  pagina?: string | string[];
};

export type HistoryFilters = {
  type: MovementTypeFilter;
  source: MovementSourceFilter;
  dateFrom: string;
  dateTo: string;
  dateFromIso: string | null;
  dateToExclusiveIso: string | null;
  user: string;
  query: string;
  page: number;
  dateRangeAdjusted: boolean;
};

export type HistoryBatchListItem = {
  id: string;
  movementType: MovementType;
  source: MovementSource;
  description: string | null;
  userName: string | null;
  reversedBatchId: string | null;
  occurredAt: string;
  summary: string;
};

export type HistoryPagination = {
  currentPage: number;
  totalPages: number;
  totalResults: number;
  pageSize: number;
};

export type HistoryListData = {
  batches: HistoryBatchListItem[];
  pagination: HistoryPagination;
};

export type HistoryListResult =
  | { data: HistoryListData; error: null }
  | { data: null; error: string };

export type HistoryItem = {
  id: string;
  code: string;
  description: string;
  itemType: PhysicalItemType;
  typeLabel: string;
  balanceLabel: string;
};

export type HistoryConfiguration = {
  id: string;
  description: string;
  codes: string[];
  servo: {
    id: string;
    code: string;
    description: string;
  };
  installationKit: {
    id: string;
    code: string;
    description: string;
  };
};

export type HistoryInboundLine =
  | {
      id: string;
      kind: "ITEM";
      quantity: number;
      item: HistoryItem;
    }
  | {
      id: string;
      kind: "COMMERCIAL_CODE";
      quantity: number;
      commercialCode: string;
      configuration: HistoryConfiguration;
    };

export type HistoryOutboundLine =
  | {
      id: string;
      kind: "ITEM";
      quantity: number;
      item: HistoryItem;
    }
  | {
      id: string;
      kind: "COMMERCIAL_CODE";
      quantity: number;
      assembledQuantityUsed: number;
      autoAssembledQuantity: number;
      commercialCode: string;
      configuration: HistoryConfiguration;
    };

export type HistoryStockMovement = {
  id: string;
  item: HistoryItem;
  quantityBefore: number;
  quantityChange: number;
  quantityAfter: number;
};

export type HistoryConfigurationMovement = {
  id: string;
  sequence: number;
  configuration: HistoryConfiguration;
  quantityBefore: number;
  quantityChange: number;
  quantityAfter: number;
};

export type HistoryAssemblyOperation = {
  id: string;
  operationType: "ASSEMBLY" | "DISASSEMBLY";
  quantity: number;
  configuration: HistoryConfiguration;
  isAutomaticOutboundAssembly: boolean;
};

export type HistoryBatchDetail = {
  id: string;
  movementType: MovementType;
  source: MovementSource;
  description: string | null;
  userName: string | null;
  reversedBatchId: string | null;
  occurredAt: string;
  inboundLines: HistoryInboundLine[];
  outboundLines: HistoryOutboundLine[];
  stockMovements: HistoryStockMovement[];
  configurationMovements: HistoryConfigurationMovement[];
  assemblyOperations: HistoryAssemblyOperation[];
};

export type HistoryDetailResult =
  | { status: "found"; data: HistoryBatchDetail; error: null }
  | { status: "not-found"; data: null; error: null }
  | { status: "error"; data: null; error: string };

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function getHistoryBalanceLabel(itemType: PhysicalItemType) {
  if (itemType === "SERVO") {
    return "Sem kit";
  }

  if (itemType === "INSTALLATION_KIT") {
    return "Separados";
  }

  return "Quantidade";
}
