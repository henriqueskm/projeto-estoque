"use server";

import { revalidatePath } from "next/cache";
import {
  physicalItemTypes,
  type InboundActionResult,
  type InboundReceipt,
} from "@/lib/inbound-types";
import { createClient } from "@/lib/supabase/server";

const maximumQuantity = 2_147_483_647;
const maximumDescriptionLength = 500;
const maximumDistinctItems = 500;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NormalizedInboundItem = {
  item_id: string;
  quantity: number;
};

type NormalizedInboundRequest = {
  items: NormalizedInboundItem[];
  idempotencyKey: string;
  description: string | null;
};

type RpcReceipt = {
  movement_batch_id?: unknown;
  items_processed?: unknown;
  total_quantity?: unknown;
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
    "p_items",
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

  if (!Array.isArray(request.p_items) || request.p_items.length === 0) {
    return invalidRequest("Adicione pelo menos um item à entrada.");
  }

  if (request.p_items.length > maximumDistinctItems) {
    return invalidRequest("A entrada possui itens demais para uma única operação.");
  }

  const quantitiesByItem = new Map<string, number>();

  for (const rawItem of request.p_items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return invalidRequest("Revise os itens e as quantidades informadas.");
    }

    const item = rawItem as Record<string, unknown>;
    const allowedItemFields = new Set(["item_id", "quantity"]);

    if (Object.keys(item).some((field) => !allowedItemFields.has(field))) {
      return invalidRequest("Revise os itens e as quantidades informadas.");
    }

    if (
      typeof item.item_id !== "string" ||
      !uuidPattern.test(item.item_id) ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > maximumQuantity
    ) {
      return invalidRequest("Use somente quantidades inteiras e positivas.");
    }

    const consolidatedQuantity =
      (quantitiesByItem.get(item.item_id) ?? 0) + item.quantity;

    if (consolidatedQuantity > maximumQuantity) {
      return invalidRequest("Uma das quantidades excede o limite permitido.");
    }

    quantitiesByItem.set(item.item_id, consolidatedQuantity);
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
    items: Array.from(quantitiesByItem, ([item_id, quantity]) => ({
      item_id,
      quantity,
    })).sort((first, second) => first.item_id.localeCompare(second.item_id)),
    idempotencyKey: request.p_idempotency_key,
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
    typeof receipt.items_processed !== "number" ||
    !Number.isSafeInteger(receipt.items_processed) ||
    receipt.items_processed <= 0 ||
    typeof receipt.total_quantity !== "number" ||
    !Number.isSafeInteger(receipt.total_quantity) ||
    receipt.total_quantity <= 0
  ) {
    return null;
  }

  return {
    movementBatchId: receipt.movement_batch_id,
    itemsProcessed: receipt.items_processed,
    totalQuantity: receipt.total_quantity,
  };
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

    const itemIds = normalized.items.map((item) => item.item_id);
    const { data: activeItems, error: itemsError } = await supabase
      .from("items")
      .select("id")
      .in("id", itemIds)
      .eq("is_active", true)
      .in("item_type", [...physicalItemTypes]);

    if (
      itemsError ||
      !activeItems ||
      activeItems.length !== normalized.items.length
    ) {
      return invalidRequest(
        "Um ou mais itens não estão disponíveis para entrada.",
      );
    }

    const { data, error } = await supabase.rpc("stock_inbound_items", {
      p_items: normalized.items,
      p_idempotency_key: normalized.idempotencyKey,
      p_description: normalized.description,
    });

    if (error) {
      if (error.code === "23505") {
        return invalidRequest(
          "Esta tentativa já foi usada com dados diferentes. Revise a entrada e tente novamente.",
        );
      }

      if (error.code === "42501" || error.code === "28000") {
        return invalidRequest(
          "Sua sessão não está disponível. Entre novamente para continuar.",
        );
      }

      return invalidRequest(
        "Não foi possível registrar a entrada. Revise os dados e tente novamente.",
      );
    }

    const receipt = parseReceipt(data);

    if (!receipt) {
      return invalidRequest(
        "A entrada foi processada, mas o comprovante não pôde ser carregado. Atualize a página antes de tentar novamente.",
      );
    }

    revalidatePath("/");
    revalidatePath("/entrada");

    return { ok: true, receipt };
  } catch {
    return invalidRequest(
      "Não foi possível concluir a entrada agora. Tente novamente.",
    );
  }
}
