"use server";

import { revalidatePath } from "next/cache";
import { dispatchSafisaFullyReadyPush } from "@/lib/safisa-push-dispatch";
import { createClient } from "@/lib/supabase/server";
import {
  supplierOrderStatuses,
  type CreateSupplierOrderInput,
  type FinalizeSupplierOrderInput,
  type SetSupplierOrderPickedQuantityInput,
  type SupplierOrderActionResult,
  type SupplierOrderCancellationInput,
  type SupplierOrderCommandInput,
  type SupplierOrderLineInput,
  type SupplierOrderReceipt,
  type SupplierOrderStockEntryActionInput,
  type SupplierOrderStockEntryActionResult,
  type SupplierOrderStockEntryReceipt,
  type SupplierOrderStatus,
  type UpdateSupplierOrderInput,
} from "@/lib/supplier-orders-types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maximumInteger = 2_147_483_647;
const maximumLines = 1_000;
const maximumNegotiationNumberLength = 120;
const maximumOrderNotesLength = 2_000;
const maximumLineNotesLength = 1_000;
const maximumOperationDescriptionLength = 500;

type AuthenticatedContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
};

type RpcReceipt = {
  supplier_order_id?: unknown;
  negotiation_number?: unknown;
  line_count?: unknown;
  ordered_quantity?: unknown;
  picked_quantity?: unknown;
  cancelled_quantity?: unknown;
  waiting_pickup_quantity?: unknown;
  stocked_quantity?: unknown;
  waiting_stock_quantity?: unknown;
  pickup_percentage?: unknown;
  status?: unknown;
  updated_at?: unknown;
  supplier_order_stock_entry_id?: unknown;
  movement_batch_id?: unknown;
  stock_entry_line_count?: unknown;
  stock_entry_quantity?: unknown;
  stock_entry_created_at?: unknown;
  picked_quantity_delta?: unknown;
  added_picked_quantity?: unknown;
  idempotent_replay?: unknown;
};

type RpcStockEntryReceipt = RpcReceipt & {
  supplier_order_stock_entry_id?: unknown;
  movement_batch_id?: unknown;
  stock_entry_line_count?: unknown;
  stock_entry_quantity?: unknown;
  stock_entry_created_at?: unknown;
};

function actionError(
  error: string,
  stale = false,
): SupplierOrderActionResult {
  return stale ? { ok: false, error, stale: true } : { ok: false, error };
}

function stockEntryActionError(
  error: string,
  options?: {
    stale?: boolean;
    transportUncertain?: boolean;
  },
): SupplierOrderStockEntryActionResult {
  return {
    ok: false,
    error,
    ...(options?.stale ? { stale: true } : {}),
    ...(options?.transportUncertain
      ? { transportUncertain: true }
      : {}),
  };
}

