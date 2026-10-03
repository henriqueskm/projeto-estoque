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
  hasImage: boolean;
  assembledBalance: number;
  aliases: string[];
  servo: InboundConfigurationComponent & {
    model: string | null;
  };
  installationKit: InboundConfigurationComponent;
};

export type InboundNewLoosePart = {
  kind: "NEW_LOOSE_PART";
  code: string;
  description: string;
  itemType: "LOOSE_PART";
  model: null;
  // A restored, unacknowledged create may already exist after a lost response.
  balance: number;
};

export type InboundCatalog = {
  physicalItems: InboundPhysicalItem[];
  commercialCodes: InboundCommercialCode[];
  bundleCodes: StockFlowBundleCode[];
};

export type StockFlowBundleCode = {
  kind: "BUNDLE_CODE";
  bundleCodeId: string;
  bundleId: string;
  code: string;
  description: string;
  readyBalance: number;
  aliases: string[];
};

export type InboundCatalogOption =
  | InboundPhysicalItem
  | InboundCommercialCode
  | StockFlowBundleCode
  | InboundNewLoosePart;

export type InboundRequestLine =
  | {
      kind: "BUNDLE_CODE";
      bundle_code_id: string;
      quantity: number;
    }
  | {
      kind: "ITEM";
      item_id: string;
      quantity: number;
    }
  | {
      kind: "COMMERCIAL_CODE";
      commercial_code_id: string;
      quantity: number;
    }
  | {
      kind: "NEW_LOOSE_PART";
      code: string;
      description: string;
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
