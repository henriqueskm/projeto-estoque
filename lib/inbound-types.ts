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

export type InboundCatalogItem = {
  id: string;
  code: string;
  description: string;
  itemType: PhysicalItemType;
  balance: number;
};

export type InboundReceipt = {
  movementBatchId: string;
  itemsProcessed: number;
  totalQuantity: number;
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
