import type { SupplierOrderPickupProposalPayload } from "@/lib/ai/assistant-action-token-core";

export const supplierOrderPickupAuditDescription =
  "Retirada confirmada pela Assistente NK.";

export type SupplierOrderPickupCheckedRpcName =
  | "set_supplier_order_item_picked_quantity_checked"
  | "mark_supplier_order_all_picked_checked";

export type SupplierOrderPickupCheckedRpcCall = {
  name: SupplierOrderPickupCheckedRpcName;
  arguments: Record<string, string | number>;
};

export type SupplierOrderPickupRpcError = {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
};

export type SupplierOrderPickupRpcFailureKind =
  | "version_conflict"
  | "permission_denied"
  | "rpc_not_found"
  | "not_ready"
  | "reduction_not_allowed"
  | "invalid_quantity"
  | "incompatible_order"
  | "temporary"
  | "unknown";

export type SupplierOrderPickupRpcResponse = {
  data: unknown;
  error: SupplierOrderPickupRpcError | null;
  status?: number;
  statusText?: string;
};

type SupplierOrderPickupRpcClient = {
  rpc: (
    name: SupplierOrderPickupCheckedRpcName,
    arguments_: Record<string, string | number>,
  ) => PromiseLike<SupplierOrderPickupRpcResponse>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SupplierOrderPickupLineRpcResult = {
  previousPickedQuantity: number;
  newPickedQuantity: number;
  pickedQuantityDelta: number;
  idempotentReplay: boolean;
  stockEntry: SupplierOrderPickupStockEntryReceipt | null;
};

type SupplierOrderPickupMarkAllRpcResult = {
  changedLineCount: number;
  addedPickedQuantity: number;
  idempotentReplay: boolean;
  stockEntry: SupplierOrderPickupStockEntryReceipt | null;
};

export type SupplierOrderPickupStockEntryReceipt = {
  supplierOrderStockEntryId: string;
  movementBatchId: string;
  lineCount: number;
  quantity: number;
  createdAt: string;
};

export type SupplierOrderPickupParsedRpcResult =
  | {
      mode: "line";
      value: SupplierOrderPickupLineRpcResult;
    }
  | {
      mode: "mark_all";
      value: SupplierOrderPickupMarkAllRpcResult;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseStockEntryReceipt(
  data: Record<string, unknown>,
): SupplierOrderPickupStockEntryReceipt | null | "invalid" {
  const fields = [
    data.supplier_order_stock_entry_id,
    data.movement_batch_id,
    data.stock_entry_line_count,
    data.stock_entry_quantity,
    data.stock_entry_created_at,
  ];

  if (fields.every((field) => field === undefined || field === null)) {
    return null;
  }

  const lineCount = safeInteger(data.stock_entry_line_count);
  const quantity = safeInteger(data.stock_entry_quantity);
  const createdAt = data.stock_entry_created_at;
  if (
    typeof data.supplier_order_stock_entry_id !== "string" ||
    !uuidPattern.test(data.supplier_order_stock_entry_id) ||
    typeof data.movement_batch_id !== "string" ||
    !uuidPattern.test(data.movement_batch_id) ||
    lineCount === null ||
    lineCount < 1 ||
    quantity === null ||
    quantity < 1 ||
    typeof createdAt !== "string" ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    return "invalid";
  }

  return {
    supplierOrderStockEntryId:
      data.supplier_order_stock_entry_id.toLowerCase(),
    movementBatchId: data.movement_batch_id.toLowerCase(),
    lineCount,
    quantity,
    createdAt,
  };
}

function normalizedErrorText(error: SupplierOrderPickupRpcError) {
  return `${error.code ?? ""} ${error.message} ${error.details ?? ""} ${
    error.hint ?? ""
  }`.toLocaleLowerCase("en-US");
}

function hasAnyText(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}

export function isSupplierOrderPickupActorAuthorized(
  userId: string | null,
  profileName: string | null,
) {
  return Boolean(
    userId &&
      uuidPattern.test(userId) &&
      profileName &&
      profileName.trim(),
  );
}

export function createSupplierOrderPickupCheckedRpcCall(
  payload: SupplierOrderPickupProposalPayload,
): SupplierOrderPickupCheckedRpcCall | null {
  if (payload.mode === "mark_all") {
    return {
      name: "mark_supplier_order_all_picked_checked",
      arguments: {
        p_supplier_order_id: payload.supplierOrderId,
        p_description: supplierOrderPickupAuditDescription,
        p_expected_order_updated_at:
          payload.expectedOrderUpdatedAt,
        p_idempotency_key: payload.idempotencyKey,
      },
    };
  }

  if (
    !payload.supplierOrderItemId ||
    payload.targetPickedQuantity === null
  ) {
    return null;
  }

  return {
    name: "set_supplier_order_item_picked_quantity_checked",
    arguments: {
      p_supplier_order_item_id: payload.supplierOrderItemId,
      p_target_picked_quantity: payload.targetPickedQuantity,
      p_description: supplierOrderPickupAuditDescription,
      p_expected_order_updated_at: payload.expectedOrderUpdatedAt,
      p_idempotency_key: payload.idempotencyKey,
    },
  };
}

export async function executeSupplierOrderPickupCheckedRpc(
  client: SupplierOrderPickupRpcClient,
  payload: SupplierOrderPickupProposalPayload,
) {
  const call = createSupplierOrderPickupCheckedRpcCall(payload);

  if (!call) {
    return {
      data: null,
      error: {
        code: "22023",
        message: "invalid_supplier_order_pickup_proposal",
      },
    };
  }

  return client.rpc(call.name, call.arguments);
}

export function isSupplierOrderVersionConflict(error: {
  code?: string;
  message: string;
}) {
  return (
    error.code === "40001" ||
    error.message
      .toLocaleLowerCase("en-US")
      .includes("supplier_order_version_conflict")
  );
}

export function classifySupplierOrderPickupRpcFailure(
  response: SupplierOrderPickupRpcResponse,
): SupplierOrderPickupRpcFailureKind {
  const error = response.error;

  if (!error) {
    return "unknown";
  }

  const text = normalizedErrorText(error);
  const status = response.status;

  if (isSupplierOrderVersionConflict(error)) {
    return "version_conflict";
  }

  if (
    error.code === "42501" ||
    error.code === "PGRST301" ||
    status === 401 ||
    status === 403 ||
    hasAnyText(text, ["permission denied", "not authorized", "unauthorized"])
  ) {
    return "permission_denied";
  }

  if (
    ["42883", "PGRST202", "PGRST204"].includes(error.code ?? "") ||
    status === 404 ||
    hasAnyText(text, [
      "could not find the function",
      "schema cache",
      "function does not exist",
    ])
  ) {
    return "rpc_not_found";
  }

  if (
    hasAnyText(text, [
      "picked_quantity cannot exceed ready_quantity",
      "cannot exceed ready_quantity",
    ])
  ) {
    return "not_ready";
  }

  if (
    hasAnyText(text, [
      "picked_quantity cannot be reduced",
      "cannot be reduced by the pickup operation",
    ])
  ) {
    return "reduction_not_allowed";
  }

  if (
    ["22003", "22023", "23514"].includes(error.code ?? "") &&
    hasAnyText(text, [
      "quantity",
      "picked",
      "target",
      "nonnegative",
      "integer",
    ])
  ) {
    return "invalid_quantity";
  }

  if (
    ["22023", "23514", "P0001"].includes(error.code ?? "") ||
    hasAnyText(text, [
      "supplier order",
      "supplier-order",
      "order is",
      "order was",
      "line does not exist",
      "cancelled",
      "finalized",
    ])
  ) {
    return "incompatible_order";
  }

  if (
    (status !== undefined &&
      [0, 408, 429, 500, 502, 503, 504, 520].includes(status)) ||
    ["57014", "53300", "57P01", "PGRST000", "PGRST001"].includes(
      error.code ?? "",
    ) ||
    hasAnyText(text, [
      "fetch failed",
      "network",
      "timeout",
      "temporarily unavailable",
      "connection",
    ])
  ) {
    return "temporary";
  }

  return "unknown";
}

export function parseSupplierOrderPickupRpcResult(
  data: unknown,
  mode: SupplierOrderPickupProposalPayload["mode"],
): SupplierOrderPickupParsedRpcResult | null {
  if (!isRecord(data) || typeof data.idempotent_replay !== "boolean") {
    return null;
  }

  const stockEntry = parseStockEntryReceipt(data);

  if (stockEntry === "invalid") {
    return null;
  }

  if (mode === "mark_all") {
    const changedLineCount = safeInteger(data.changed_line_count);
    const addedPickedQuantity = safeInteger(data.added_picked_quantity);

    if (changedLineCount === null || addedPickedQuantity === null) {
      return null;
    }

    if (
      (addedPickedQuantity > 0 &&
        stockEntry !== null &&
        stockEntry.quantity !== addedPickedQuantity) ||
      (addedPickedQuantity === 0 && stockEntry !== null)
    ) {
      return null;
    }

    return {
      mode: "mark_all",
      value: {
        changedLineCount,
        addedPickedQuantity,
        idempotentReplay: data.idempotent_replay,
        stockEntry,
      },
    };
  }

  const previousPickedQuantity = safeInteger(
    data.previous_picked_quantity,
  );
  const newPickedQuantity = safeInteger(data.new_picked_quantity);
  const pickedQuantityDelta = safeInteger(data.picked_quantity_delta);

  if (
    previousPickedQuantity === null ||
    newPickedQuantity === null ||
    pickedQuantityDelta === null ||
    newPickedQuantity < previousPickedQuantity ||
    pickedQuantityDelta !== newPickedQuantity - previousPickedQuantity
  ) {
    return null;
  }


  if (
    (pickedQuantityDelta > 0 &&
      stockEntry !== null &&
      stockEntry.quantity !== pickedQuantityDelta) ||
    (pickedQuantityDelta === 0 && stockEntry !== null)
  ) {
    return null;
  }

  return {
    mode: "line",
    value: {
      previousPickedQuantity,
      newPickedQuantity,
      pickedQuantityDelta,
      idempotentReplay: data.idempotent_replay,
      stockEntry,
    },
  };
}
