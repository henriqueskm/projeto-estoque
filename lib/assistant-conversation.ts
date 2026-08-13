import type {
  AssistantChatSuccess,
  AssistantConversationContext,
  AssistantConversationTopic,
  AssistantRecentConversationMessage,
  AssistantStructuredBlock,
} from "@/lib/assistant-types";

export const assistantRecentConversationMessageLimit = 6;
export const assistantRecentConversationCharacterLimit = 6_000;
export const assistantRecentConversationMessageCharacterLimit = 2_000;
export const assistantConversationalTextLimit = 600;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidInTextPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const tokenLikePattern = /(?:eyJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{80,})/;
const catalogCodePattern = /^(?=.*\d)[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/;
const topics = new Set<AssistantConversationTopic>([
  "GENERAL",
  "INVENTORY",
  "SUPPLIER_ORDER",
  "CATALOG",
  "REPLENISHMENT",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseNullableText(value: unknown, maximum: number) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maximum ? text : undefined;
}

export function parseAssistantRecentConversation(
  value: unknown,
): AssistantRecentConversationMessage[] | null {
  if (!Array.isArray(value) || value.length > assistantRecentConversationMessageLimit) {
    return null;
  }

  let totalCharacters = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  const parsed: AssistantRecentConversationMessage[] = [];

  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["role", "content"]) ||
      (entry.role !== "user" && entry.role !== "assistant") ||
      typeof entry.content !== "string"
    ) {
      return null;
    }

    const content = entry.content.trim();
    totalCharacters += content.length;
    userMessages += entry.role === "user" ? 1 : 0;
    assistantMessages += entry.role === "assistant" ? 1 : 0;

    if (
      !content ||
      content.length > assistantRecentConversationMessageCharacterLimit ||
      totalCharacters > assistantRecentConversationCharacterLimit ||
      userMessages > 3 ||
      assistantMessages > 3 ||
      parsed.at(-1)?.role === entry.role ||
      uuidInTextPattern.test(content) ||
      tokenLikePattern.test(content)
    ) {
      return null;
    }

    parsed.push({ role: entry.role, content });
  }

  return parsed;
}

export function buildAssistantRecentConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const recent: AssistantRecentConversationMessage[] = [];
  let totalCharacters = 0;
  const roleCounts = { user: 0, assistant: 0 };

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (recent.length >= assistantRecentConversationMessageLimit) break;

    const message = messages[index];
    const content = message.content.trim();

    if (
      !content ||
      roleCounts[message.role] >= 3 ||
      recent[0]?.role === message.role ||
      uuidInTextPattern.test(content) ||
      tokenLikePattern.test(content)
    ) {
      continue;
    }

    const safeContent = content.slice(0, assistantRecentConversationMessageCharacterLimit);
    if (totalCharacters + safeContent.length > assistantRecentConversationCharacterLimit) {
      continue;
    }

    recent.unshift({ role: message.role, content: safeContent });
    roleCounts[message.role] += 1;
    totalCharacters += safeContent.length;
  }

  return recent;
}

export function emptyAssistantConversationContext(): AssistantConversationContext {
  return {
    topic: "GENERAL",
    itemQuery: null,
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: null,
  };
}

export function parseAssistantConversationContext(
  value: unknown,
): AssistantConversationContext | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "topic",
      "itemQuery",
      "supplierOrderId",
      "supplierOrderCatalogCode",
      "lastIntent",
    ]) ||
    typeof value.topic !== "string" ||
    !topics.has(value.topic as AssistantConversationTopic)
  ) {
    return null;
  }

  const itemQuery = parseNullableText(value.itemQuery, 120);
  const supplierOrderId = parseNullableText(value.supplierOrderId, 36);
  const supplierOrderCatalogCode = parseNullableText(
    value.supplierOrderCatalogCode,
    120,
  );
  const lastIntent = parseNullableText(value.lastIntent, 120);

  if (
    itemQuery === undefined ||
    supplierOrderId === undefined ||
    supplierOrderCatalogCode === undefined ||
    lastIntent === undefined ||
    (supplierOrderId !== null && !uuidPattern.test(supplierOrderId)) ||
    (supplierOrderCatalogCode !== null &&
      !catalogCodePattern.test(
        supplierOrderCatalogCode.toLocaleUpperCase("pt-BR"),
      ))
  ) {
    return null;
  }

  const hasInventoryAndOrderContext =
    itemQuery !== null &&
    (supplierOrderId !== null || supplierOrderCatalogCode !== null);
  const topicMismatch =
    (value.topic === "INVENTORY" &&
      (supplierOrderId !== null || supplierOrderCatalogCode !== null)) ||
    (value.topic === "SUPPLIER_ORDER" && itemQuery !== null) ||
    ((value.topic === "GENERAL" ||
      value.topic === "CATALOG" ||
      value.topic === "REPLENISHMENT") &&
      (itemQuery !== null ||
        supplierOrderId !== null ||
        supplierOrderCatalogCode !== null));

  if (hasInventoryAndOrderContext || topicMismatch) return null;

  return {
    topic: value.topic as AssistantConversationTopic,
    itemQuery,
    supplierOrderId,
    supplierOrderCatalogCode:
      supplierOrderCatalogCode?.toLocaleUpperCase("pt-BR") ?? null,
    lastIntent,
  };
}