function hasOnlyFields(
  value: Record<string, unknown>,
  allowedFields: readonly string[],
) {
  const allowed = new Set(allowedFields);
  return Object.keys(value).every((field) => allowed.has(field));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function normalizeOptionalText(
  value: unknown,
  maximumLength: number,
): string | null | undefined {
  if (value !== null && value !== undefined && typeof value !== "string") {
    return undefined;
  }

  const normalized = typeof value === "string" ? value.trim() : "";

  if (normalized.length > maximumLength) {
    return undefined;
  }

  return normalized || null;
}

function isValidOrderDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeLines(
  value: unknown,
  allowExistingIds: boolean,
): SupplierOrderLineInput[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximumLines
  ) {
    return null;
  }

  const normalizedLines: SupplierOrderLineInput[] = [];
  const identities = new Set<string>();
  const existingIds = new Set<string>();

  for (const rawLine of value) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      return null;
    }

    const line = rawLine as Record<string, unknown>;
    const existingId =
      line.id === undefined
        ? undefined
        : isUuid(line.id)
          ? line.id.toLowerCase()
          : null;

    if (
      existingId === null ||
      (!allowExistingIds && existingId !== undefined) ||
      (existingId !== undefined && existingIds.has(existingId))
    ) {
      return null;
    }

    if (
      typeof line.quantity !== "number" ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > maximumInteger
    ) {
      return null;
    }

    const notes = normalizeOptionalText(line.notes, maximumLineNotesLength);

    if (notes === undefined) {
      return null;
    }

    if (line.kind === "ITEM") {
      if (
        !hasOnlyFields(line, [
          "id",
          "kind",
          "item_id",
          "quantity",
          "notes",
        ]) ||
        !isUuid(line.item_id)
      ) {
        return null;
      }

      const itemId = line.item_id.toLowerCase();
      const identity = `ITEM:${itemId}`;

      if (identities.has(identity)) {
        return null;
      }

      identities.add(identity);
      normalizedLines.push({
        ...(existingId ? { id: existingId } : {}),
        kind: "ITEM",
        item_id: itemId,
        quantity: line.quantity,
        notes,
      });
    } else if (line.kind === "COMMERCIAL_CONFIGURATION") {
      if (
        !hasOnlyFields(line, [
          "id",
          "kind",
          "commercial_configuration_id",
          "commercial_configuration_code_id",
          "quantity",
          "notes",
        ]) ||
        !isUuid(line.commercial_configuration_id) ||
        (line.commercial_configuration_code_id !== null &&
          !isUuid(line.commercial_configuration_code_id))
      ) {
        return null;
      }

      const configurationId =
        line.commercial_configuration_id.toLowerCase();
      const codeId =
        typeof line.commercial_configuration_code_id === "string"
          ? line.commercial_configuration_code_id.toLowerCase()
          : null;
      const identity = `CONFIGURATION:${configurationId}:${codeId ?? "NONE"}`;

      if (identities.has(identity)) {
        return null;
      }

      identities.add(identity);
      normalizedLines.push({
        ...(existingId ? { id: existingId } : {}),
        kind: "COMMERCIAL_CONFIGURATION",
        commercial_configuration_id: configurationId,
        commercial_configuration_code_id: codeId,
        quantity: line.quantity,
        notes,
      });
    } else {
      return null;
    }

    if (existingId) {
      existingIds.add(existingId);
    }
  }

  return normalizedLines;
}

function normalizeOrderInput(
  input: unknown,
  mode: "CREATE" | "UPDATE",
):
  | CreateSupplierOrderInput
  | UpdateSupplierOrderInput
  | SupplierOrderActionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return actionError("Os dados do pedido são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const sharedFields = [
    "negotiation_number",
    "order_date",
    "notes",
    "lines",
    "idempotency_key",
  ];
  const allowedFields =
    mode === "UPDATE"
      ? [...sharedFields, "supplier_order_id", "expected_updated_at"]
      : sharedFields;

  if (!hasOnlyFields(request, allowedFields)) {
    return actionError("Os dados do pedido são inválidos.");
  }

  const negotiationNumber =
    typeof request.negotiation_number === "string"
      ? request.negotiation_number.trim()
      : "";
  const notes = normalizeOptionalText(
    request.notes,
    maximumOrderNotesLength,
  );
  const lines = normalizeLines(request.lines, mode === "UPDATE");

  if (
    !negotiationNumber ||
    negotiationNumber.length > maximumNegotiationNumberLength
  ) {
    return actionError(
      `Informe o Nº do pedido com até ${maximumNegotiationNumberLength} caracteres.`,
    );
  }

  if (!/^[0-9]+$/.test(negotiationNumber)) {
    return actionError("Informe somente números no Nº do Pedido.");
  }

  if (!isValidOrderDate(request.order_date)) {
    return actionError("Informe uma data válida para o pedido.");
  }

  if (notes === undefined) {
    return actionError(
      `As observações devem ter no máximo ${maximumOrderNotesLength} caracteres.`,
    );
  }

  if (!lines) {
    return actionError(
      "Adicione ao menos um item válido com quantidade inteira e positiva.",
    );
  }

  if (!isUuid(request.idempotency_key)) {
    return actionError("Não foi possível identificar esta tentativa.");
  }

  const sharedInput: CreateSupplierOrderInput = {
    negotiation_number: negotiationNumber,
    order_date: request.order_date,
    notes,
    lines,
    idempotency_key: request.idempotency_key.toLowerCase(),
  };

  if (mode === "CREATE") {
    return sharedInput;
  }

  if (
    !isUuid(request.supplier_order_id) ||
    typeof request.expected_updated_at !== "string" ||
    Number.isNaN(Date.parse(request.expected_updated_at))
  ) {
    return actionError(
      "Este pedido precisa ser atualizado antes de salvar as alterações.",
      true,
    );
  }

  return {
    ...sharedInput,
    supplier_order_id: request.supplier_order_id.toLowerCase(),
    expected_updated_at: request.expected_updated_at,
  };
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext | null> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    typeof profile.name !== "string" ||
    !profile.name.trim()
  ) {
    return null;
  }

  return { supabase };
}

function parseNonnegativeInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseAutomaticStockEntry(
  receipt: RpcReceipt,
): SupplierOrderReceipt["automaticStockEntry"] | null | undefined {
  const stockFields = [
    receipt.supplier_order_stock_entry_id,
    receipt.movement_batch_id,
    receipt.stock_entry_line_count,
    receipt.stock_entry_quantity,
    receipt.stock_entry_created_at,
  ];

  if (stockFields.every((field) => field === undefined || field === null)) {
    return undefined;
  }

  const lineCount = parseNonnegativeInteger(receipt.stock_entry_line_count);
  const quantity = parseNonnegativeInteger(receipt.stock_entry_quantity);
  const pickedQuantityDelta = parseNonnegativeInteger(
    receipt.picked_quantity_delta ?? receipt.added_picked_quantity,
  );

  if (
    !isUuid(receipt.supplier_order_stock_entry_id) ||
    !isUuid(receipt.movement_batch_id) ||
    lineCount === null ||
    lineCount < 1 ||
    quantity === null ||
    quantity < 1 ||
    pickedQuantityDelta === null ||
    quantity !== pickedQuantityDelta ||
    typeof receipt.stock_entry_created_at !== "string" ||
    Number.isNaN(Date.parse(receipt.stock_entry_created_at)) ||
    typeof receipt.idempotent_replay !== "boolean"
  ) {
    return null;
  }

  return {
    supplierOrderStockEntryId:
      receipt.supplier_order_stock_entry_id.toLowerCase(),
    movementBatchId: receipt.movement_batch_id.toLowerCase(),
    lineCount,
    quantity,
    createdAt: receipt.stock_entry_created_at,
    pickedQuantityDelta,
    idempotentReplay: receipt.idempotent_replay,
  };
}

function parseReceipt(data: unknown): SupplierOrderReceipt | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const receipt = data as RpcReceipt;
  const lineCount = parseNonnegativeInteger(receipt.line_count);
  const orderedQuantity = parseNonnegativeInteger(receipt.ordered_quantity);
  const pickedQuantity = parseNonnegativeInteger(receipt.picked_quantity);
  const cancelledQuantity = parseNonnegativeInteger(
    receipt.cancelled_quantity,
  );
  const waitingPickupQuantity = parseNonnegativeInteger(
    receipt.waiting_pickup_quantity,
  );
  const stockedQuantity = parseNonnegativeInteger(receipt.stocked_quantity);
  const waitingStockQuantity = parseNonnegativeInteger(
    receipt.waiting_stock_quantity,
  );
  const pickupPercentage = Number(receipt.pickup_percentage);
  const automaticStockEntry = parseAutomaticStockEntry(receipt);
  const status: SupplierOrderStatus | null =
    typeof receipt.status === "string"
      ? (supplierOrderStatuses.find(
          (candidate) => candidate === receipt.status,
        ) ?? null)
      : null;

  if (
    !isUuid(receipt.supplier_order_id) ||
    typeof receipt.negotiation_number !== "string" ||
    lineCount === null ||
    orderedQuantity === null ||
    pickedQuantity === null ||
    cancelledQuantity === null ||
    waitingPickupQuantity === null ||
    stockedQuantity === null ||
    waitingStockQuantity === null ||
    !Number.isFinite(pickupPercentage) ||
    automaticStockEntry === null ||
    !status ||
    typeof receipt.updated_at !== "string" ||
    Number.isNaN(Date.parse(receipt.updated_at))
  ) {
    return null;
  }

  return {
    supplierOrderId: receipt.supplier_order_id,
    negotiationNumber: receipt.negotiation_number,
    lineCount,
    orderedQuantity,
    pickedQuantity,
    cancelledQuantity,
    waitingPickupQuantity,
    stockedQuantity,
    waitingStockQuantity,
    pickupPercentage,
    status,
    updatedAt: receipt.updated_at,
    ...(automaticStockEntry ? { automaticStockEntry } : {}),
  };
}

