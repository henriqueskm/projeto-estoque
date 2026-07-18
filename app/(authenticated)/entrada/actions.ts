"use server";

import { revalidatePath } from "next/cache";
import {
  physicalItemTypes,
  type InboundActionResult,
  type InboundReceipt,
  type InboundRequestLine,
  type PhysicalItemType,
} from "@/lib/inbound-types";
import { createClient } from "@/lib/supabase/server";

const maximumQuantity = 2_147_483_647;
const maximumDescriptionLength = 500;
const maximumRawLines = 500;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NormalizedInboundRequest = {
  lines: InboundRequestLine[];
  idempotencyKey: string;
  description: string | null;
};

type ActiveCommercialCodeRow = {
  id: string;
  configuration_id: string;
};

type ActiveConfigurationRow = {
  id: string;
  servo_id: string;
  installation_kit_id: string;
};

type ActiveComponentRow = {
  id: string;
  item_type: PhysicalItemType;
};

type RpcReceipt = {
  movement_batch_id?: unknown;
  lines_processed?: unknown;
  total_quantity?: unknown;
  commercial_quantity?: unknown;
};

function invalidRequest(error: string): InboundActionResult {
  return { ok: false, error };
}

function normalizeRequest(
  input: unknown,
): NormalizedInboundRequest | InboundActionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalidRequest("Os dados da entrada são inválidos.");
  }

  const request = input as Record<string, unknown>;
  const allowedFields = new Set([
    "p_lines",
    "p_idempotency_key",
    "p_description",
  ]);

  if (Object.keys(request).some((field) => !allowedFields.has(field))) {
    return invalidRequest("Os dados da entrada são inválidos.");
  }

  if (
    typeof request.p_idempotency_key !== "string" ||
    !uuidPattern.test(request.p_idempotency_key)
  ) {
    return invalidRequest("Não foi possível identificar esta tentativa.");
  }

  if (!Array.isArray(request.p_lines) || request.p_lines.length === 0) {
    return invalidRequest(
      "Adicione pelo menos um item ou código comercial à entrada.",
    );
  }

  if (request.p_lines.length > maximumRawLines) {
    return invalidRequest(
      "A entrada possui linhas demais para uma única operação.",
    );
  }

  const linesByKey = new Map<string, InboundRequestLine>();

  for (const rawLine of request.p_lines) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      return invalidRequest("Revise as linhas e as quantidades informadas.");
    }

    const line = rawLine as Record<string, unknown>;

    if (line.kind !== "ITEM" && line.kind !== "COMMERCIAL_CODE") {
      return invalidRequest("Uma das linhas possui um tipo inválido.");
    }

    const identifierField =
      line.kind === "ITEM" ? "item_id" : "commercial_code_id";
    const allowedLineFields = new Set([
      "kind",
      identifierField,
      "quantity",
    ]);

    if (
      Object.keys(line).some((field) => !allowedLineFields.has(field)) ||
      typeof line[identifierField] !== "string" ||
      !uuidPattern.test(line[identifierField])
    ) {
      return invalidRequest(
        "Revise os itens e códigos comerciais informados.",
      );
    }

    if (
      typeof line.quantity !== "number" ||
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0 ||
      line.quantity > maximumQuantity
    ) {
      return invalidRequest("Use somente quantidades inteiras e positivas.");
    }

    const identifier = line[identifierField].toLowerCase();
    const key = `${line.kind}:${identifier}`;
    const currentQuantity = linesByKey.get(key)?.quantity ?? 0;
    const consolidatedQuantity = currentQuantity + line.quantity;

    if (consolidatedQuantity > maximumQuantity) {
      return invalidRequest("Uma das quantidades excede o limite permitido.");
    }

    linesByKey.set(
      key,
      line.kind === "ITEM"
        ? {
            kind: "ITEM",
            item_id: identifier,
            quantity: consolidatedQuantity,
          }
        : {
            kind: "COMMERCIAL_CODE",
            commercial_code_id: identifier,
            quantity: consolidatedQuantity,
          },
    );
  }

  let description: string | null = null;

  if (
    request.p_description !== undefined &&
    request.p_description !== null
  ) {
    if (typeof request.p_description !== "string") {
      return invalidRequest("A descrição informada é inválida.");
    }

    const normalizedDescription = request.p_description.trim();

    if (normalizedDescription.length > maximumDescriptionLength) {
      return invalidRequest(
        `A descrição deve ter no máximo ${maximumDescriptionLength} caracteres.`,
      );
    }

    description = normalizedDescription || null;
  }

  return {
    lines: Array.from(linesByKey.values()).sort((first, second) => {
      if (first.kind !== second.kind) {
        return first.kind < second.kind ? -1 : 1;
      }

      const firstId =
        first.kind === "ITEM" ? first.item_id : first.commercial_code_id;
      const secondId =
        second.kind === "ITEM"
          ? second.item_id
          : second.commercial_code_id;

      return firstId.localeCompare(secondId);
    }),
    idempotencyKey: request.p_idempotency_key.toLowerCase(),
    description,
  };
}

