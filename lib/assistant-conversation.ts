import type {
  AssistantChatSuccess,
  AssistantConversationContext,
  AssistantConversationTopic,
  AssistantRecentConversationMessage,
  AssistantStatisticsIntent,
  AssistantSuggestedFollowUp,
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
  "STATISTICS",
]);
const suggestedFollowUps = new Set<AssistantSuggestedFollowUp>([
  "SHOW_SERVO_MODEL_KIT_SPLIT",
  "SHOW_SERVO_MODEL_MOUNTED",
  "SHOW_SERVO_MODEL_CONFIGURATIONS",
  "SHOW_STATISTICS_RANKING",
  "SHOW_STATISTICS_CATEGORIES",
  "SHOW_STATISTICS_TOP_CONFIGURATION",
]);
const statisticsPeriods = new Set([7, 30, 90]);
const statisticsIntents = new Set<AssistantStatisticsIntent>([
  "SUMMARY", "INBOUND_TOTAL", "OUTBOUND_TOTAL", "OUTBOUND_COMPARISON",
  "INBOUND_COMPARISON", "SERVO_KIT_SPLIT", "OUTBOUND_BY_CATEGORY",
  "TOP_CONFIGURATION", "TOP_LOOSE_SERVO", "TOP_LOOSE_KIT",
  "TOP_REPAIR_KIT", "TOP_LOOSE_PART", "TOP_KIT_USED_IN_ASSEMBLY",
  "CONFIGURATION_RANKING", "LOOSE_SERVO_RANKING", "CODE_OUTBOUND",
  "WITHOUT_MOVEMENT",
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
    itemReferenceKind: null,
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: null,
    suggestedFollowUp: null,
    statisticsPeriod: null,
    statisticsIntent: null,
    statisticsCode: null,
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
      "itemReferenceKind",
      "supplierOrderId",
      "supplierOrderCatalogCode",
      "lastIntent",
      "suggestedFollowUp",
      "statisticsPeriod",
      "statisticsIntent",
      "statisticsCode",
    ]) ||
    typeof value.topic !== "string" ||
    !topics.has(value.topic as AssistantConversationTopic)
  ) {
    return null;
  }

  const itemQuery = parseNullableText(value.itemQuery, 120);
  const itemReferenceKind =
    value.itemReferenceKind === null ||
    value.itemReferenceKind === "SERVO_MODEL" ||
    value.itemReferenceKind === "CATALOG_CODE"
      ? value.itemReferenceKind
      : undefined;
  const supplierOrderId = parseNullableText(value.supplierOrderId, 36);
  const supplierOrderCatalogCode = parseNullableText(
    value.supplierOrderCatalogCode,
    120,
  );
  const lastIntent = parseNullableText(value.lastIntent, 120);
  const suggestedFollowUp =
    value.suggestedFollowUp === undefined || value.suggestedFollowUp === null
      ? null
      : typeof value.suggestedFollowUp === "string" &&
          suggestedFollowUps.has(
            value.suggestedFollowUp as AssistantSuggestedFollowUp,
          )
        ? (value.suggestedFollowUp as AssistantSuggestedFollowUp)
        : undefined;
  const statisticsPeriod = value.statisticsPeriod === null
    ? null
    : typeof value.statisticsPeriod === "number" && statisticsPeriods.has(value.statisticsPeriod)
      ? value.statisticsPeriod as 7 | 30 | 90
      : undefined;
  const statisticsIntent = value.statisticsIntent === null
    ? null
    : typeof value.statisticsIntent === "string" && statisticsIntents.has(value.statisticsIntent as AssistantStatisticsIntent)
      ? value.statisticsIntent as AssistantStatisticsIntent
      : undefined;
  const statisticsCode = parseNullableText(value.statisticsCode, 120);

  if (
    itemQuery === undefined ||
    itemReferenceKind === undefined ||
    supplierOrderId === undefined ||
    supplierOrderCatalogCode === undefined ||
    lastIntent === undefined ||
    suggestedFollowUp === undefined ||
    statisticsPeriod === undefined ||
    statisticsIntent === undefined ||
    statisticsCode === undefined ||
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

  const itemReferenceMismatch =
    (itemQuery === null) !== (itemReferenceKind === null) ||
    (value.topic !== "INVENTORY" && itemReferenceKind !== null);
  const suggestedFollowUpMismatch =
    suggestedFollowUp !== null && (
      suggestedFollowUp.startsWith("SHOW_STATISTICS_")
        ? value.topic !== "STATISTICS"
        : value.topic !== "INVENTORY" || itemQuery === null || itemReferenceKind !== "SERVO_MODEL"
    );
  const statisticsMismatch =
    value.topic === "STATISTICS"
      ? statisticsIntent === null ||
        itemQuery !== null ||
        supplierOrderId !== null ||
        supplierOrderCatalogCode !== null ||
        (statisticsCode !== null) !== (statisticsIntent === "CODE_OUTBOUND") ||
        (suggestedFollowUp === "SHOW_STATISTICS_RANKING" && statisticsIntent !== "TOP_CONFIGURATION") ||
        (suggestedFollowUp === "SHOW_STATISTICS_CATEGORIES" && statisticsIntent !== "SUMMARY") ||
        (suggestedFollowUp === "SHOW_STATISTICS_TOP_CONFIGURATION" && statisticsIntent !== "SERVO_KIT_SPLIT")
      : statisticsPeriod !== null || statisticsIntent !== null || statisticsCode !== null;

  if (
    hasInventoryAndOrderContext ||
    topicMismatch ||
    itemReferenceMismatch ||
    suggestedFollowUpMismatch ||
    statisticsMismatch
  ) {
    return null;
  }

  return {
    topic: value.topic as AssistantConversationTopic,
    itemQuery,
    itemReferenceKind,
    supplierOrderId,
    supplierOrderCatalogCode:
      supplierOrderCatalogCode?.toLocaleUpperCase("pt-BR") ?? null,
    lastIntent,
    suggestedFollowUp,
    statisticsPeriod,
    statisticsIntent,
    statisticsCode: statisticsCode?.toLocaleUpperCase("pt-BR") ?? null,
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
  if (block.kind === "assistant_statistics") return "STATISTICS" as const;
  return null;
}

function getSupplierOrderPendingSuggestion(
  block: Extract<
    AssistantStructuredBlock,
    { kind: "supplier_order_list" | "supplier_order_detail" }
  >,
) {
  const quantities =
    block.kind === "supplier_order_list"
      ? block.catalogCode
        ? block.catalogLines
        : block.orders
      : block.catalogCode
        ? block.items
        : [block.order];
  const totals = quantities.reduce(
    (current, row) => ({
      waitingPickupQuantity:
        current.waitingPickupQuantity + row.waitingPickupQuantity,
      waitingStockQuantity:
        current.waitingStockQuantity + row.waitingStockQuantity,
    }),
    { waitingPickupQuantity: 0, waitingStockQuantity: 0 },
  );
  const hasPickup = totals.waitingPickupQuantity > 0;
  const hasStockEntry = totals.waitingStockQuantity > 0;

  if (hasPickup && hasStockEntry) {
    return "Ainda há itens para retirar e itens aguardando entrada no estoque.";
  }
  if (hasPickup) {
    return "Ainda há itens para retirar. Posso detalhar quais são.";
  }
  if (hasStockEntry) {
    return "Há itens aguardando entrada no estoque. Posso detalhar quais são.";
  }
  return null;
}

export function deriveAssistantConversationContext(
  previous: AssistantConversationContext,
  answer: AssistantChatSuccess,
): AssistantConversationContext {
  const hasItem = Object.prototype.hasOwnProperty.call(answer, "contextItemQuery");
  const hasItemReferenceKind = Object.prototype.hasOwnProperty.call(
    answer,
    "contextItemReferenceKind",
  );
  const hasOrder = Object.prototype.hasOwnProperty.call(answer, "contextSupplierOrderId");
  const hasOrderCode = Object.prototype.hasOwnProperty.call(
    answer,
    "contextSupplierOrderCatalogCode",
  );
  const blockTopic = topicForBlock(answer.structuredBlock);
  const hasStatisticsPeriod = Object.prototype.hasOwnProperty.call(answer, "contextStatisticsPeriod");
  const hasStatisticsIntent = Object.prototype.hasOwnProperty.call(answer, "contextStatisticsIntent");
  const hasStatisticsCode = Object.prototype.hasOwnProperty.call(answer, "contextStatisticsCode");
  const itemQuery = hasItem ? (answer.contextItemQuery ?? null) : previous.itemQuery;
  const itemReferenceKind = hasItemReferenceKind
    ? (answer.contextItemReferenceKind ?? null)
    : hasItem
      ? null
      : previous.itemReferenceKind;
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
      : blockTopic === "STATISTICS" || hasStatisticsIntent
        ? "STATISTICS"
        : blockTopic ?? (hasItem || hasOrder ? "GENERAL" : previous.topic);
  const statisticsPeriod = hasStatisticsPeriod
    ? (answer.contextStatisticsPeriod ?? null)
    : previous.statisticsPeriod;
  const statisticsIntent = hasStatisticsIntent
    ? (answer.contextStatisticsIntent ?? null)
    : previous.statisticsIntent;
  const statisticsCode = hasStatisticsCode
    ? (answer.contextStatisticsCode ?? null)
    : previous.statisticsCode;

  return {
    topic,
    itemQuery: topic === "INVENTORY" ? itemQuery : null,
    itemReferenceKind:
      topic === "INVENTORY" ? itemReferenceKind : null,
    supplierOrderId: topic === "SUPPLIER_ORDER" ? supplierOrderId : null,
    supplierOrderCatalogCode:
      topic === "SUPPLIER_ORDER" ? supplierOrderCatalogCode : null,
    lastIntent:
      answer.contextLastIntent ??
      answer.structuredBlock?.kind ??
      (topic === "INVENTORY"
        ? "inventory_item_query"
        : topic === "SUPPLIER_ORDER"
          ? "supplier_order_query"
          : "general_conversation"),
    suggestedFollowUp:
      (topic === "INVENTORY" && itemReferenceKind === "SERVO_MODEL") || topic === "STATISTICS"
        ? (answer.contextSuggestedFollowUp ?? null)
        : null,
    statisticsPeriod: topic === "STATISTICS" ? statisticsPeriod : null,
    statisticsIntent: topic === "STATISTICS" ? statisticsIntent : null,
    statisticsCode: topic === "STATISTICS" ? statisticsCode : null,
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
    if (block.scope === "MOUNTED_CONFIGURATIONS") {
      const singular = block.mountedQuantity === 1;

      return {
        ...answer,
        leadText: singular
          ? `Esse 1 ${block.model.official} montado com kit está nesta configuração:`
          : `Esses ${block.mountedQuantity} ${block.model.official} montados com kit estão distribuídos nestas configurações:`,
        followUpText: null,
      };
    }

    return {
      ...answer,
      leadText: "Separei o estoque físico desse modelo.",
      followUpText: null,
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
      followUpText: getSupplierOrderPendingSuggestion(block),
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