function parseStockEntryReceipt(
  data: unknown,
): SupplierOrderStockEntryReceipt | null {
  const receipt = parseReceipt(data);

  if (!receipt || !data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const stockEntry = data as RpcStockEntryReceipt;
  const stockEntryLineCount = parseNonnegativeInteger(
    stockEntry.stock_entry_line_count,
  );
  const stockEntryQuantity = parseNonnegativeInteger(
    stockEntry.stock_entry_quantity,
  );

  if (
    !isUuid(stockEntry.supplier_order_stock_entry_id) ||
    !isUuid(stockEntry.movement_batch_id) ||
    stockEntryLineCount === null ||
    stockEntryLineCount < 1 ||
    stockEntryQuantity === null ||
    stockEntryQuantity < 1 ||
    typeof stockEntry.stock_entry_created_at !== "string" ||
    Number.isNaN(Date.parse(stockEntry.stock_entry_created_at))
  ) {
    return null;
  }

  return {
    ...receipt,
    supplierOrderStockEntryId:
      stockEntry.supplier_order_stock_entry_id,
    movementBatchId: stockEntry.movement_batch_id,
    stockEntryLineCount,
    stockEntryQuantity,
    stockEntryCreatedAt: stockEntry.stock_entry_created_at,
  };
}

function mapRpcError(
  code: string | undefined,
  message: string,
): SupplierOrderActionResult {
  const normalizedMessage = message.toLocaleLowerCase("en-US");

  if (code === "40001" || normalizedMessage.includes("changed after")) {
    return actionError(
      "Este pedido foi alterado por outro usuário. Os dados foram atualizados.",
      true,
    );
  }

  if (code === "42501" || code === "28000") {
    return actionError(
      "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
    );
  }

  if (normalizedMessage.includes("idempotency")) {
    return actionError(
      "Não foi possível repetir esta operação. Atualize os dados e tente novamente.",
    );
  }

  if (normalizedMessage.includes("picked_quantity cannot be reduced")) {
    return actionError(
      "A retirada já registrada não pode ser reduzida por este fluxo.",
    );
  }

  if (normalizedMessage.includes("picked_quantity cannot exceed ready_quantity")) {
    return actionError(
      "A quantidade pronta disponível mudou. Atualize o Pedido e revise a retirada.",
      true,
    );
  }

  if (
    normalizedMessage.includes("cancelled supplier order") ||
    normalizedMessage.includes("already cancelled")
  ) {
    return actionError(
      "Este pedido está cancelado e não pode mais ser alterado.",
    );
  }

  if (normalizedMessage.includes("ready quantities still awaiting pickup")) {
    return actionError(
      "Este pedido possui unidades informadas como prontas e ainda não retiradas. Resolva a quantidade pronta antes de excluir o pedido.",
    );
  }

  if (
    normalizedMessage.includes("picked plus cancelled") ||
    normalizedMessage.includes("lower than stocked") ||
    normalizedMessage.includes("ordered_quantity cannot be lower")
  ) {
    return actionError(
      "A quantidade deve respeitar o que já foi retirado, cancelado e lançado no estoque.",
    );
  }

  if (
    normalizedMessage.includes("does not exist") ||
    normalizedMessage.includes("inactive") ||
    normalizedMessage.includes("does not belong")
  ) {
    return actionError(
      "Um pedido ou item selecionado não está mais disponível. Atualize os dados e tente novamente.",
    );
  }

  if (
    code === "22023" ||
    code === "23514" ||
    code === "23505"
  ) {
    return actionError(
      "Os dados informados não são mais válidos. Atualize o pedido e revise a operação.",
    );
  }

  return actionError(
    "Não foi possível concluir a operação. Revise os dados e tente novamente.",
  );
}

function mapFinalizeRpcError(
  code: string | undefined,
  message: string,
): SupplierOrderActionResult {
  const normalizedMessage = message.toLocaleLowerCase("en-US");

  if (code === "40001" || normalizedMessage.includes("changed after")) {
    return actionError(
      "Este pedido foi alterado por outro usuário. Os dados foram atualizados.",
      true,
    );
  }

  if (normalizedMessage.includes("already finalized")) {
    return actionError("Este pedido já foi finalizado.");
  }

  if (normalizedMessage.includes("cancelled supplier order")) {
    return actionError("Pedidos cancelados já pertencem ao Histórico.");
  }

  if (
    normalizedMessage.includes("only a completed supplier order") ||
    normalizedMessage.includes("pickup quantity remaining")
  ) {
    return actionError(
      "Somente pedidos concluídos podem ser finalizados.",
    );
  }

  if (normalizedMessage.includes("finalization_note")) {
    return actionError(
      `A observação final deve ter no máximo ${maximumOperationDescriptionLength} caracteres.`,
    );
  }

  return mapRpcError(code, message);
}

function mapStockEntryRpcError(
  code: string | undefined,
  message: string,
): SupplierOrderStockEntryActionResult {
  const normalizedMessage = message.toLocaleLowerCase("en-US");

  if (code === "40001" || normalizedMessage.includes("changed after")) {
    return stockEntryActionError(
      "Este pedido foi atualizado por outra operação. Recarregue os dados antes de tentar novamente.",
      { stale: true },
    );
  }

  if (code === "42501" || code === "28000") {
    return stockEntryActionError("Seu acesso não está ativo.");
  }

  if (normalizedMessage.includes("same supplier-order line")) {
    return stockEntryActionError(
      "O mesmo item não pode aparecer duas vezes na entrada.",
    );
  }

  if (
    normalizedMessage.includes("cannot exceed") ||
    normalizedMessage.includes("awaiting stock entry")
  ) {
    return stockEntryActionError(
      "A quantidade para entrada não pode ultrapassar o que já foi retirado.",
    );
  }

  if (
    normalizedMessage.includes("every stock-entry line must belong") ||
    normalizedMessage.includes("must belong to the informed supplier order")
  ) {
    return stockEntryActionError(
      "Um dos itens não pertence mais a este pedido.",
    );
  }

  if (normalizedMessage.includes("supplier order does not exist")) {
    return stockEntryActionError("O pedido não foi encontrado.");
  }

  if (
    normalizedMessage.includes("idempotency") ||
    normalizedMessage.includes("different request")
  ) {
    return stockEntryActionError(
      "Esta tentativa já foi usada com outros dados. Revise a entrada e tente novamente.",
    );
  }

  return stockEntryActionError(
    "Não foi possível registrar a entrada no estoque.",
  );
}

function normalizeStockEntryInput(
  input: unknown,
):
  | SupplierOrderStockEntryActionInput
  | SupplierOrderStockEntryActionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return stockEntryActionError("Os dados da entrada são inválidos.");
  }

  const request = input as Record<string, unknown>;

  if (
    !hasOnlyFields(request, [
      "supplierOrderId",
      "lines",
      "note",
      "expectedUpdatedAt",
      "idempotencyKey",
    ]) ||
    !isUuid(request.supplierOrderId) ||
    !Array.isArray(request.lines) ||
    request.lines.length < 1 ||
    request.lines.length > maximumLines ||
    typeof request.expectedUpdatedAt !== "string" ||
    Number.isNaN(Date.parse(request.expectedUpdatedAt)) ||
    !isUuid(request.idempotencyKey)
  ) {
    return stockEntryActionError("Os dados da entrada são inválidos.");
  }

  const note = normalizeOptionalText(
    request.note,
    maximumOperationDescriptionLength,
  );

  if (note === undefined) {
    return stockEntryActionError(
      `A observação deve ter no máximo ${maximumOperationDescriptionLength} caracteres.`,
    );
  }

  const lineIds = new Set<string>();
  const lines: SupplierOrderStockEntryActionInput["lines"] = [];

  for (const rawLine of request.lines) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      return stockEntryActionError("Os dados da entrada são inválidos.");
    }

    const line = rawLine as Record<string, unknown>;

    if (
      !hasOnlyFields(line, ["supplierOrderItemId", "quantity"]) ||
      !isUuid(line.supplierOrderItemId) ||
      typeof line.quantity !== "number" ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > maximumInteger
    ) {
      return stockEntryActionError(
        "Informe quantidades inteiras e positivas para a entrada.",
      );
    }

    const supplierOrderItemId = line.supplierOrderItemId.toLowerCase();

    if (lineIds.has(supplierOrderItemId)) {
      return stockEntryActionError(
        "O mesmo item não pode aparecer duas vezes na entrada.",
      );
    }

    lineIds.add(supplierOrderItemId);
    lines.push({
      supplierOrderItemId,
      quantity: line.quantity,
    });
  }

  return {
    supplierOrderId: request.supplierOrderId.toLowerCase(),
    lines,
    note,
    expectedUpdatedAt: request.expectedUpdatedAt,
    idempotencyKey: request.idempotencyKey.toLowerCase(),
  };
}