function parseReceipt(data: unknown): InboundReceipt | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const receipt = data as RpcReceipt;

  if (
    typeof receipt.movement_batch_id !== "string" ||
    !uuidPattern.test(receipt.movement_batch_id) ||
    typeof receipt.lines_processed !== "number" ||
    !Number.isSafeInteger(receipt.lines_processed) ||
    receipt.lines_processed <= 0 ||
    typeof receipt.total_quantity !== "number" ||
    !Number.isSafeInteger(receipt.total_quantity) ||
    receipt.total_quantity <= 0 ||
    typeof receipt.commercial_quantity !== "number" ||
    !Number.isSafeInteger(receipt.commercial_quantity) ||
    receipt.commercial_quantity < 0 ||
    receipt.commercial_quantity > receipt.total_quantity
  ) {
    return null;
  }

  return {
    movementBatchId: receipt.movement_batch_id,
    linesProcessed: receipt.lines_processed,
    totalQuantity: receipt.total_quantity,
    commercialQuantity: receipt.commercial_quantity,
  };
}

function mapRpcError(code: string | undefined, message: string) {
  const normalizedMessage = message.toLocaleLowerCase("en-US");

  if (code === "42501" || code === "28000") {
    return "Sua sessão não está disponível. Entre novamente para continuar.";
  }

  if (
    code === "23505" ||
    normalizedMessage.includes("idempotency_key has already been used")
  ) {
    return "Esta tentativa já foi usada com uma entrada diferente. Volte, revise os dados e tente novamente.";
  }

  if (
    normalizedMessage.includes("inactive") ||
    normalizedMessage.includes("does not exist")
  ) {
    return "Um item ou código comercial não está mais disponível. Atualize a página e revise a entrada.";
  }

  if (code === "22003") {
    return "Uma das quantidades excede o limite permitido.";
  }

  if (code === "23514" || code === "22023") {
    return "Os dados da entrada mudaram ou não são mais válidos. Atualize a página e revise a operação.";
  }

  return "Não foi possível registrar a entrada. Revise os dados e tente novamente.";
}

