import {
  assistantMessageMaxLength,
  assistantQueryMaxLength,
  parseAssistantStructuredBlock,
  type AssistantStructuredBlock,
} from "@/lib/assistant-types";
import { expireStockEntryPreview, expireSupplierOrderPickupPreview } from "@/lib/ai/assistant-action-persistence";

export const assistantSessionVersion = 1;
export const assistantSessionStoragePrefix =
  "negocios-k:assistant-session";
export const assistantSessionMessageLimit = 50;
export const assistantSessionSizeLimit = 240_000;

const messageContentLimit = 12_000;
const mediaReferenceLimit = 20;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const catalogCodePattern =
  /^(?=.*\d)[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/;

export type AssistantMediaReference = {
  code: string;
  targetKind?: "item" | "commercial_configuration";
  targetId?: string;
};

export type AssistantConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  structuredBlock?: AssistantStructuredBlock;
  restoredMediaReferences?: AssistantMediaReference[];
};

export type AssistantSessionState = {
  conversationId: string;
  messages: AssistantConversationMessage[];
  draft: string;
  lastItemQuery: string | null;
  lastSupplierOrderId: string | null;
  lastSupplierOrderCatalogCode: string | null;
  scrollTop: number;
};

type PersistedAssistantSession = AssistantSessionState & {
  version: typeof assistantSessionVersion;
  updatedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMediaReference(
  value: AssistantMediaReference,
): AssistantMediaReference | null {
  const code = value.code
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR");

  if (
    !code ||
    code.length > assistantQueryMaxLength ||
    !catalogCodePattern.test(code)
  ) {
    return null;
  }

  if (
    value.targetKind !== undefined &&
    value.targetKind !== "item" &&
    value.targetKind !== "commercial_configuration"
  ) {
    return null;
  }

  if (
    value.targetId !== undefined &&
    !uuidPattern.test(value.targetId)
  ) {
    return null;
  }

  if (
    (value.targetKind === undefined) !==
    (value.targetId === undefined)
  ) {
    return null;
  }

  return {
    code,
    ...(value.targetKind && value.targetId
      ? {
          targetKind: value.targetKind,
          targetId: value.targetId,
        }
      : {}),
  };
}

function deduplicateMediaReferences(
  references: AssistantMediaReference[],
) {
  const unique = new Map<string, AssistantMediaReference>();

  references.forEach((reference) => {
    const normalized = normalizeMediaReference(reference);

    if (!normalized) {
      return;
    }

    const key = [
      normalized.code,
      normalized.targetKind ?? "",
      normalized.targetId ?? "",
    ].join(":");

    if (!unique.has(key) && unique.size < mediaReferenceLimit) {
      unique.set(key, normalized);
    }
  });

  return Array.from(unique.values());
}

function sanitizeStructuredBlock(
  block: AssistantStructuredBlock,
): {
  block: AssistantStructuredBlock;
  mediaReferences: AssistantMediaReference[];
} {
  const mediaReferences: AssistantMediaReference[] = [];

  switch (block.kind) {
    case "inventory_alerts":
      return {
        block: {
          ...block,
          zeroItems: block.zeroItems.map((item) => {
            if (item.mediaDescriptor) {
              mediaReferences.push({
                code: item.displayCode,
                targetKind: item.targetKind,
                targetId: item.targetId,
              });
            }

            return { ...item, mediaDescriptor: null };
          }),
          lowItems: block.lowItems.map((item) => {
            if (item.mediaDescriptor) {
              mediaReferences.push({
                code: item.displayCode,
                targetKind: item.targetKind,
                targetId: item.targetId,
              });
            }

            return { ...item, mediaDescriptor: null };
          }),
        },
        mediaReferences: deduplicateMediaReferences(mediaReferences),
      };
    case "catalog_media":
      return {
        block: {
          ...block,
          results: block.results.map((target) => {
            if (target.mediaDescriptor) {
              mediaReferences.push({
                code: target.displayCode,
                targetKind: target.targetKind,
                targetId: target.targetId,
              });
            }

            return { ...target, mediaDescriptor: null };
          }),
        },
        mediaReferences: deduplicateMediaReferences(mediaReferences),
      };
    case "inventory_item_summary":
      return {
        block: {
          ...block,
          results: block.results.map((target) => {
            if (target.mediaDescriptor) {
              mediaReferences.push({
                code: target.displayCode,
                targetKind: target.targetKind,
                targetId: target.targetId,
              });
            }

            return { ...target, mediaDescriptor: null };
          }),
        },
        mediaReferences: deduplicateMediaReferences(mediaReferences),
      };
    case "servo_model_inventory_breakdown":
      if (block.bareServo?.mediaDescriptor) {
        mediaReferences.push({
          code: block.bareServo.displayCode,
          targetKind: block.bareServo.targetKind,
          targetId: block.bareServo.targetId,
        });
      }

      return {
        block: {
          ...block,
          bareServo: block.bareServo
            ? { ...block.bareServo, mediaDescriptor: null }
            : null,
          configurations: block.configurations.map(
            ({ target, aliases }) => {
              if (target.mediaDescriptor) {
                mediaReferences.push({
                  code: target.displayCode,
                  targetKind: target.targetKind,
                  targetId: target.targetId,
                });
              }

              return {
                aliases,
                target: { ...target, mediaDescriptor: null },
              };
            },
          ),
        },
        mediaReferences: deduplicateMediaReferences(mediaReferences),
      };
    case "supplier_order_list":
      return {
        block: {
          ...block,
          catalogLines: block.catalogLines.map((line) => {
            if (line.mediaDescriptor) {
              mediaReferences.push({ code: line.displayCode });
            }

            return { ...line, mediaDescriptor: null };
          }),
        },
        mediaReferences: deduplicateMediaReferences(mediaReferences),
      };
    case "supplier_order_detail":
      return {
        block: {
          ...block,
          items: block.items.map((item) => {
            if (item.mediaDescriptor) {
              mediaReferences.push({ code: item.displayCode });
            }

            return { ...item, mediaDescriptor: null };
          }),
        },
        mediaReferences: deduplicateMediaReferences(mediaReferences),
      };
    case "assistant_action_preview":
      return {
        block: expireSupplierOrderPickupPreview(block),
        mediaReferences: [],
      };
    case "supplier_order_stock_entry_preview":
    case "manual_stock_entry_preview":
      return { block: expireStockEntryPreview(block), mediaReferences: [] };
    case "supplier_order_stock_entry_result":
    case "manual_stock_entry_result":
      return { block, mediaReferences: [] };
    case "assistant_action_result":
      return { block, mediaReferences: [] };
    case "assistant_clarification":
      return { block, mediaReferences: [] };
    case "purchase_recommendation_list":
    case "supplier_order_aggregate":
    case "supplier_order_ambiguity":
      return { block, mediaReferences: [] };
  }
}

function parseMediaReferences(value: unknown) {
  if (!Array.isArray(value) || value.length > mediaReferenceLimit) {
    return null;
  }

  const parsed = value.map((reference) => {
    if (
      !isRecord(reference) ||
      typeof reference.code !== "string"
    ) {
      return null;
    }

    return normalizeMediaReference({
      code: reference.code,
      ...(typeof reference.targetKind === "string"
        ? {
            targetKind:
              reference.targetKind as AssistantMediaReference["targetKind"],
          }
        : {}),
      ...(typeof reference.targetId === "string"
        ? { targetId: reference.targetId }
        : {}),
    });
  });

  return parsed.every(Boolean)
    ? (parsed as AssistantMediaReference[])
    : null;
}

function parseMessage(value: unknown): AssistantConversationMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !uuidPattern.test(value.id) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    !value.content.trim() ||
    value.content.length > messageContentLimit
  ) {
    return null;
  }

  const structuredBlock =
    value.structuredBlock === undefined
      ? undefined
      : parseAssistantStructuredBlock(value.structuredBlock);
  const mediaReferences =
    value.restoredMediaReferences === undefined
      ? []
      : parseMediaReferences(value.restoredMediaReferences);

  if (
    (value.structuredBlock !== undefined && !structuredBlock) ||
    mediaReferences === null ||
    (value.role === "user" &&
      (structuredBlock !== undefined || mediaReferences.length > 0))
  ) {
    return null;
  }

  return {
    id: value.id,
    role: value.role,
    content: value.content,
    ...(structuredBlock ? { structuredBlock } : {}),
    ...(mediaReferences.length > 0
      ? { restoredMediaReferences: mediaReferences }
      : {}),
  };
}