function finishMutation(data: unknown): SupplierOrderActionResult {
  const receipt = parseReceipt(data);

  if (!receipt) {
    return actionError(
      "A operação foi processada, mas a confirmação não pôde ser carregada. Tente novamente com os mesmos dados.",
    );
  }

  revalidatePath("/pedidos");
  return { ok: true, receipt };
}

export async function createSupplierOrder(
  input: unknown,
): Promise<SupplierOrderActionResult> {
  const normalized = normalizeOrderInput(input, "CREATE");

  if ("ok" in normalized) {
    return normalized;
  }

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return actionError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    const { data, error } = await context.supabase.rpc(
      "create_supplier_order",
      {
        p_negotiation_number: normalized.negotiation_number,
        p_order_date: normalized.order_date,
        p_notes: normalized.notes,
        p_lines: normalized.lines,
        p_idempotency_key: normalized.idempotency_key,
      },
    );

    return error ? mapRpcError(error.code, error.message) : finishMutation(data);
  } catch {
    return actionError(
      "Não foi possível criar o pedido agora. Tente novamente.",
    );
  }
}

export async function updateSupplierOrder(
  input: unknown,
): Promise<SupplierOrderActionResult> {
  const normalized = normalizeOrderInput(input, "UPDATE");

  if ("ok" in normalized) {
    return normalized;
  }

  if (!("supplier_order_id" in normalized)) {
    return actionError("Os dados da edição são inválidos.");
  }

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return actionError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    const { data, error } = await context.supabase.rpc(
      "update_supplier_order",
      {
        p_supplier_order_id: normalized.supplier_order_id,
        p_expected_updated_at: normalized.expected_updated_at,
        p_negotiation_number: normalized.negotiation_number,
        p_order_date: normalized.order_date,
        p_notes: normalized.notes,
        p_lines: normalized.lines,
        p_idempotency_key: normalized.idempotency_key,
      },
    );

    return error ? mapRpcError(error.code, error.message) : finishMutation(data);
  } catch {
    return actionError(
      "Não foi possível editar o pedido agora. Tente novamente.",
    );
  }
}

