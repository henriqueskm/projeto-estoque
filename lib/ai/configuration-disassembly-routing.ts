export type ConfigurationDisassemblyRequest = {
  quantity: number;
  targetQuery: string;
  contextual?: true;
};

export type ConfigurationDisassemblyRoute =
  | { kind: "NOT_CONFIGURATION_DISASSEMBLY" }
  | { kind: "BUTTON_CONFIRMATION_TEXT" }
  | { kind: "CANCEL" }
  | { kind: "INVALID"; message: string }
  | { kind: "ACTION"; request: ConfigurationDisassemblyRequest };

const maximumInteger = 2_147_483_647;

function normalizeAssistantText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").trim();
}

const commandPattern = /^\s*(?:desmonte|desmontar|desmontagem|quero\s+desmontar|fa[cç]a\s+(?:a\s+)?desmontagem\s+(?:de\s+)?|realize\s+(?:a\s+)?desmontagem\s+(?:de\s+)?)\b\s*/iu;

function parseQuantityWord(value: string) {
  return /^(?:um|uma)$/iu.test(value) ? 1 : Number(value);
}

function extractQuantity(value: string) {
  for (const pattern of [
    /\b(?:quantidade\s+de\s+)?(\d{1,10}|um|uma)\s+unidades?\b/iu,
    /^\s*(\d{1,10}|um|uma)\b/iu,
  ]) {
    const match = pattern.exec(value);
    if (match?.[1]) return { quantity: parseQuantityWord(match[1]), index: match.index, length: match[0].length };
  }
  return null;
}

function cleanTarget(value: string, quantityMatch: { index: number; length: number }) {
  return `${value.slice(0, quantityMatch.index)} ${value.slice(quantityMatch.index + quantityMatch.length)}`
    .replace(/\b(?:servos?\s+com\s+kit|caixas?\s+completas?|configura[cç][aã]o\s+comercial)\b/giu, " ")
    .replace(/\b(?:do|da|de|no|na|para\s+o)\s+estoque\b/giu, " ")
    .replace(/\bc[oó]d(?:igo)?\.?\s*/giu, " ")
    .replace(/\b(?:dessa|desta)\s+configura[cç][aã]o\b/giu, " ")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:do|da|de|mais)\s+)+/iu, "")
    .trim();
}

export function routeConfigurationDisassemblyAction(rawMessage: string): ConfigurationDisassemblyRoute {
  const normalized = normalizeAssistantText(rawMessage);
  if (/^(sim|confirme|confirmar|pode fazer|pode desmontar|execute|ok|manda ver)\s*[?!.]*$/.test(normalized)) {
    return { kind: "BUTTON_CONFIRMATION_TEXT" };
  }
  if (/^(cancelar|cancele)(?:\s+(?:esta|a))?\s+desmontagem\s*[?!.]*$/iu.test(rawMessage.trim())) {
    return { kind: "CANCEL" };
  }
  if (!/\bdesmont(?:e|ar|agem)\b/.test(normalized) || !commandPattern.test(rawMessage)) {
    return { kind: "NOT_CONFIGURATION_DISASSEMBLY" };
  }
  if (/-\s*\d+\s+unidades?\b/.test(normalized)) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a desmontagem." };
  }
  const withoutCommand = rawMessage.replace(commandPattern, "");
  const quantityMatch = extractQuantity(withoutCommand);
  const quantity = quantityMatch?.quantity ?? null;
  if (!quantityMatch || !quantity || !Number.isSafeInteger(quantity) || quantity > maximumInteger) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a desmontagem." };
  }
  const targetQuery = cleanTarget(withoutCommand, quantityMatch);
  if (!targetQuery && /\b(?:dessa|desta)\s+configura[cç][aã]o\b/iu.test(withoutCommand)) {
    return { kind: "ACTION", request: { quantity, targetQuery: "", contextual: true } };
  }
  if (!targetQuery || targetQuery.length > 120) {
    return { kind: "INVALID", message: "Informe o Cód. ou a descrição do Servo com kit que deve ser desmontado." };
  }
  return { kind: "ACTION", request: { quantity, targetQuery } };
}
