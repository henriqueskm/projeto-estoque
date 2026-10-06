export const bulkPickupLimits = { orders: 100, lines: 500 } as const;
export const bulkPickupStaleMessage = "A situação dos Pedidos mudou. Atualize a prévia antes de confirmar.";
export const bulkPickupLimitMessage = "Há itens demais para uma retirada em massa segura. Use Pedidos ou faça a operação em grupos menores.";

export type BulkPickupOrderVersion = { supplierOrderId: string; expectedUpdatedAt: string; expectedLineFingerprint: string };
export type BulkPickupPreview = {
  orderCount: number;
  lineCount: number;
  totalQuantity: number;
  orders: (BulkPickupOrderVersion & {
    negotiationNumber: string;
    orderDate: string;
    lines: { supplierOrderItemId: string; code: string; descriptionSnapshot: string;
      readyQuantity: number; pickedQuantity: number; quantityToPickup: number }[];
  })[];
};
export type BulkPickupRequest = { orders: BulkPickupOrderVersion[]; idempotencyKey: string };
export type BulkPickupReceipt = {
  bulkPickupId: string; orderCount: number; changedLineCount: number;
  totalPickedQuantity: number; totalStockEntryQuantity: number; idempotentReplay: boolean;
  orders: { supplierOrderId: string; negotiationNumber: string; changedLineCount: number;
    addedPickedQuantity: number; stockEntryQuantity: number;
    supplierOrderStockEntryId: string; movementBatchId: string }[];
};
export type BulkPickupResult = { ok: true; receipt: BulkPickupReceipt } |
  { ok: false; error: string; stale?: boolean; transportUncertain?: boolean };
export type BulkPickupPreviewResult = { ok: true; preview: BulkPickupPreview } | { ok: false; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isBulkPickupUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const quantity = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(value) && Number.isFinite(Date.parse(value));
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);

export function parseBulkPickupPreview(value: unknown): BulkPickupPreview | null {
  if (!record(value) || !quantity(value.order_count) || !quantity(value.line_count) || !quantity(value.total_quantity)
    || value.order_count > bulkPickupLimits.orders || value.line_count > bulkPickupLimits.lines || !Array.isArray(value.orders)) return null;
  const orders: BulkPickupPreview["orders"] = [];
  const ids = new Set<string>();
  const lineIds = new Set<string>();
  for (const order of value.orders) {
    if (!record(order) || !isBulkPickupUuid(order.supplier_order_id) || ids.has(order.supplier_order_id)
      || !text(order.negotiation_number) || !text(order.order_date) || !timestamp(order.expected_updated_at) || !fingerprint(order.expected_line_fingerprint)
      || !Array.isArray(order.lines) || !order.lines.length) return null;
    ids.add(order.supplier_order_id);
    const lines: BulkPickupPreview["orders"][number]["lines"] = [];
    for (const line of order.lines) {
      if (!record(line) || !isBulkPickupUuid(line.supplier_order_item_id) || lineIds.has(line.supplier_order_item_id)
        || !text(line.code) || !text(line.description_snapshot) || !quantity(line.ready_quantity)
        || !quantity(line.picked_quantity) || !quantity(line.quantity_to_pickup) || line.quantity_to_pickup < 1
        || line.ready_quantity - line.picked_quantity !== line.quantity_to_pickup) return null;
      lineIds.add(line.supplier_order_item_id);
      lines.push({ supplierOrderItemId: line.supplier_order_item_id, code: line.code,
        descriptionSnapshot: line.description_snapshot, readyQuantity: line.ready_quantity,
        pickedQuantity: line.picked_quantity, quantityToPickup: line.quantity_to_pickup });
    }
    orders.push({ supplierOrderId: order.supplier_order_id, negotiationNumber: order.negotiation_number,
      orderDate: order.order_date, expectedUpdatedAt: order.expected_updated_at, expectedLineFingerprint: order.expected_line_fingerprint, lines });
  }
  if (orders.length !== value.order_count || lineIds.size !== value.line_count
    || orders.flatMap(o => o.lines).reduce((sum, line) => sum + line.quantityToPickup, 0) !== value.total_quantity) return null;
  return { orderCount: value.order_count, lineCount: value.line_count, totalQuantity: value.total_quantity, orders };
}