export async function submitStockInbound(
  input: unknown,
): Promise<InboundActionResult> {
  const normalized = normalizeRequest(input);

  if ("ok" in normalized) {
    return normalized;
  }

  try {
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;

    if (claimsError || !userId) {
      return invalidRequest(
        "Sua sessão não está disponível. Entre novamente para continuar.",
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (profileError || !profile) {
      return invalidRequest(
        "Seu perfil não está ativo para realizar esta operação.",
      );
    }

    const itemIds = normalized.lines.flatMap((line) =>
      line.kind === "ITEM" ? [line.item_id] : [],
    );
    const commercialCodeIds = normalized.lines.flatMap((line) =>
      line.kind === "COMMERCIAL_CODE" ? [line.commercial_code_id] : [],
    );

    if (itemIds.length > 0) {
      const { data: activeItems, error: itemsError } = await supabase
        .from("items")
        .select("id")
        .in("id", itemIds)
        .eq("is_active", true)
        .in("item_type", [...physicalItemTypes]);

      if (
        itemsError ||
        !activeItems ||
        activeItems.length !== itemIds.length
      ) {
        return invalidRequest(
          "Um ou mais itens físicos não estão disponíveis para entrada.",
        );
      }
    }

    let activeCommercialCodes: ActiveCommercialCodeRow[] = [];

    if (commercialCodeIds.length > 0) {
      const { data, error } = await supabase
        .from("commercial_configuration_codes")
        .select("id, configuration_id")
        .in("id", commercialCodeIds)
        .eq("is_active", true);

      if (!data || error || data.length !== commercialCodeIds.length) {
        return invalidRequest(
          "Um ou mais códigos comerciais não estão disponíveis para entrada.",
        );
      }

      activeCommercialCodes = data as ActiveCommercialCodeRow[];
    }

    const configurationIds = Array.from(
      new Set(activeCommercialCodes.map((code) => code.configuration_id)),
    );
    let activeConfigurations: ActiveConfigurationRow[] = [];

    if (configurationIds.length > 0) {
      const { data, error } = await supabase
        .from("commercial_configurations")
        .select("id, servo_id, installation_kit_id")
        .in("id", configurationIds)
        .eq("is_active", true);

      if (!data || error || data.length !== configurationIds.length) {
        return invalidRequest(
          "Uma das configurações comerciais não está mais disponível.",
        );
      }

      activeConfigurations = data as ActiveConfigurationRow[];
    }

    const configurationByCodeId = new Map(
      activeCommercialCodes.map((code) => [code.id, code.configuration_id]),
    );
    const quantitiesByConfiguration = new Map<string, number>();

    for (const line of normalized.lines) {
      if (line.kind !== "COMMERCIAL_CODE") {
        continue;
      }

      const configurationId = configurationByCodeId.get(
        line.commercial_code_id,
      );

      if (!configurationId) {
        return invalidRequest(
          "Um dos códigos comerciais não possui uma configuração disponível.",
        );
      }

      const total =
        (quantitiesByConfiguration.get(configurationId) ?? 0) +
        line.quantity;

      if (total > maximumQuantity) {
        return invalidRequest(
          "A quantidade total de uma configuração excede o limite permitido.",
        );
      }

      quantitiesByConfiguration.set(configurationId, total);
    }

    const componentIds = Array.from(
      new Set(
        activeConfigurations.flatMap((configuration) => [
          configuration.servo_id,
          configuration.installation_kit_id,
        ]),
      ),
    );

    if (componentIds.length > 0) {
      const { data, error } = await supabase
        .from("items")
        .select("id, item_type")
        .in("id", componentIds)
        .eq("is_active", true)
        .in("item_type", ["SERVO", "INSTALLATION_KIT"]);
      const components = (data ?? []) as ActiveComponentRow[];
      const componentTypeById = new Map(
        components.map((component) => [
          component.id,
          component.item_type,
        ]),
      );
      const componentsAreValid =
        !error &&
        components.length === componentIds.length &&
        activeConfigurations.every(
          (configuration) =>
            componentTypeById.get(configuration.servo_id) === "SERVO" &&
            componentTypeById.get(configuration.installation_kit_id) ===
              "INSTALLATION_KIT",
        );

      if (!componentsAreValid) {
        return invalidRequest(
          "Os componentes de uma configuração não estão disponíveis para entrada.",
        );
      }
    }

    const { data, error } = await supabase.rpc("stock_inbound_lines", {
      p_lines: normalized.lines,
      p_idempotency_key: normalized.idempotencyKey,
      p_description: normalized.description,
    });

    if (error) {
      return invalidRequest(mapRpcError(error.code, error.message));
    }

    const receipt = parseReceipt(data);

    if (!receipt) {
      return invalidRequest(
        "A entrada foi processada, mas o comprovante não pôde ser carregado. Não altere os dados; tente confirmar novamente para recuperar o mesmo lote.",
      );
    }

    revalidatePath("/");
    revalidatePath("/entrada");
    revalidatePath("/estoque");
    revalidatePath("/saida");

    return { ok: true, receipt };
  } catch {
    return invalidRequest(
      "Não foi possível concluir a entrada agora. Tente novamente.",
    );
  }
}
