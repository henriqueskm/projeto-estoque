"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  supplierOrderStatuses,
  type CreateSupplierOrderInput,
  type SetSupplierOrderPickedQuantityInput,
  type SupplierOrderActionResult,
  type SupplierOrderCancellationInput,
  type SupplierOrderCommandInput,
  type SupplierOrderLineInput,
  type SupplierOrderReceipt,
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
};

function actionError(
  error: string,
  stale = false,
): SupplierOrderActionResult {
  return stale ? { ok: false, error, stale: true } : { ok: false, error };
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

  if (
    normalizedMessage.includes("cancelled supplier order") ||
    normalizedMessage.includes("already cancelled")
  ) {
    return actionError(
      "Este pedido está cancelado e não pode mais ser alterado.",
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

    return error ? mapRpcError(error.code, error.message) : finishMutation(data);
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
