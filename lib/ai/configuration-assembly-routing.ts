export type ConfigurationAssemblyRequest = {
  quantity: number;
  targetQuery: string;
};

export type ConfigurationAssemblyRoute =
  | { kind: "NOT_CONFIGURATION_ASSEMBLY" }
  | { kind: "BUTTON_CONFIRMATION_TEXT" }
  | { kind: "CANCEL" }
  | { kind: "INVALID"; message: string }
  | { kind: "ACTION"; request: ConfigurationAssemblyRequest };

const maximumInteger = 2_147_483_647;

function normalizeAssistantText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").trim();
}
const commandPattern = /^\s*(?:(?:quero|preciso|pode)\s+)?(?:(?:monte|montar|monta)\b|(?:(?:fa[cç]a|faz|realize)\s+))\s*/iu;

type QuantityMatch = { quantity: number; index: number; length: number };

function parseQuantityWord(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const words: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  return words[normalized] ?? Number(value.replace(/^\+/, ""));
}

function extractQuantity(value: string): QuantityMatch | null {
  for (const pattern of [
    /\b(?:quantidade\s+de\s+)?(\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+unidades?\b/iu,
    /^\s*(?:mais\s+)?(\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\b/iu,
    /\b(?:uma?|a)\s+montagem\b/iu,
  ]) {
    const match = pattern.exec(value);
    if (match) {
      return {
        quantity: match[1] ? parseQuantityWord(match[1]) : 1,
        index: match.index,
        length: match[0].length,
      };
    }
  }
  return null;
}

function cleanTarget(value: string, quantityMatch: QuantityMatch) {
  return `${value.slice(0, quantityMatch.index)} ${value.slice(quantityMatch.index + quantityMatch.length)}`
    .replace(/\b(?:servos?\s+com\s+kit|caixas?(?:\s+completas?)?|configura[cç][aã]o\s+comercial|montagem)\b/giu, " ")
    .replace(/\b(?:do|da|de|no|na|para\s+o)\s+estoque\b/giu, " ")
    .replace(/\bc[oó]d(?:igo)?\.?\s*/giu, " ")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:do|da|de|mais)\s+)+/iu, "")
    .trim();
}

export function routeConfigurationAssemblyAction(rawMessage: string): ConfigurationAssemblyRoute {
  const normalized = normalizeAssistantText(rawMessage);
  if (/^(sim|confirme|confirmar|pode fazer|pode montar|execute|ok|manda ver)\s*[?!.]*$/.test(normalized)) {
    return { kind: "BUTTON_CONFIRMATION_TEXT" };
  }
  if (/^(cancelar|cancele)(?:\s+(?:esta|a))?\s+montagem\s*[?!.]*$/iu.test(rawMessage.trim())) {
    return { kind: "CANCEL" };
  }
  if (/\bdesmont(?:e|ar|agem)\b/.test(normalized) || !commandPattern.test(rawMessage)) {
    return { kind: "NOT_CONFIGURATION_ASSEMBLY" };
  }
  if (/-\s*\d+\s+unidades?\b/.test(normalized) || /\b\d+[,.]\d+\s+unidades?\b/.test(normalized) || /\b\d{11,}\b/.test(normalized)) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a montagem." };
  }
  const withoutCommand = rawMessage.replace(commandPattern, "");
  const inferredSingleAssembly = /^\s*(?:uma?|a)\s+montagem\b/iu.test(
    withoutCommand,
  );
  const targetInput = inferredSingleAssembly
    ? withoutCommand.replace(/^\s*(?:uma?|a)\s+montagem\s*(?:de\s+)?/iu, "")
    : withoutCommand;
  const quantityMatch = extractQuantity(targetInput);
  const quantity = quantityMatch?.quantity ?? (inferredSingleAssembly ? 1 : null);
  if (!quantity || !Number.isSafeInteger(quantity) || quantity > maximumInteger) {
    return { kind: "INVALID", message: "Informe uma quantidade inteira e positiva para a montagem." };
  }
  const targetQuery = cleanTarget(
    targetInput,
    quantityMatch ?? { quantity: 1, index: 0, length: 0 },
  );
  if (!targetQuery || targetQuery.length > 120) {
    return { kind: "INVALID", message: "Informe o Cód. ou modelo do Servo com kit que deve ser montado." };
  }
  return { kind: "ACTION", request: { quantity, targetQuery } };
}
