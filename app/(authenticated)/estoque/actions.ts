"use server";

import { revalidatePath } from "next/cache";
import type {
  ConfigurationOperationActionResult,
  ConfigurationOperationReceipt,
  ConfigurationOperationType,
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

type ConfigurationOperationRpcReceipt = {
  movement_batch_id?: unknown;
  operation_type?: unknown;
  configuration_id?: unknown;
  commercial_code?: unknown;
  quantity?: unknown;
  servo_id?: unknown;
  installation_kit_id?: unknown;
  servo_quantity_before?: unknown;
  servo_quantity_after?: unknown;
  kit_quantity_before?: unknown;
  kit_quantity_after?: unknown;
  configuration_quantity_before?: unknown;
  configuration_quantity_after?: unknown;
  operation_applied?: unknown;
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

function configurationOperationError(
  error: string,
): ConfigurationOperationActionResult {
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

function parseConfigurationOperationReceipt(
  data: unknown,
  expected: {
    operationType: ConfigurationOperationType;
    configurationId: string;
    commercialCode: string | null;
    quantity: number;
    servoId: string;
    installationKitId: string;
  },
): ConfigurationOperationReceipt | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const receipt = data as ConfigurationOperationRpcReceipt;
  if (
    typeof receipt.movement_batch_id !== "string" ||
    !uuidPattern.test(receipt.movement_batch_id) ||
    receipt.operation_type !== expected.operationType ||
    receipt.configuration_id !== expected.configurationId ||
    receipt.commercial_code !== expected.commercialCode ||
    receipt.quantity !== expected.quantity ||
    receipt.servo_id !== expected.servoId ||
    receipt.installation_kit_id !== expected.installationKitId ||
    receipt.operation_applied !== true ||
    !isPostgresInteger(receipt.servo_quantity_before) ||
    !isPostgresInteger(receipt.servo_quantity_after) ||
    !isPostgresInteger(receipt.kit_quantity_before) ||
    !isPostgresInteger(receipt.kit_quantity_after) ||
    !isPostgresInteger(receipt.configuration_quantity_before) ||
    !isPostgresInteger(receipt.configuration_quantity_after)
  ) {
    return null;
  }

  const servoChange =
    expected.operationType === "ASSEMBLY"
      ? -expected.quantity
      : expected.quantity;
  const configurationChange = -servoChange;

  if (
    receipt.servo_quantity_after !==
      receipt.servo_quantity_before + servoChange ||
    receipt.kit_quantity_after !== receipt.kit_quantity_before + servoChange ||
    receipt.configuration_quantity_after !==
      receipt.configuration_quantity_before + configurationChange
  ) {
    return null;
  }

  return {
    movementBatchId: receipt.movement_batch_id,
    operationType: expected.operationType,
    configurationId: expected.configurationId,
    commercialCode: expected.commercialCode,
    quantity: expected.quantity,
    servoId: expected.servoId,
    installationKitId: expected.installationKitId,
    servoQuantityBefore: receipt.servo_quantity_before,
    servoQuantityAfter: receipt.servo_quantity_after,
    kitQuantityBefore: receipt.kit_quantity_before,
    kitQuantityAfter: receipt.kit_quantity_after,
    configurationQuantityBefore: receipt.configuration_quantity_before,
    configurationQuantityAfter: receipt.configuration_quantity_after,
    operationApplied: true,
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

function mapMinimumStockRpcError(
  code: string | undefined,
  message: string,
  unavailableMessage: string,
) {
  const normalizedMessage = message.toLocaleLowerCase("en-US");

  if (code === "42501" || code === "28000") {
    return "Sua sessão não está disponível. Entre novamente para continuar.";
  }

  if (normalizedMessage.includes("does not exist")) {
    return unavailableMessage;
  }

  if (code === "22023" || code === "23514") {
    return "O estoque mínimo informado não é válido.";
  }

  return "Não foi possível alterar o estoque mínimo. Tente novamente.";
}

function mapConfigurationOperationRpcError(
  operationType: ConfigurationOperationType,
  code: string | undefined,
  message: string,
) {
  const normalizedMessage = message.toLocaleLowerCase("en-US");

  if (code === "42501" || code === "28000") {
    return "Sua sessão não está disponível. Entre novamente para continuar.";
  }

  if (normalizedMessage.includes("idempotency_key")) {
    return "Esta tentativa já foi usada com dados diferentes. Confira os dados e inicie uma nova operação.";
  }

  if (
    normalizedMessage.includes("commercial code") &&
    normalizedMessage.includes("does not belong")
  ) {
    return "O código comercial não pertence mais a esta Caixa completa. Atualize a página e tente novamente.";
  }

  if (operationType === "ASSEMBLY") {
    if (
      normalizedMessage.includes("no stock balance") ||
      normalizedMessage.includes("insufficient stock")
    ) {
      return "Sem saldo avulso suficiente para montar esta caixa. Atualize a página e confira os saldos.";
    }

    if (normalizedMessage.includes("inactive")) {
      return "Esta caixa ou um dos componentes está inativo e não pode ser montado.";
    }
  } else if (
    normalizedMessage.includes("no assembled stock balance") ||
    normalizedMessage.includes("insufficient assembled stock")
  ) {
    return "Não há Caixas completas suficientes para esta desmontagem. Atualize a página e confira o saldo.";
  }

  if (normalizedMessage.includes("does not exist")) {
    return "Esta Caixa completa não está mais disponível. Atualize a página.";
  }

  if (code === "22003") {
    return "A quantidade informada excede o limite permitido.";
  }

  if (code === "22023" || code === "23514") {
    return "Os dados da operação não são mais válidos. Atualize a página e confira os saldos novamente.";
  }

  return "Não foi possível confirmar a operação. Tente novamente sem alterar os dados.";
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
        mapMinimumStockRpcError(
          error.code,
          error.message,
          "Este item não está mais disponível. Atualize a página e tente novamente.",
        ),
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

export async function changeConfigurationMinimumStock(
  input: unknown,
): Promise<MinimumStockActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return minimumStockError("Os dados informados são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const allowedFields = new Set(["configuration_id", "minimum_stock"]);

  if (
    Object.keys(request).some((field) => !allowedFields.has(field)) ||
    typeof request.configuration_id !== "string" ||
    !uuidPattern.test(request.configuration_id) ||
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

    const { data: configuration, error: configurationError } =
      await context.supabase
        .from("commercial_configurations")
        .select("id")
        .eq("id", request.configuration_id)
        .maybeSingle();

    if (configurationError || !configuration) {
      return minimumStockError(
        "Esta configuração não está mais disponível. Atualize a página.",
      );
    }

    const { data, error } = await context.supabase.rpc(
      "set_configuration_minimum_stock",
      {
        p_configuration_id: request.configuration_id,
        p_minimum_stock: request.minimum_stock,
      },
    );

    if (error) {
      return minimumStockError(
        mapMinimumStockRpcError(
          error.code,
          error.message,
          "Esta configuração não está mais disponível. Atualize a página e tente novamente.",
        ),
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

async function performConfigurationOperation(
  operationType: ConfigurationOperationType,
  input: unknown,
): Promise<ConfigurationOperationActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return configurationOperationError("Os dados da operação são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const allowedFields = new Set([
    "configuration_id",
    "quantity",
    "idempotency_key",
    "commercial_code",
    "description",
  ]);

  if (
    Object.keys(request).some((field) => !allowedFields.has(field)) ||
    typeof request.configuration_id !== "string" ||
    !uuidPattern.test(request.configuration_id) ||
    !isPostgresInteger(request.quantity) ||
    request.quantity <= 0 ||
    typeof request.idempotency_key !== "string" ||
    !uuidPattern.test(request.idempotency_key) ||
    (request.commercial_code !== null &&
      typeof request.commercial_code !== "string") ||
    (request.description !== null && typeof request.description !== "string")
  ) {
    return configurationOperationError(
      "Revise a quantidade e os dados informados para a operação.",
    );
  }

  const configurationId = request.configuration_id.toLowerCase();
  const idempotencyKey = request.idempotency_key.toLowerCase();
  const quantity = request.quantity;
  const commercialCode =
    typeof request.commercial_code === "string"
      ? request.commercial_code.trim() || null
      : null;
  const description =
    typeof request.description === "string"
      ? request.description.trim() || null
      : null;

  if (description && description.length > maximumReasonLength) {
    return configurationOperationError(
      `A observação deve ter no máximo ${maximumReasonLength} caracteres.`,
    );
  }

  try {
    const context = await getAuthenticatedContext();

    if (!context) {
      return configurationOperationError(
        "Sua sessão ou perfil ativo não está disponível. Entre novamente para continuar.",
      );
    }

    const { data: configuration, error: configurationError } =
      await context.supabase
        .from("commercial_configurations")
        .select("id, servo_id, installation_kit_id, is_active")
        .eq("id", configurationId)
        .maybeSingle();

    if (configurationError || !configuration) {
      return configurationOperationError(
        "Esta Caixa completa não está mais disponível. Atualize a página.",
      );
    }

    const { data: components, error: componentsError } = await context.supabase
      .from("items")
      .select("id, item_type, is_active")
      .in("id", [configuration.servo_id, configuration.installation_kit_id]);

    if (componentsError) {
      return configurationOperationError(
        "Não foi possível validar os componentes desta Caixa completa. Atualize a página.",
      );
    }

    const servo = components?.find(
      (component) => component.id === configuration.servo_id,
    );
    const installationKit = components?.find(
      (component) => component.id === configuration.installation_kit_id,
    );

    if (
      servo?.item_type !== "SERVO" ||
      installationKit?.item_type !== "INSTALLATION_KIT"
    ) {
      return configurationOperationError(
        "Os componentes desta Caixa completa não estão disponíveis. Atualize a página.",
      );
    }

    if (
      operationType === "ASSEMBLY" &&
      (!configuration.is_active ||
        !servo.is_active ||
        !installationKit.is_active)
    ) {
      return configurationOperationError(
        "Esta caixa ou um dos componentes está inativo e não pode ser montado.",
      );
    }

    if (commercialCode) {
      const { data: alias, error: aliasError } = await context.supabase
        .from("commercial_configuration_codes")
        .select("id")
        .eq("configuration_id", configurationId)
        .eq("code", commercialCode)
        .maybeSingle();

      if (aliasError || !alias) {
        return configurationOperationError(
          "O código comercial não pertence mais a esta Caixa completa. Atualize a página.",
        );
      }
    }

    const rpcName =
      operationType === "ASSEMBLY"
        ? "assemble_commercial_configuration"
        : "disassemble_commercial_configuration";
    const { data, error } = await context.supabase.rpc(rpcName, {
      p_configuration_id: configurationId,
      p_quantity: quantity,
      p_idempotency_key: idempotencyKey,
      p_commercial_code: commercialCode,
      p_description: description,
    });

    if (error) {
      return configurationOperationError(
        mapConfigurationOperationRpcError(
          operationType,
          error.code,
          error.message,
        ),
      );
    }

    const receipt = parseConfigurationOperationReceipt(data, {
      operationType,
      configurationId,
      commercialCode,
      quantity,
      servoId: configuration.servo_id,
      installationKitId: configuration.installation_kit_id,
    });

    if (!receipt) {
      return configurationOperationError(
        "A operação foi processada, mas o comprovante não pôde ser carregado. Tente novamente sem alterar os dados.",
      );
    }

    revalidatePath("/");
    revalidatePath("/estoque");
    revalidatePath("/entrada");
    revalidatePath("/saida");
    revalidatePath("/historico");

    return { ok: true, receipt };
  } catch {
    return configurationOperationError(
      "Não foi possível confirmar a operação agora. Tente novamente sem alterar os dados.",
    );
  }
}

export async function assembleCommercialConfiguration(
  input: unknown,
): Promise<ConfigurationOperationActionResult> {
  return performConfigurationOperation("ASSEMBLY", input);
}

export async function disassembleCommercialConfiguration(
  input: unknown,
): Promise<ConfigurationOperationActionResult> {
  return performConfigurationOperation("DISASSEMBLY", input);
}