function parseNullableQuery(
  value: unknown,
  validator?: (query: string) => boolean,
) {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const query = value.trim();

  if (
    !query ||
    query.length > assistantQueryMaxLength ||
    (validator && !validator(query))
  ) {
    return undefined;
  }

  return query;
}

export function getAssistantSessionStorageKey(userId: string) {
  return `${assistantSessionStoragePrefix}:v${assistantSessionVersion}:${userId}`;
}

export function clearAssistantSessionStorage(
  storage: Pick<Storage, "key" | "length" | "removeItem">,
  userId: string,
) {
  storage.removeItem(getAssistantSessionStorageKey(userId));

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);

    if (
      key &&
      key.startsWith(`${assistantSessionStoragePrefix}:`) &&
      key.endsWith(`:${userId}`)
    ) {
      storage.removeItem(key);
    }
  }
}

export function parseAssistantSession(
  rawValue: string,
): AssistantSessionState | null {
  if (!rawValue || rawValue.length > assistantSessionSizeLimit) {
    return null;
  }

  let value: unknown;

  try {
    value = JSON.parse(rawValue);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    value.version !== assistantSessionVersion ||
    typeof value.conversationId !== "string" ||
    !uuidPattern.test(value.conversationId) ||
    !Array.isArray(value.messages) ||
    value.messages.length > assistantSessionMessageLimit ||
    typeof value.draft !== "string" ||
    value.draft.length > assistantMessageMaxLength ||
    typeof value.scrollTop !== "number" ||
    !Number.isFinite(value.scrollTop) ||
    value.scrollTop < 0 ||
    value.scrollTop > 10_000_000
  ) {
    return null;
  }

  const messages = value.messages.map(parseMessage);
  const lastItemQuery = parseNullableQuery(value.lastItemQuery);
  const lastSupplierOrderId = parseNullableQuery(
    value.lastSupplierOrderId,
    (query) => uuidPattern.test(query),
  );
  const lastSupplierOrderCatalogCode = parseNullableQuery(
    value.lastSupplierOrderCatalogCode,
    (query) =>
      catalogCodePattern.test(
        query
          .replace(/\s+/g, " ")
          .toLocaleUpperCase("pt-BR"),
      ),
  );

  if (
    messages.some((message) => message === null) ||
    lastItemQuery === undefined ||
    lastSupplierOrderId === undefined ||
    lastSupplierOrderCatalogCode === undefined
  ) {
    return null;
  }

  return {
    conversationId: value.conversationId,
    messages: messages as AssistantConversationMessage[],
    draft: value.draft,
    lastItemQuery,
    lastSupplierOrderId,
    lastSupplierOrderCatalogCode,
    scrollTop: Math.round(value.scrollTop),
  };
}

