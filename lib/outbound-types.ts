import type { PhysicalItemType } from "@/lib/inbound-types";

export type OutboundPhysicalItem = {
  kind: "ITEM";
  id: string;
  code: string;
  description: string;
  itemType: PhysicalItemType;
  balance: number;
};

export type OutboundConfigurationComponent = {
  id: string;
  code: string;
  description: string;
  balance: number;
};

export type OutboundCommercialCode = {
  kind: "COMMERCIAL_CODE";
  commercialCodeId: string;
  code: string;
  configurationId: string;
  description: string;
  assembledBalance: number;
  servo: OutboundConfigurationComponent & {
    model: string | null;
  };
  installationKit: OutboundConfigurationComponent;
};

export type OutboundCatalog = {
  physicalItems: OutboundPhysicalItem[];
  commercialCodes: OutboundCommercialCode[];
};

export type OutboundCatalogOption =
  | OutboundPhysicalItem
  | OutboundCommercialCode;

export type OutboundRequestLine =
  | {
      kind: "ITEM";
      item_id: string;
      quantity: number;
    }
  | {
      kind: "COMMERCIAL_CODE";
      commercial_code_id: string;
      quantity: number;
    };
export type OutboundReceipt = {
  movementBatchId: string;
  linesProcessed: number;
  totalQuantity: number;
  autoAssembledQuantity: number;
};

export type OutboundActionResult =
  | {
      ok: true;
      receipt: OutboundReceipt;
    }
  | {
      ok: false;
      error: string;
    };
