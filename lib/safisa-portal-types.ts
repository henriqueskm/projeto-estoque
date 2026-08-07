export type SafisaReadinessStatus =
  | "NOT_READY"
  | "PARTIALLY_READY"
  | "COMPLETELY_READY";

export type SafisaClosureKind = "FINALIZED" | "CANCELLED" | null;

export type SafisaOrderSummary = {
  supplierOrderId: string;
  negotiationNumber: string;
  orderDate: string;
  lineCount: number;
  orderedQuantity: number;
  readyQuantity: number;
  pickedQuantity: number;
  waitingReadyQuantity: number;
  readyWaitingPickupQuantity: number;
  readinessStatus: SafisaReadinessStatus;
  closureKind: SafisaClosureKind;
  isReadOnly: boolean;
  updatedAt: string;
};

export type SafisaOrderLine = {
  supplierOrderItemId: string;
  code: string;
  description: string;
  model: string | null;
  itemType: string;
  commercialCode: string | null;
  orderedQuantity: number;
  readyQuantity: number;
  pickedQuantity: number;
  waitingReadyQuantity: number;
  readyWaitingPickupQuantity: number;
  readinessStatus: SafisaReadinessStatus;
  position: number;
  updatedAt: string;
};

export type SafisaOrderEvent = {
  eventType: string;
  actorName: string;
  supplierOrderItemId: string | null;
  previousQuantity: number | null;
  quantityDelta: number | null;
  newQuantity: number | null;
  justification: string | null;
  createdAt: string;
};

export type SafisaOrderDetail = Omit<SafisaOrderSummary, "lineCount"> & {
  lines: SafisaOrderLine[];
  events: SafisaOrderEvent[];
};

export type SafisaOrderList = {
  orders: SafisaOrderSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type SafisaActionResult = {
  status: "success" | "error" | "conflict";
  message: string;
};
