import type { PhysicalItemType } from "@/lib/inbound-types";
import type { CompatibleKitImageOption } from "@/lib/compatible-kit-images";

export const supplierOrderStatuses = [
  "PENDING",
  "PARTIAL",
  "COMPLETED",
  "CANCELLED",
] as const;

export type SupplierOrderStatus = (typeof supplierOrderStatuses)[number];

export const supplierOrderClosureKinds = [
  "FINALIZED",
  "CANCELLED",
] as const;

export type SupplierOrderClosureKind =
  (typeof supplierOrderClosureKinds)[number];

export type SupplierOrderView = "active" | "history";

export const supplierOrderEventTypes = [
  "ORDER_CREATED",
  "ORDER_HEADER_UPDATED",
  "ORDER_ITEMS_UPDATED",
  "PICKED_QUANTITY_CHANGED",
  "ALL_ITEMS_MARKED_PICKED",
  "ORDER_CANCELLED",
  "REMAINING_QUANTITY_CANCELLED",
  "STOCK_ENTRY_CREATED",
  "ORDER_FINALIZED",
] as const;

export type SupplierOrderEventType =
  (typeof supplierOrderEventTypes)[number];

export type SupplierOrderSummary = {
  id: string;
  negotiationNumber: string;
  orderDate: string;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancellationNote: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  finalizationNote: string | null;
  isFinalized: boolean;
  isActiveOrder: boolean;
  isInHistory: boolean;
  closureKind: SupplierOrderClosureKind | null;
  closedAt: string | null;
  closedByName: string | null;
  lineCount: number;
  orderedQuantity: number;
  readyQuantity: number;
  pickedQuantity: number;
  cancelledQuantity: number;
  waitingPickupQuantity: number;
  waitingReadyQuantity: number;
  readyWaitingPickupQuantity: number;
  stockedQuantity: number;
  waitingStockQuantity: number;
  pickupPercentage: number;
  status: SupplierOrderStatus;
};

export type SupplierOrderItem = {
  id: string;
  supplierOrderId: string;
  itemId: string | null;
  commercialConfigurationId: string | null;
  commercialConfigurationCodeId: string | null;
  codeSnapshot: string;
  descriptionSnapshot: string;
  modelSnapshot: string | null;
  itemTypeSnapshot:
    | PhysicalItemType
    | "COMMERCIAL_CONFIGURATION";
  commercialCodeSnapshot: string | null;
  imageUrl: string | null;
  compatibleKitImages: CompatibleKitImageOption[];
  orderedQuantity: number;
  readyQuantity: number;
  pickedQuantity: number;
  stockedQuantity: number;
  cancelledQuantity: number;
  waitingPickupQuantity: number;
  waitingReadyQuantity: number;
  readyWaitingPickupQuantity: number;
  waitingStockQuantity: number;
  position: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierOrderEvent = {
  id: string;
  supplierOrderId: string;
  supplierOrderItemId: string | null;
  eventType: SupplierOrderEventType;
  userName: string;
  previousQuantity: number | null;
  newQuantity: number | null;
  quantityDelta: number | null;
  description: string | null;
  createdAt: string;
};

export type SupplierOrderCatalogPhysicalItem = {
  kind: "ITEM";
  itemId: string;
  code: string;
  description: string;
  model: string | null;
  itemType: PhysicalItemType;
  imageUrl: string | null;
  compatibleKitImages: CompatibleKitImageOption[];
};

export type SupplierOrderCatalogAlias = {
  id: string;
  code: string;
};

export type SupplierOrderCatalogConfiguration = {
  kind: "COMMERCIAL_CONFIGURATION";
  configurationId: string;
  description: string;
  servoCode: string;
  servoDescription: string;
  servoModel: string | null;
  installationKitCode: string;
  installationKitDescription: string;
  imageUrl: string | null;
  aliases: SupplierOrderCatalogAlias[];
};

export type SupplierOrdersData = {
  view: SupplierOrderView;
  summaries: SupplierOrderSummary[];
  items: SupplierOrderItem[];
  events: SupplierOrderEvent[];
  catalog: {
    physicalItems: SupplierOrderCatalogPhysicalItem[];
    configurations: SupplierOrderCatalogConfiguration[];
  };
};

export type SupplierOrderLineInput =
  | {
      id?: string;
      kind: "ITEM";
      item_id: string;
      quantity: number;
      notes: string | null;
    }
  | {
      id?: string;
      kind: "COMMERCIAL_CONFIGURATION";
      commercial_configuration_id: string;
      commercial_configuration_code_id: string | null;
      quantity: number;
      notes: string | null;
    };

export type CreateSupplierOrderInput = {
  negotiation_number: string;
  order_date: string;
  notes: string | null;
  lines: SupplierOrderLineInput[];
  idempotency_key: string;
};

export type UpdateSupplierOrderInput = CreateSupplierOrderInput & {
  supplier_order_id: string;
  expected_updated_at: string;
};

export type SetSupplierOrderPickedQuantityInput = {
  supplier_order_item_id: string;
  picked_quantity: number;
  description: string | null;
  idempotency_key: string;
};

export type SupplierOrderCommandInput = {
  supplier_order_id: string;
  description: string | null;
  idempotency_key: string;
};

export type SupplierOrderCancellationInput = {
  supplier_order_id: string;
  cancellation_note: string;
  idempotency_key: string;
};

export type FinalizeSupplierOrderInput = {
  supplier_order_id: string;
  expected_updated_at: string;
  finalization_note: string | null;
  idempotency_key: string;
};

export type SupplierOrderStockEntryLineInput = {
  supplierOrderItemId: string;
  quantity: number;
};

export type SupplierOrderStockEntryActionInput = {
  supplierOrderId: string;
  lines: SupplierOrderStockEntryLineInput[];
  note?: string | null;
  expectedUpdatedAt: string;
  idempotencyKey: string;
};

export type SupplierOrderReceipt = {
  supplierOrderId: string;
  negotiationNumber: string;
  lineCount: number;
  orderedQuantity: number;
  pickedQuantity: number;
  cancelledQuantity: number;
  waitingPickupQuantity: number;
  stockedQuantity: number;
  waitingStockQuantity: number;
  pickupPercentage: number;
  status: SupplierOrderStatus;
  updatedAt: string;
};

export type SupplierOrderStockEntryReceipt = SupplierOrderReceipt & {
  supplierOrderStockEntryId: string;
  movementBatchId: string;
  stockEntryLineCount: number;
  stockEntryQuantity: number;
  stockEntryCreatedAt: string;
};

export type SupplierOrderActionResult =
  | {
      ok: true;
      receipt: SupplierOrderReceipt;
    }
  | {
      ok: false;
      error: string;
      stale?: boolean;
    };

export type SupplierOrderStockEntryActionResult =
  | {
      ok: true;
      receipt: SupplierOrderStockEntryReceipt;
    }
  | {
      ok: false;
      error: string;
      stale?: boolean;
      transportUncertain?: boolean;
    };
