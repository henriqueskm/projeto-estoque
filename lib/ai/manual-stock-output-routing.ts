export type ManualStockOutputRequest = {
  quantity: number;
  targetQuery: string;
  requestedIdentity: "ITEM" | "COMMERCIAL_CODE" | null;
};

export type ManualStockOutputRoute =
  | { kind: "NOT_MANUAL_STOCK_OUTPUT" }
  | { kind: "BUTTON_CONFIRMATION_TEXT" }
  | { kind: "CANCEL" }
  | { kind: "INVALID"; message: string }
  | { kind: "AMBIGUOUS_TARGET"; quantity: number; targetQuery: string }
  | { kind: "ACTION"; request: ManualStockOutputRequest };

const maximumInteger = 2_147_483_647;

function normalizeAssistantText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").trim();
}

const commandPattern = /^\s*(?:(?:quero|preciso|pode)\s+)?(?:(?:retire|retirar|tire|tirar|tira|remova|remover|remove|baixe|baixar|baixa|desconte|descontar|desconta)|(?:(?:registrar|registre|registra)\s+)?(?:uma\s+)?sa[ií]da|d[êeáa]\s+(?:sa[ií]da|baixa)(?:\s+em)?|dar\s+(?:sa[ií]da|baixa)(?:\s+em)?)\b\s*/iu;

type QuantityMatch = { quantity: number; index: number; length: number };

function parseQuantityWord(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const words: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  };
  return words[normalized] ?? Number(value.replace(/^\+/, ""));
}

function extractQuantity(value: string): QuantityMatch | null {
  const patterns = [
    /\b(?:quantidade\s+de\s+)?(\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+unidades?\b/iu,
    /\bmais\s+(\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\b/iu,
    /^\s*(?:em|de)?\s*(\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\b/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match?.[1]) continue;
    return { quantity: parseQuantityWord(match[1]), index: match.index, length: match[0].length };
  }
  return null;
}

function cleanTarget(value: string, quantityMatch: QuantityMatch) {
  const withoutQuantity = `${value.slice(0, quantityMatch.index)} ${value.slice(quantityMatch.index + quantityMatch.length)}`;
  return withoutQuantity
    .replace(/\b(?:do|no|ao|para\s+o)\s+estoque\b/giu, " ")
    .replace(/\bservos?\s+(?:com|sem)\s+kit\b/giu, " ")
    .replace(/\b(?:com|sem)\s+kit\b/giu, " ")
    .replace(/\b(?:kit\s+de\s+instala[cç][aã]o|kit\s+de\s+reparo|pe[cç]a\s+avulsa|pe[cç]a)\b/giu, " ")
    .replace(/\bc[oó]d(?:igo)?\.?\s*/giu, " ")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:em|no|na|do|da|de|mais)\s+)+/iu, "")
    .trim();
}

export function createManualStockOutputIdentitySelection(
  targetQuery: string,
  quantity: number,
  targetKind: "ITEM" | "COMMERCIAL_CODE",
) {
  const query = targetQuery.trim();
  if (!query || query.length > 120 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximumInteger) return null;
  return { action: "manual_stock_output_identity" as const, targetQuery: query, quantity, targetKind };
}

export function routeManualStockOutputAction(rawMessage: string): ManualStockOutputRoute {
  const message = normalizeAssistantText(rawMessage);
  if (/^(sim|confirme|confirmar|pode fazer|pode retirar|pode baixar|execute|ok|manda ver)\s*[?!.]*$/.test(message)) {
    return { kind: "BUTTON_CONFIRMATION_TEXT" };
  }
  if (/^(cancelar|cancele)(?:\s+(?:esta|a))?\s+sa[íi]da\s*[?!.]*$/iu.test(rawMessage.trim())) {
    return { kind: "CANCEL" };
  }
  if (/\bpedido\b/.test(message)) return { kind: "NOT_MANUAL_STOCK_OUTPUT" };
  if (!commandPattern.test(rawMessage)) return { kind: "NOT_MANUAL_STOCK_OUTPUT" };
  if (/-\s*\d+\s+unidades?\b/.test(message) || /\b\d+[,.]\d+\s+unidades?\b/.test(message) || /\b\d{11,}\b/.test(message)) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a saída manual." };
  }
  const withoutCommand = rawMessage.replace(commandPattern, "");
  const quantityMatch = extractQuantity(withoutCommand);
  const quantity = quantityMatch?.quantity ?? null;
  if (!quantityMatch || !quantity || !Number.isSafeInteger(quantity) || quantity > maximumInteger) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a saída manual." };
  }
  const targetQuery = cleanTarget(withoutCommand, quantityMatch);
  if (!targetQuery || targetQuery.length > 120) {
    return { kind: "INVALID", message: "Informe o código ou modelo do item que deve sair." };
  }
  const requestedIdentity = /\b(com kit|caixa|caixa completa|codigo comercial)\b/.test(message)
    ? "COMMERCIAL_CODE" as const
    : /\b(sem kit|kit de instalacao|kit de reparo|peca|avulso|avulsa)\b/.test(message)
      ? "ITEM" as const
      : null;
  if (!requestedIdentity && /\bmbf\s*-?\s*\d+/i.test(message)) {
    return { kind: "AMBIGUOUS_TARGET", quantity, targetQuery };
  }
  return { kind: "ACTION", request: { quantity, targetQuery, requestedIdentity } };
}