export function serializeAssistantSession(state: AssistantSessionState) {
  const messages = state.messages
    .slice(-assistantSessionMessageLimit)
    .map((message) => {
      if (!message.structuredBlock) {
        return {
          id: message.id,
          role: message.role,
          content: message.content.slice(0, messageContentLimit),
        };
      }

      const sanitized = sanitizeStructuredBlock(message.structuredBlock);
      const restoredMediaReferences = deduplicateMediaReferences([
        ...(message.restoredMediaReferences ?? []),
        ...sanitized.mediaReferences,
      ]);

      return {
        id: message.id,
        role: message.role,
        content: message.content.slice(0, messageContentLimit),
        ...(message.structuredBlock.kind === "catalog_media"
          ? {}
          : { structuredBlock: sanitized.block }),
        ...(restoredMediaReferences.length > 0
          ? { restoredMediaReferences }
          : {}),
      };
    });
  const base: PersistedAssistantSession = {
    version: assistantSessionVersion,
    conversationId: state.conversationId,
    messages,
    draft: state.draft.slice(0, assistantMessageMaxLength),
    lastItemQuery: state.lastItemQuery,
    lastSupplierOrderId: state.lastSupplierOrderId,
    lastSupplierOrderCatalogCode:
      state.lastSupplierOrderCatalogCode,
    scrollTop: Math.max(0, Math.round(state.scrollTop)),
    updatedAt: Date.now(),
  };

  let serialized = JSON.stringify(base);

  while (
    serialized.length > assistantSessionSizeLimit &&
    base.messages.length > 0
  ) {
    base.messages.shift();
    serialized = JSON.stringify(base);
  }

  return serialized.length <= assistantSessionSizeLimit
    ? serialized
    : null;
}
