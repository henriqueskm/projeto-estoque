export type ManualStockEntryRequest = {
  quantity: number;
  targetQuery: string;
  requestedIdentity: "ITEM" | "COMMERCIAL_CODE" | null;
};

export type ManualStockEntryRoute =
  | { kind: "NOT_MANUAL_STOCK_ENTRY" }
  | { kind: "BUTTON_CONFIRMATION_TEXT" }
  | { kind: "CANCEL" }
  | { kind: "MISSING_QUANTITY"; targetQuery: string | null }
  | { kind: "INVALID"; message: string }
  | { kind: "AMBIGUOUS_FLOW"; quantity: number; targetQuery: string }
  | { kind: "ACTION"; request: ManualStockEntryRequest };

const maximumInteger = 2_147_483_647;

export function normalizeManualStockEntryModel(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR").replace(/[\s._/\\-]+/g, "");
  return /^[A-Z0-9]+$/.test(normalized) && /[A-Z]/.test(normalized) && /\d/.test(normalized)
    ? normalized
    : "";
}

export function matchesExactManualStockEntryModel(query: string, model: string | null) {
  if (!model) return false;
  const normalizedQuery = normalizeManualStockEntryModel(query);
  return Boolean(normalizedQuery) && normalizeManualStockEntryModel(model) === normalizedQuery;
}

export function createManualStockEntryIdentitySelection(
  targetQuery: string,
  quantity: number,
  targetKind: "ITEM" | "COMMERCIAL_CODE",
) {
  const normalizedQuery = targetQuery.trim();
  if (!normalizedQuery || normalizedQuery.length > 120 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximumInteger) {
    return null;
  }
  return {
    action: "manual_stock_entry_identity" as const,
    targetQuery: normalizedQuery,
    quantity,
    targetKind,
  };
}

function normalizeAssistantText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").trim();
}

const manualStockEntryCommandPattern =
  /^\s*(?:(?:quero|preciso|pode)\s+)?(?:(?:de\s+entrada|dar\s+entrada|entrada|entra(?:r)?)(?:\s+manual)?|(?:registrar|registre|registra)(?:\s+(?:uma|a))?\s+entrada(?:\s+manual)?|adicione|adicionar|adiciona|coloque|coloca(?:r)?|p[oõ]e|lance|lancar)\b\s*/iu;

type QuantityMatch = {
  quantity: number;
  index: number;
  length: number;
};

function parseQuantityWord(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const words: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  };
  return words[normalized] ?? Number(value.replace(/^\+/, ""));
}

function extractManualStockEntryQuantity(value: string): QuantityMatch | null {
  const patterns = [
    /\b(?:quantidade\s+de\s+)?(\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+unidades?\b/iu,
    /\bmais\s+(\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\b/iu,
    /(?:^|\s)(?:em|de|do|da|no|na|para\s+o)?\s*(\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\b/iu,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(value);
    const quantityText = match?.[1];
    if (!match || !quantityText) continue;
    return {
      quantity: parseQuantityWord(quantityText),
      index: match.index,
      length: match[0].length,
    };
  }

  return null;
}

function cleanManualStockEntryTarget(value: string, quantityMatch: QuantityMatch | null) {
  const withoutQuantity = quantityMatch
    ? `${value.slice(0, quantityMatch.index)} ${value.slice(quantityMatch.index + quantityMatch.length)}`
    : value;

  return withoutQuantity
    .replace(/\b(?:no|na|ao|para\s+o)\s+estoque\b/giu, " ")
    .replace(/\b(?:servo\s+)?(?:com|sem)\s+kit\b/giu, " ")
    .replace(/\b(?:kit\s+de\s+instala[cç][aã]o|kit\s+de\s+reparo|pe[cç]a\s+avulsa|pe[cç]a)\b/giu, " ")
    .replace(/[?!.,;:]+$/g, "")
    .trim()
    .replace(/^(?:(?:em|no|na|do|da|de|mais|o|a)\s+)+/iu, "")
    .replace(/^c[oó]d(?:igo)?\.?\s*/iu, "")
    .trim();
}

function extractManualStockEntryDetailsReply(value: string): ManualStockEntryRequest | null {
  const match = value.match(
    /^\s*(?:c[oó]d(?:igo)?\.?\s*)?([a-z0-9][a-z0-9/-]*)\s*[,;]\s*(\d{1,10}|um|uma)\s+unidades?\s*[?!.]*$/iu,
  );
  if (!match) return null;

  const quantity = parseQuantityWord(match[2]);
  const targetQuery = match[1].trim();
  if (!targetQuery || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximumInteger) {
    return null;
  }
  return { quantity, targetQuery, requestedIdentity: null };
}

export function routeManualStockEntryAction(rawMessage: string): ManualStockEntryRoute {
  const message = normalizeAssistantText(rawMessage);
  if (/^(sim|confirme|confirmar|pode fazer|pode lancar|execute|ok|manda ver)\s*[?!.]*$/.test(message)) {
    return { kind: "BUTTON_CONFIRMATION_TEXT" };
  }
  if (/^(cancelar|cancele)(?:\s+(?:esta|a))?\s+entrada\s*[?!.]*$/.test(message)) {
    return { kind: "CANCEL" };
  }
  if (/\bpedido\b/.test(message)) return { kind: "NOT_MANUAL_STOCK_ENTRY" };
  const commandMatch = manualStockEntryCommandPattern.exec(message);
  if (!commandMatch) {
    const detailsReply = extractManualStockEntryDetailsReply(rawMessage);
    return detailsReply
      ? { kind: "ACTION", request: detailsReply }
      : { kind: "NOT_MANUAL_STOCK_ENTRY" };
  }
  if (/-\s*\d+\s+unidades?\b/.test(message) || /\b\d+[,.]\d+\s+unidades?\b/.test(message) || /\b\d{11,}\b/.test(message)) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a entrada manual." };
  }

  const messageWithoutCommand = rawMessage.slice(commandMatch[0].length);
  const quantityMatch = extractManualStockEntryQuantity(messageWithoutCommand);
  const quantity = quantityMatch?.quantity ?? null;
  if (!quantityMatch) {
    const targetQuery = cleanManualStockEntryTarget(messageWithoutCommand, null);
    return {
      kind: "MISSING_QUANTITY",
      targetQuery: targetQuery && targetQuery.length <= 120 ? targetQuery : null,
    };
  }
  if (!quantity || !Number.isSafeInteger(quantity) || quantity > maximumInteger) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a entrada manual." };
  }

  const targetQuery = cleanManualStockEntryTarget(messageWithoutCommand, quantityMatch);
  if (!targetQuery || targetQuery.length > 120) {
    return { kind: "INVALID", message: "Informe o código ou modelo do item que deve entrar." };
  }

  const requestedIdentity = /\b(com kit|caixa|caixa completa|codigo comercial)\b/.test(message)
    ? "COMMERCIAL_CODE" as const
    : /\b(sem kit|kit de instalacao|kit de reparo|peca|avulso|avulsa)\b/.test(message)
      ? "ITEM" as const
      : null;

  if (!requestedIdentity && /\bmbf\s*-?\s*\d+/i.test(message)) {
    return { kind: "AMBIGUOUS_FLOW", quantity, targetQuery };
  }

  return { kind: "ACTION", request: { quantity, targetQuery, requestedIdentity } };
}
