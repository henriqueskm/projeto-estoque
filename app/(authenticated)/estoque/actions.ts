"use server";

import { revalidatePath } from "next/cache";
import type {
  MinimumStockActionResult,
  MinimumStockReceipt,
  StockAdjustmentActionResult,
  StockAdjustmentReceipt,
} from "@/lib/inventory-action-types";
import { createClient } from "@/lib/supabase/server";

const maximumInteger = 2_147_483_647;
const maximumReasonLength = 500;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdjustmentRpcReceipt = {
  movement_batch_id?: unknown;
  adjustment_applied?: unknown;
  quantity_before?: unknown;
  quantity_change?: unknown;
  quantity_after?: unknown;
};

type MinimumStockRpcReceipt = {
  change_applied?: unknown;
  change_id?: unknown;
  previous_minimum_stock?: unknown;
  new_minimum_stock?: unknown;
};

type AuthenticatedContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
};

function adjustmentError(error: string): StockAdjustmentActionResult {
  return { ok: false, error };
}

function minimumStockError(error: string): MinimumStockActionResult {
  return { ok: false, error };
}

async function getAuthenticatedContext(): Promise<
  AuthenticatedContext | null
> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError || !profile) {
    return null;
  }

  return { supabase };
}

function isPostgresInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximumInteger
  );
}

function parseAdjustmentReceipt(data: unknown): StockAdjustmentReceipt | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const receipt = data as AdjustmentRpcReceipt;
  const movementBatchId = receipt.movement_batch_id;

  if (
    (movementBatchId !== null &&
      (typeof movementBatchId !== "string" ||
        !uuidPattern.test(movementBatchId))) ||
    typeof receipt.adjustment_applied !== "boolean" ||
    !isPostgresInteger(receipt.quantity_before) ||
    typeof receipt.quantity_change !== "number" ||
    !Number.isInteger(receipt.quantity_change) ||
    receipt.quantity_change < -maximumInteger ||
    receipt.quantity_change > maximumInteger ||
    !isPostgresInteger(receipt.quantity_after) ||
    receipt.quantity_after !==
      receipt.quantity_before + receipt.quantity_change ||
    receipt.adjustment_applied !== (receipt.quantity_change !== 0) ||
    (receipt.adjustment_applied && movementBatchId === null) ||
    (!receipt.adjustment_applied && movementBatchId !== null)
  ) {
    return null;
  }

  return {
    movementBatchId,
    adjustmentApplied: receipt.adjustment_applied,
    quantityBefore: receipt.quantity_before,
    quantityChange: receipt.quantity_change,
    quantityAfter: receipt.quantity_after,
  };
}

function parseMinimumStockReceipt(data: unknown): MinimumStockReceipt | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const receipt = data as MinimumStockRpcReceipt;
  const changeId = receipt.change_id;

  if (
    typeof receipt.change_applied !== "boolean" ||
    (changeId !== null &&
      (typeof changeId !== "string" || !uuidPattern.test(changeId))) ||
    !isPostgresInteger(receipt.previous_minimum_stock) ||
    !isPostgresInteger(receipt.new_minimum_stock) ||
    (receipt.change_applied && changeId === null) ||
    (!receipt.change_applied && changeId !== null) ||
    (receipt.change_applied &&
      receipt.previous_minimum_stock === receipt.new_minimum_stock) ||
    (!receipt.change_applied &&
      receipt.previous_minimum_stock !== receipt.new_minimum_stock)
  ) {
    return null;
  }

  return {
    changeApplied: receipt.change_applied,
    changeId,
    previousMinimumStock: receipt.previous_minimum_stock,
    newMinimumStock: receipt.new_minimum_stock,
  };
}

function mapAdjustmentRpcError(code: string | undefined, message: string) {
  const normalizedMessage = message.toLocaleLowerCase("en-US");

  if (code === "42501" || code === "28000") {
    return "Sua sessão não está disponível. Entre novamente para continuar.";
  }

  if (normalizedMessage.includes("idempotency_key")) {
    return "Esta tentativa já foi usada com um ajuste diferente. Feche a janela, confira os dados e tente novamente.";
  }

  if (normalizedMessage.includes("does not exist")) {
    return "Este cadastro não está mais disponível. Atualize a página e tente novamente.";
  }

  if (code === "22003") {
    return "A quantidade informada excede o limite permitido.";
  }

  if (code === "22023" || code === "23514") {
    return "Os dados do ajuste não são mais válidos. Atualize a página e confira o saldo novamente.";
  }

  return "Não foi possível ajustar o estoque. Confira os dados e tente novamente.";
}

function mapMinimumStockRpcError(code: string | undefined, message: string) {
  const normalizedMessage = message.toLocaleLowerCase("en-US");

  if (code === "42501" || code === "28000") {
    return "Sua sessão não está disponível. Entre novamente para continuar.";
  }

  if (normalizedMessage.includes("does not exist")) {
    return "Este item não está mais disponível. Atualize a página e tente novamente.";
  }

  if (code === "22023" || code === "23514") {
    return "O estoque mínimo informado não é válido.";
  }

  return "Não foi possível alterar o estoque mínimo. Tente novamente.";
}