export async function setSupplierOrderItemPickedQuantity(
  input: unknown,
): Promise<SupplierOrderActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return actionError("Os dados da retirada são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const description = normalizeOptionalText(
    request.description,
    maximumOperationDescriptionLength,
  );

  if (
    !hasOnlyFields(request, [
      "supplier_order_item_id",
      "picked_quantity",
      "description",
      "idempotency_key",
    ]) ||
    !isUuid(request.supplier_order_item_id) ||
    typeof request.picked_quantity !== "number" ||
    !Number.isInteger(request.picked_quantity) ||
    request.picked_quantity < 0 ||
    request.picked_quantity > maximumInteger ||
    description === undefined ||
    !isUuid(request.idempotency_key)
  ) {
    return actionError(
      "A quantidade retirada deve ficar entre o que já entrou no estoque e o total disponível.",
    );
  }

  const normalized: SetSupplierOrderPickedQuantityInput = {
    supplier_order_item_id: request.supplier_order_item_id.toLowerCase(),
    picked_quantity: request.picked_quantity,
    description,
    idempotency_key: request.idempotency_key.toLowerCase(),
  };

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return actionError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    const { data, error } = await context.supabase.rpc(
      "set_supplier_order_item_picked_quantity",
      {
        p_supplier_order_item_id: normalized.supplier_order_item_id,
        p_picked_quantity: normalized.picked_quantity,
        p_description: normalized.description,
        p_idempotency_key: normalized.idempotency_key,
      },
    );

    return error ? mapRpcError(error.code, error.message) : finishMutation(data);
  } catch {
    return actionError(
      "Não foi possível salvar a retirada agora. Tente novamente.",
    );
  }
}

