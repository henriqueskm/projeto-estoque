export type SupplierOrderStockEntryRequest = {
  negotiationNumber: string;
  quantity: number | null;
  allAvailable: boolean;
  targetQueries: string[];
};

export type SupplierOrderStockEntryRoute =
  | { kind: "NOT_SUPPLIER_ORDER_STOCK_ENTRY" }
  | { kind: "BUTTON_CONFIRMATION_TEXT" }
  | { kind: "CANCEL" }
  | { kind: "INVALID"; message: string }
  | { kind: "ACTION"; request: SupplierOrderStockEntryRequest };

const maximumInteger = 2_147_483_647;

function normalizeAssistantText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").trim();
}

function normalizeNegotiation(value: string) {
  const result = value.trim().replace(/\s+/g, " ").replace(/[?!.,;:]+$/g, "");
  return result && result.length <= 120 && /^[\p{L}\p{N} /-]+$/u.test(result)
    ? result
    : null;
}

function normalizeTarget(value: string) {
  const result = value.trim().replace(/^(?:do|da|de|o|a)\s+/i, "")
    .replace(/^c[oó]d(?:igo)?\.?\s*/iu, "")
    .replace(/[?!.,;:]+$/g, "")
    .trim()
    .replace(/\s+(?:no|ao)\s+estoque$/iu, "").trim();
  return result && result.length <= 120 ? result : null;
}

type NegotiationMatch = {
  candidate: string;
  start: number;
  end: number;
};

function extractNegotiation(rawMessage: string): NegotiationMatch | null {
  const match = rawMessage.match(
    /(?:\b(?:no|do|pelo|para\s+o)\s+)?\bpedido\b(?:\s+(?:n|numero|número))?\s*[º°#:]?\s*(.+?)(?=(?:\s*[,;]\s*)|(?:\s+(?:(?:dê|de|dar)\s+entrada|lance|lançar|registre|registrar|mais\s+(?:\d+|um|uma)\b|em\s+(?:\d+|um|uma)\s+unidades?\b|do\s+c[oó]d(?:igo)?\.?\b|no\s+estoque\b|para\s+o\s+estoque\b|em\s+estoque\b))|\s*[?!.]*$)/iu,
  );
  if (!match || match.index === undefined) return null;
  const candidate = normalizeNegotiation(match[1]);
  if (!candidate) return null;
  return { candidate, start: match.index, end: match.index + match[0].length };
}

function parsePositiveQuantity(messageWithoutOrder: string) {
  const message = normalizeAssistantText(messageWithoutOrder);
  const match = message.match(/\b(\d{1,10}|um|uma)\s+unidades?\b/) ??
    message.match(/\b(?:entrada|lance|lancar|poe|joga|coloque)\s+(?:em\s+|mais\s+)?(\d{1,10}|um|uma)\b(?![\p{L}\d])/u) ??
    message.match(/\bmais\s+(\d{1,10}|um|uma)\b(?![\p{L}\d])/u);
  if (!match) return null;
  return /^(um|uma)$/.test(match[1]) ? 1 : Number(match[1]);
}

function extractTargetText(messageWithoutOrder: string) {
  return messageWithoutOrder
    .replace(/[,;]+/g, " ")
    .replace(/^\s*(?:no\s+)?(?:(?:dê|de|dar|registre|registrar)\s+entrada(?:\s+(?:no|para\s+o)\s+estoque)?|(?:lance|lançar)(?:\s+mais)?|coloque|põe|poe|jogue|joga)\s*/iu, "")
    .replace(/^(?:em\s+)?(?:\d{1,10}|um|uma)\s*(?:unidades?)?\s*(?:do|da|de)?\s*/iu, "")
    .replace(/\s+(?:no|para\s+o|pra|em)\s+estoque\s*$/iu, "")
    .trim();
}

export function routeSupplierOrderStockEntryAction(
  rawMessage: string,
): SupplierOrderStockEntryRoute {
  const message = normalizeAssistantText(rawMessage);
  if (/^(sim|confirme|confirmar|pode fazer|pode lancar|execute|ok|manda ver)\s*[?!.]*$/.test(message)) {
    return { kind: "BUTTON_CONFIRMATION_TEXT" };
  }
  if (/^(cancelar|cancele)(?:\s+(?:esta|a))?\s+entrada\s*[?!.]*$/.test(message)) {
    return { kind: "CANCEL" };
  }
  const mentionsOrder = /\bpedido\b/.test(message);
  if (/^(o que|quais?|quanto|o pedido)\b/.test(message) || /\b(ainda\s+possui|aguardam?\s+entrada|pode\s+entrar)\b/.test(message)) {
    return { kind: "NOT_SUPPLIER_ORDER_STOCK_ENTRY" };
  }
  const entryVerb = /\b(dar|de|dê|registrar|registre|lancar|lance|lançar|entrada|colocar|poe|joga)\b/.test(message) &&
    /\b(entrada|estoque|lancar|lance|lançar|poe|joga)\b/.test(message);
  if (!mentionsOrder || !entryVerb) return { kind: "NOT_SUPPLIER_ORDER_STOCK_ENTRY" };
  if (/-\s*\d+\s+unidades?\b/.test(message)) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a entrada." };
  }

  const negotiationMatch = extractNegotiation(rawMessage);
  if (!negotiationMatch) {
    return { kind: "INVALID", message: "Informe o número exato da negociação do Pedido." };
  }

  const messageWithoutOrder = `${rawMessage.slice(0, negotiationMatch.start)} ${rawMessage.slice(negotiationMatch.end)}`;
  const quantity = parsePositiveQuantity(messageWithoutOrder);
  if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximumInteger)) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a entrada." };
  }
  const explicitAll = /\b(tudo|todas?|unidades retiradas|disponivel|disponiveis)\b/.test(message);
  const afterQuantity = extractTargetText(messageWithoutOrder)
    .replace(/^(?:tudo|todas?\s+as\s+unidades|as\s+unidades\s+retiradas)\s*(?:que\s+est[ãa]o\s+dispon[ií]veis)?\s*/iu, "")
    .trim();
  const rawTargets = afterQuantity
    .split(/\s+(?:e|,)\s+/i)
    .map(normalizeTarget)
    .filter((value): value is string => Boolean(value));
  const allAvailable = explicitAll || (quantity === null && rawTargets.length > 0);
  const targetQueries = explicitAll ? [] : Array.from(new Set(rawTargets));

  if (!explicitAll && targetQueries.length === 0) {
    return { kind: "INVALID", message: "Informe o código ou modelo do item que deve entrar." };
  }

  return {
    kind: "ACTION",
    request: { negotiationNumber: negotiationMatch.candidate, quantity, allAvailable, targetQueries },
  };
}