export function normalizeBulkPickupRequest(value: unknown): BulkPickupRequest | null {
  if (!record(value) || !isBulkPickupUuid(value.idempotencyKey) || !Array.isArray(value.orders)
    || value.orders.length < 1 || value.orders.length > bulkPickupLimits.orders
    || Object.keys(value).some(key => !["orders", "idempotencyKey"].includes(key))) return null;
  const orders: BulkPickupOrderVersion[] = [];
  for (const order of value.orders) {
    if (!record(order) || !isBulkPickupUuid(order.supplierOrderId) || !timestamp(order.expectedUpdatedAt) || !fingerprint(order.expectedLineFingerprint)
      || Object.keys(order).some(key => !["supplierOrderId", "expectedUpdatedAt", "expectedLineFingerprint"].includes(key))) return null;
    orders.push({ supplierOrderId: order.supplierOrderId.toLowerCase(), expectedUpdatedAt: order.expectedUpdatedAt, expectedLineFingerprint: order.expectedLineFingerprint });
  }
  if (new Set(orders.map(o => o.supplierOrderId)).size !== orders.length) return null;
  return { orders: orders.sort((a, b) => a.supplierOrderId.localeCompare(b.supplierOrderId)), idempotencyKey: value.idempotencyKey.toLowerCase() };
}

export function parseBulkPickupReceipt(value: unknown): BulkPickupReceipt | null {
  if (!record(value) || !isBulkPickupUuid(value.bulk_pickup_id) || !quantity(value.order_count) || value.order_count < 1
    || !quantity(value.changed_line_count) || !quantity(value.total_picked_quantity) || value.total_picked_quantity < 1
    || value.total_picked_quantity !== value.total_stock_entry_quantity || typeof value.idempotent_replay !== "boolean"
    || !Array.isArray(value.orders) || value.orders.length !== value.order_count) return null;
  const orders: BulkPickupReceipt["orders"] = [];
  for (const order of value.orders) {
    if (!record(order) || !isBulkPickupUuid(order.supplier_order_id) || !text(order.negotiation_number)
      || !quantity(order.changed_line_count) || order.changed_line_count < 1
      || !quantity(order.added_picked_quantity) || order.added_picked_quantity < 1
      || order.added_picked_quantity !== order.stock_entry_quantity || !isBulkPickupUuid(order.supplier_order_stock_entry_id)
      || !isBulkPickupUuid(order.movement_batch_id)) return null;
    orders.push({ supplierOrderId: order.supplier_order_id, negotiationNumber: order.negotiation_number,
      changedLineCount: order.changed_line_count, addedPickedQuantity: order.added_picked_quantity,
      stockEntryQuantity: order.stock_entry_quantity as number, supplierOrderStockEntryId: order.supplier_order_stock_entry_id,
      movementBatchId: order.movement_batch_id });
  }
  if (new Set(orders.map(o => o.supplierOrderId)).size !== orders.length
    || orders.reduce((sum, o) => sum + o.addedPickedQuantity, 0) !== value.total_picked_quantity
    || orders.reduce((sum, o) => sum + o.changedLineCount, 0) !== value.changed_line_count) return null;
  return { bulkPickupId: value.bulk_pickup_id, orderCount: value.order_count, changedLineCount: value.changed_line_count,
    totalPickedQuantity: value.total_picked_quantity, totalStockEntryQuantity: value.total_stock_entry_quantity as number,
    orders, idempotentReplay: value.idempotent_replay };
}

// Owns one immutable request across transport uncertainty and double clicks.
export function createBulkPickupAttempt(request: BulkPickupRequest) {
  let phase: "ready" | "pending" | "stale" | "uncertain" | "success" | "failed" = "ready";
  return {
    request,
    phase: () => phase,
    async submit(writer: (request: BulkPickupRequest) => Promise<BulkPickupResult>): Promise<BulkPickupResult | null> {
      if (phase !== "ready" && phase !== "uncertain") return null;
      phase = "pending";
      try {
        const result = await writer(request);
        phase = result.ok ? "success" : result.stale ? "stale" : result.transportUncertain ? "uncertain" : "failed";
        return result;
      } catch {
        phase = "uncertain";
        return { ok: false, transportUncertain: true,
          error: "Não foi possível confirmar o resultado. Tente novamente com a mesma operação; não gere outra retirada." };
      }
    },
  };
}