export async function markSupplierOrderAllPicked(
  input: unknown,
): Promise<SupplierOrderActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return actionError("Os dados da retirada são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const description = normalizeOptionalText(
    request.description,
    maximumOperationDescriptionLength,
  );

  if (
    !hasOnlyFields(request, [
      "supplier_order_id",
      "description",
      "idempotency_key",
    ]) ||
    !isUuid(request.supplier_order_id) ||
    description === undefined ||
    !isUuid(request.idempotency_key)
  ) {
    return actionError("Não foi possível identificar esta retirada.");
  }

  const normalized: SupplierOrderCommandInput = {
    supplier_order_id: request.supplier_order_id.toLowerCase(),
    description,
    idempotency_key: request.idempotency_key.toLowerCase(),
  };

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return actionError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    const { data, error } = await context.supabase.rpc(
      "mark_supplier_order_all_picked",
      {
        p_supplier_order_id: normalized.supplier_order_id,
        p_description: normalized.description,
        p_idempotency_key: normalized.idempotency_key,
      },
    );

    return error ? mapRpcError(error.code, error.message) : finishMutation(data);
  } catch {
    return actionError(
      "Não foi possível marcar todas as retiradas agora. Tente novamente.",
    );
  }
}

async function cancelSupplierOrderWithRpc(
  rpcName: "cancel_supplier_order" | "cancel_supplier_order_remaining",
  input: unknown,
): Promise<SupplierOrderActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return actionError("Os dados do cancelamento são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const cancellationNote =
    typeof request.cancellation_note === "string"
      ? request.cancellation_note.trim()
      : "";

  if (
    !hasOnlyFields(request, [
      "supplier_order_id",
      "cancellation_note",
      "idempotency_key",
    ]) ||
    !isUuid(request.supplier_order_id) ||
    cancellationNote.length < 3 ||
    cancellationNote.length > maximumOperationDescriptionLength ||
    !isUuid(request.idempotency_key)
  ) {
    return actionError(
      `Informe um motivo entre 3 e ${maximumOperationDescriptionLength} caracteres.`,
    );
  }

  const normalized: SupplierOrderCancellationInput = {
    supplier_order_id: request.supplier_order_id.toLowerCase(),
    cancellation_note: cancellationNote,
    idempotency_key: request.idempotency_key.toLowerCase(),
  };

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return actionError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    const { data, error } = await context.supabase.rpc(rpcName, {
      p_supplier_order_id: normalized.supplier_order_id,
      p_cancellation_note: normalized.cancellation_note,
      p_idempotency_key: normalized.idempotency_key,
    });

    if (error) return mapRpcError(error.code, error.message);

    await dispatchSafisaFullyReadyPush(normalized.supplier_order_id);
    return finishMutation(data);
  } catch {
    return actionError(
      "Não foi possível cancelar o pedido agora. Tente novamente.",
    );
  }
}

