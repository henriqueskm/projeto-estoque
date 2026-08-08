import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type {
  SafisaClosureKind,
  SafisaOrderDetail,
  SafisaOrderEvent,
  SafisaOrderLine,
  SafisaOrderList,
  SafisaOrderSummary,
  SafisaPortalOrderState,
  SafisaReadinessStatus,
} from "@/lib/safisa-portal-types";

type JsonRecord = Record<string, unknown>;

export class SafisaPortalAccessError extends Error {}
export class SafisaPortalDataError extends Error {}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SafisaPortalDataError(`Resposta inválida no campo ${field}.`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SafisaPortalDataError(`Resposta inválida no campo ${field}.`);
  }
  return value;
}

function readinessStatus(value: unknown): SafisaReadinessStatus {
  if (
    value === "NOT_READY" ||
    value === "PARTIALLY_READY" ||
    value === "COMPLETELY_READY"
  ) {
    return value;
  }
  throw new SafisaPortalDataError("Status de prontidão inválido.");
}

function closureKind(value: unknown): SafisaClosureKind {
  if (value === null || value === "FINALIZED" || value === "CANCELLED") {
    return value;
  }
  throw new SafisaPortalDataError("Situação de encerramento inválida.");
}

function portalState(value: unknown): SafisaPortalOrderState {
  if (value === "ACTIVE" || value === "COMPLETED") return value;
  throw new SafisaPortalDataError("SituaÃ§Ã£o do portal invÃ¡lida.");
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new SafisaPortalDataError(`Resposta inválida no campo ${field}.`);
  }
  return value;
}

function parseSummary(value: unknown): SafisaOrderSummary {
  if (!isRecord(value)) throw new SafisaPortalDataError("Pedido inválido.");
  return {
    supplierOrderId: requiredString(value.supplier_order_id, "supplier_order_id"),
    negotiationNumber: requiredString(value.negotiation_number, "negotiation_number"),
    orderDate: requiredString(value.order_date, "order_date"),
    lineCount: integer(value.line_count, "line_count"),
    orderedQuantity: integer(value.ordered_quantity, "ordered_quantity"),
    readyQuantity: integer(value.ready_quantity, "ready_quantity"),
    pickedQuantity: integer(value.picked_quantity, "picked_quantity"),
    waitingReadyQuantity: integer(value.waiting_ready_quantity, "waiting_ready_quantity"),
    readyWaitingPickupQuantity: integer(
      value.ready_waiting_pickup_quantity,
      "ready_waiting_pickup_quantity",
    ),
    readinessStatus: readinessStatus(value.readiness_status),
    closureKind: closureKind(value.closure_kind),
    portalState: portalState(value.portal_state),
    isReadOnly: boolean(value.is_read_only, "is_read_only"),
    updatedAt: requiredString(value.updated_at, "updated_at"),
  };
}

function parseLine(value: unknown): SafisaOrderLine {
  if (!isRecord(value)) throw new SafisaPortalDataError("Linha inválida.");
  return {
    supplierOrderItemId: requiredString(
      value.supplier_order_item_id,
      "supplier_order_item_id",
    ),
    code: requiredString(value.code, "code"),
    description: requiredString(value.description, "description"),
    model: nullableString(value.model, "model"),
    itemType: requiredString(value.item_type, "item_type"),
    commercialCode: nullableString(value.commercial_code, "commercial_code"),
    orderedQuantity: integer(value.ordered_quantity, "ordered_quantity"),
    readyQuantity: integer(value.ready_quantity, "ready_quantity"),
    pickedQuantity: integer(value.picked_quantity, "picked_quantity"),
    waitingReadyQuantity: integer(value.waiting_ready_quantity, "waiting_ready_quantity"),
    readyWaitingPickupQuantity: integer(
      value.ready_waiting_pickup_quantity,
      "ready_waiting_pickup_quantity",
    ),
    readinessStatus: readinessStatus(value.readiness_status),
    position: integer(value.position, "position"),
    updatedAt: requiredString(value.updated_at, "updated_at"),
  };
}

function parseEvent(value: unknown): SafisaOrderEvent {
  if (!isRecord(value)) throw new SafisaPortalDataError("Evento inválido.");
  return {
    eventType: requiredString(value.event_type, "event_type"),
    actorName: requiredString(value.actor_name, "actor_name"),
    supplierOrderItemId: nullableString(
      value.supplier_order_item_id,
      "supplier_order_item_id",
    ),
    previousQuantity:
      value.previous_quantity === null
        ? null
        : integer(value.previous_quantity, "previous_quantity"),
    quantityDelta:
      value.quantity_delta === null
        ? null
        : integer(value.quantity_delta, "quantity_delta"),
    newQuantity:
      value.new_quantity === null
        ? null
        : integer(value.new_quantity, "new_quantity"),
    justification: nullableString(value.justification, "justification"),
    createdAt: requiredString(value.created_at, "created_at"),
  };
}

function throwRpcError(error: PostgrestError): never {
  if (error.code === "42501" || error.code === "28000") {
    throw new SafisaPortalAccessError("Acesso Safisa não autorizado.");
  }
  throw new SafisaPortalDataError("Não foi possível carregar os dados do portal.");
}

export async function listSafisaOrders(
  supabase: SupabaseClient,
  state: SafisaPortalOrderState = "ACTIVE",
): Promise<SafisaOrderList> {
  const { data, error } = await supabase.rpc("list_safisa_orders", {
    p_state: state,
    p_limit: 100,
    p_offset: 0,
  });
  if (error) throwRpcError(error);
  if (!isRecord(data) || !Array.isArray(data.orders)) {
    throw new SafisaPortalDataError("Lista de pedidos inválida.");
  }
  return {
    orders: data.orders.map(parseSummary),
    total: integer(data.total, "total"),
    limit: integer(data.limit, "limit"),
    offset: integer(data.offset, "offset"),
  };
}

export async function getSafisaOrder(
  supabase: SupabaseClient,
  supplierOrderId: string,
): Promise<SafisaOrderDetail> {
  const { data, error } = await supabase.rpc("get_safisa_order", {
    p_supplier_order_id: supplierOrderId,
  });
  if (error) throwRpcError(error);
  if (!isRecord(data) || !Array.isArray(data.lines) || !Array.isArray(data.events)) {
    throw new SafisaPortalDataError("Detalhe do pedido inválido.");
  }
  return {
    supplierOrderId: requiredString(data.supplier_order_id, "supplier_order_id"),
    negotiationNumber: requiredString(data.negotiation_number, "negotiation_number"),
    orderDate: requiredString(data.order_date, "order_date"),
    orderedQuantity: integer(data.ordered_quantity, "ordered_quantity"),
    readyQuantity: integer(data.ready_quantity, "ready_quantity"),
    pickedQuantity: integer(data.picked_quantity, "picked_quantity"),
    waitingReadyQuantity: integer(data.waiting_ready_quantity, "waiting_ready_quantity"),
    readyWaitingPickupQuantity: integer(
      data.ready_waiting_pickup_quantity,
      "ready_waiting_pickup_quantity",
    ),
    readinessStatus: readinessStatus(data.readiness_status),
    closureKind: closureKind(data.closure_kind),
    portalState: portalState(data.portal_state),
    isReadOnly: boolean(data.is_read_only, "is_read_only"),
    updatedAt: requiredString(data.updated_at, "updated_at"),
    lines: data.lines.map(parseLine),
    events: data.events.map(parseEvent),
  };
}