export async function adjustInventoryStock(
  input: unknown,
): Promise<StockAdjustmentActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return adjustmentError("Os dados do ajuste são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const allowedFields = new Set([
    "target_kind",
    "target_id",
    "counted_quantity",
    "reason",
    "idempotency_key",
  ]);

  if (
    Object.keys(request).some((field) => !allowedFields.has(field)) ||
    (request.target_kind !== "ITEM" &&
      request.target_kind !== "CONFIGURATION") ||
    typeof request.target_id !== "string" ||
    !uuidPattern.test(request.target_id) ||
    !isPostgresInteger(request.counted_quantity) ||
    typeof request.reason !== "string" ||
    typeof request.idempotency_key !== "string" ||
    !uuidPattern.test(request.idempotency_key)
  ) {
    return adjustmentError("Revise os dados informados para o ajuste.");
  }

  const reason = request.reason.trim();

  if (!reason || reason.length > maximumReasonLength) {
    return adjustmentError(
      `Informe um motivo com até ${maximumReasonLength} caracteres.`,
    );
  }

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return adjustmentError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    if (request.target_kind === "ITEM") {
      const { data: item, error: itemError } = await context.supabase
        .from("items")
        .select("id, item_type")
        .eq("id", request.target_id)
        .in("item_type", [
          "SERVO",
          "INSTALLATION_KIT",
          "REPAIR_KIT",
          "LOOSE_PART",
        ])
        .maybeSingle();

      if (itemError || !item) {
        return adjustmentError(
          "Este item não está mais disponível. Atualize a página.",
        );
      }
    } else {
      const { data: configuration, error: configurationError } =
        await context.supabase
          .from("commercial_configurations")
          .select("id")
          .eq("id", request.target_id)
          .maybeSingle();

      if (configurationError || !configuration) {
        return adjustmentError(
          "Esta configuração não está mais disponível. Atualize a página.",
        );
      }
    }

    const rpcName =
      request.target_kind === "ITEM"
        ? "adjust_item_stock"
        : "adjust_configuration_stock";
    const targetArgument =
      request.target_kind === "ITEM"
        ? { p_item_id: request.target_id }
        : { p_configuration_id: request.target_id };
    const { data, error } = await context.supabase.rpc(rpcName, {
      ...targetArgument,
      p_counted_quantity: request.counted_quantity,
      p_reason: reason,
      p_idempotency_key: request.idempotency_key.toLowerCase(),
    });

    if (error) {
      return adjustmentError(mapAdjustmentRpcError(error.code, error.message));
    }

    const receipt = parseAdjustmentReceipt(data);

    if (!receipt) {
      return adjustmentError(
        "O ajuste foi processado, mas a confirmação não pôde ser carregada. Tente novamente com os mesmos dados.",
      );
    }

    revalidatePath("/");
    revalidatePath("/estoque");
    revalidatePath("/entrada");
    revalidatePath("/saida");
    revalidatePath("/historico");

    return { ok: true, receipt };
  } catch {
    return adjustmentError(
      "Não foi possível concluir o ajuste agora. Tente novamente.",
    );
  }
}

export async function changeItemMinimumStock(
  input: unknown,
): Promise<MinimumStockActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return minimumStockError("Os dados informados são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const allowedFields = new Set(["item_id", "minimum_stock"]);

  if (
    Object.keys(request).some((field) => !allowedFields.has(field)) ||
    typeof request.item_id !== "string" ||
    !uuidPattern.test(request.item_id) ||
    !isPostgresInteger(request.minimum_stock)
  ) {
    return minimumStockError(
      "Informe um estoque mínimo inteiro e maior ou igual a zero.",
    );
  }

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return minimumStockError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    const { data: item, error: itemError } = await context.supabase
      .from("items")
      .select("id, item_type")
      .eq("id", request.item_id)
      .in("item_type", [
        "SERVO",
        "INSTALLATION_KIT",
        "REPAIR_KIT",
        "LOOSE_PART",
      ])
      .maybeSingle();

    if (itemError || !item) {
      return minimumStockError(
        "Este item não está mais disponível. Atualize a página.",
      );
    }

    const { data, error } = await context.supabase.rpc(
      "set_item_minimum_stock",
      {
        p_item_id: request.item_id,
        p_minimum_stock: request.minimum_stock,
      },
    );

    if (error) {
      return minimumStockError(
        mapMinimumStockRpcError(error.code, error.message),
      );
    }

    const receipt = parseMinimumStockReceipt(data);

    if (!receipt) {
      return minimumStockError(
        "A alteração foi processada, mas a confirmação não pôde ser carregada. Atualize a página antes de tentar novamente.",
      );
    }

    revalidatePath("/");
    revalidatePath("/estoque");

    return { ok: true, receipt };
  } catch {
    return minimumStockError(
      "Não foi possível alterar o estoque mínimo agora. Tente novamente.",
    );
  }
}