export async function cancelSupplierOrder(
  input: unknown,
): Promise<SupplierOrderActionResult> {
  return cancelSupplierOrderWithRpc("cancel_supplier_order", input);
}

export async function cancelSupplierOrderRemaining(
  input: unknown,
): Promise<SupplierOrderActionResult> {
  return cancelSupplierOrderWithRpc("cancel_supplier_order_remaining", input);
}

export async function finalizeSupplierOrder(
  input: unknown,
): Promise<SupplierOrderActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return actionError("Os dados da finalização são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const finalizationNote = normalizeOptionalText(
    request.finalization_note,
    maximumOperationDescriptionLength,
  );

  if (
    !hasOnlyFields(request, [
      "supplier_order_id",
      "expected_updated_at",
      "finalization_note",
      "idempotency_key",
    ]) ||
    !isUuid(request.supplier_order_id) ||
    typeof request.expected_updated_at !== "string" ||
    Number.isNaN(Date.parse(request.expected_updated_at)) ||
    finalizationNote === undefined ||
    !isUuid(request.idempotency_key)
  ) {
    return actionError(
      `Revise o pedido e informe uma observação final de até ${maximumOperationDescriptionLength} caracteres.`,
    );
  }

  const normalized: FinalizeSupplierOrderInput = {
    supplier_order_id: request.supplier_order_id.toLowerCase(),
    expected_updated_at: request.expected_updated_at,
    finalization_note: finalizationNote,
    idempotency_key: request.idempotency_key.toLowerCase(),
  };

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return actionError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    const { data, error } = await context.supabase.rpc(
      "finalize_supplier_order",
      {
        p_supplier_order_id: normalized.supplier_order_id,
        p_expected_updated_at: normalized.expected_updated_at,
        p_finalization_note: normalized.finalization_note,
        p_idempotency_key: normalized.idempotency_key,
      },
    );

    return error
      ? mapFinalizeRpcError(error.code, error.message)
      : finishMutation(data);
  } catch {
    return actionError(
      "Não foi possível finalizar o pedido agora. Tente novamente.",
    );
  }
}

export async function createSupplierOrderStockEntryAction(
  input: unknown,
): Promise<SupplierOrderStockEntryActionResult> {
  const normalized = normalizeStockEntryInput(input);

  if ("ok" in normalized) {
    return normalized;
  }

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return stockEntryActionError("Seu acesso não está ativo.");
    }

    const { data, error } = await context.supabase.rpc(
      "create_supplier_order_stock_entry",
      {
        p_supplier_order_id: normalized.supplierOrderId,
        p_lines: normalized.lines.map((line) => ({
          supplier_order_item_id: line.supplierOrderItemId,
          quantity: line.quantity,
        })),
        p_note: normalized.note ?? null,
        p_expected_updated_at: normalized.expectedUpdatedAt,
        p_idempotency_key: normalized.idempotencyKey,
      },
    );

    if (error) {
      return mapStockEntryRpcError(error.code, error.message);
    }

    const receipt = parseStockEntryReceipt(data);

    if (!receipt) {
      return stockEntryActionError(
        "Não foi possível confirmar o resultado. Tente novamente sem alterar os dados para verificar a mesma operação.",
        { transportUncertain: true },
      );
    }

    [
      "/",
      "/pedidos",
      "/estoque",
      "/entrada",
      "/saida",
      "/estatisticas",
      "/historico",
    ].forEach((path) => revalidatePath(path));

    return { ok: true, receipt };
  } catch {
    return stockEntryActionError(
      "Não foi possível confirmar o resultado. Tente novamente sem alterar os dados para verificar a mesma operação.",
      { transportUncertain: true },
    );
  }
}