export function parseAssistantConversationalText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const text = value.trim();

  if (
    !text ||
    text.length > assistantConversationalTextLimit ||
    uuidInTextPattern.test(text) ||
    tokenLikePattern.test(text)
  ) {
    return null;
  }

  return text;
}

function topicForBlock(block: AssistantStructuredBlock | undefined) {
  if (!block) return null;
  if (block.kind.startsWith("supplier_order")) return "SUPPLIER_ORDER" as const;
  if (
    block.kind === "inventory_item_summary" ||
    block.kind === "servo_model_inventory_breakdown" ||
    block.kind === "catalog_media"
  ) {
    return "INVENTORY" as const;
  }
  if (
    block.kind === "inventory_alerts" ||
    block.kind === "purchase_recommendation_list"
  ) {
    return "REPLENISHMENT" as const;
  }
  return null;
}

export function deriveAssistantConversationContext(
  previous: AssistantConversationContext,
  answer: AssistantChatSuccess,
): AssistantConversationContext {
  const hasItem = Object.prototype.hasOwnProperty.call(answer, "contextItemQuery");
  const hasOrder = Object.prototype.hasOwnProperty.call(answer, "contextSupplierOrderId");
  const hasOrderCode = Object.prototype.hasOwnProperty.call(
    answer,
    "contextSupplierOrderCatalogCode",
  );
  const blockTopic = topicForBlock(answer.structuredBlock);
  const itemQuery = hasItem ? (answer.contextItemQuery ?? null) : previous.itemQuery;
  const supplierOrderId = hasOrder
    ? (answer.contextSupplierOrderId ?? null)
    : previous.supplierOrderId;
  const supplierOrderCatalogCode = hasOrderCode
    ? (answer.contextSupplierOrderCatalogCode ?? null)
    : previous.supplierOrderCatalogCode;
  const topic: AssistantConversationTopic = hasOrder && supplierOrderId
    ? "SUPPLIER_ORDER"
    : hasItem && itemQuery
      ? "INVENTORY"
      : blockTopic ?? (hasItem || hasOrder ? "GENERAL" : previous.topic);

  return {
    topic,
    itemQuery: topic === "INVENTORY" ? itemQuery : null,
    supplierOrderId: topic === "SUPPLIER_ORDER" ? supplierOrderId : null,
    supplierOrderCatalogCode:
      topic === "SUPPLIER_ORDER" ? supplierOrderCatalogCode : null,
    lastIntent:
      answer.structuredBlock?.kind ??
      (topic === "INVENTORY"
        ? "inventory_item_query"
        : topic === "SUPPLIER_ORDER"
          ? "supplier_order_query"
          : "general_conversation"),
  };
}

export function addAssistantConversationalCopy(
  answer: AssistantChatSuccess,
): AssistantChatSuccess {
  const block = answer.structuredBlock;
  if (!block) return answer;

  if (block.kind === "inventory_item_summary") {
    return {
      ...answer,
      leadText: "Aqui está a situação atual desse item.",
      followUpText:
        block.metric === "COMPOSITION"
          ? null
          : "Se quiser, posso mostrar a composição ou o estoque mínimo dele.",
    };
  }

  if (block.kind === "servo_model_inventory_breakdown") {
    return {
      ...answer,
      leadText: "Separei o estoque físico desse modelo.",
      followUpText: "Se quiser, posso detalhar uma dessas configurações.",
    };
  }

  if (block.kind === "inventory_alerts") {
    return {
      ...answer,
      leadText:
        block.summary.zeroCount > 0
          ? "Encontrei itens que merecem atenção. Os zerados são os mais urgentes."
          : "Encontrei itens abaixo do estoque mínimo.",
      followUpText:
        "Se quiser, posso verificar um deles com mais detalhes.",
    };
  }

  if (block.kind === "supplier_order_list" || block.kind === "supplier_order_detail") {
    return {
      ...answer,
      leadText: "Encontrei os dados atuais do Pedido.",
      followUpText: "Posso mostrar a retirada ou a entrada que ainda está pendente.",
    };
  }

  if (block.kind.endsWith("_preview")) {
    return {
      ...answer,
      leadText: "Preparei a prévia com os dados atuais. Revise antes de confirmar.",
      followUpText: null,
    };
  }

  return answer;
}
