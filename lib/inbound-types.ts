export const physicalItemTypes = [
  "SERVO",
  "INSTALLATION_KIT",
  "REPAIR_KIT",
  "LOOSE_PART",
] as const;

export type PhysicalItemType = (typeof physicalItemTypes)[number];

export const physicalItemTypeLabels: Record<PhysicalItemType, string> = {
  SERVO: "Servo",
  INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Kit de reparo",
  LOOSE_PART: "Peça avulsa",
};

export type InboundPhysicalItem = {
  kind: "ITEM";
  id: string;
  code: string;
  description: string;
  itemType: PhysicalItemType;
  model: string | null;
  balance: number;
};

export type InboundConfigurationComponent = {
  code: string;
  description: string;
};

export type InboundCommercialCode = {
  kind: "COMMERCIAL_CODE";
  commercialCodeId: string;
  configurationId: string;
  code: string;
  description: string;
  assembledBalance: number;
  aliases: string[];
  servo: InboundConfigurationComponent & {
    model: string | null;
  };
  installationKit: InboundConfigurationComponent;
};

export type InboundCatalog = {
  physicalItems: InboundPhysicalItem[];
  commercialCodes: InboundCommercialCode[];
};

export type InboundCatalogOption =
  | InboundPhysicalItem
  | InboundCommercialCode;

export type InboundRequestLine =
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

export type InboundReceipt = {
  movementBatchId: string;
  linesProcessed: number;
  totalQuantity: number;
  commercialQuantity: number;
};

export type InboundActionResult =
  | {
      ok: true;
      receipt: InboundReceipt;
    }
  | {
      ok: false;
      error: string;
    };
