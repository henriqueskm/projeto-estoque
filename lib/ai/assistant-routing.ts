import { assistantQueryMaxLength } from "@/lib/assistant-types";

export type AssistantIntent =
  | "UNSUPPORTED_WRITE"
  | "SUMMARY"
  | "ALERTS"
  | "ITEM_QUERY"
  | "GENERAL_CONVERSATION"
  | "AMBIGUOUS";

export function normalizeAssistantText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function isAssemblyCapacityQuestion(message: string) {
  const mentionsAssembly =
    /\b(montar|montagem|montado|montada|montados|montadas)\b/.test(message);
  const asksForAvailability =
    /\b(quantas?|quantos?|quanto|consigo|posso|capacidade|disponibilidade)\b/.test(
      message,
    ) ||
    /\bda para\b/.test(message) ||
    /\b(e|seria) possivel\b/.test(message);

  return mentionsAssembly && asksForAvailability;
}

function hasUnsupportedWriteIntent(message: string) {
  const writePatterns = [
    /\b(dar|de|registrar|registre|fazer|faca|lancar|lance)\s+(uma?\s+)?saida\b/,
    /\b(dar|de|registrar|registre|fazer|faca|lancar|lance)\s+(uma?\s+)?baixa\b/,
    /\bsaida\s+(de|do|da)\s+(item|estoque|produto|peca|servo|kit|caixa)\b/,
    /\b(retirar|retire|baixar|baixe)\b.{0,40}\b(estoque|saldo|item|produto|peca|servo|kit|caixa)\b/,
    /\b(dar|de|registrar|registre|fazer|faca|lancar|lance)\s+(uma?\s+)?entrada\b/,
    /\b(desmontar|desmonte|desmontagem\s+de)\s+(uma?\s+)?caixas?\b/,
    /\b(ajustar|ajuste|corrigir|corrija)\b.{0,40}\b(estoque|saldo|quantidade)\b/,
    /\b(alterar|altere|mudar|mude|definir|defina|configurar|configure)\b.{0,50}\b(estoque\s+minimo|minimo|saldo|quantidade)\b/,
    /\b(adicionar|adicione)\b.{0,40}\b(estoque|saldo|quantidade|item|produto|peca|servo|kit|caixa)\b/,
    /\b(criar|crie|cadastrar|cadastre)\b.{0,50}\b(item|produto|peca|servo|kit|caixa|codigo|pedido|dado|registro)\b/,
    /\b(ativar|ative|desativar|desative)\b.{0,40}\b(item|produto|peca|servo|kit|caixa|codigo|registro)\b/,
    /\b(excluir|exclua|apagar|apague|remover|remova)\b/,
    /\b(delete|insert|update|truncate|drop|alter|create|grant|revoke)\b/,
  ];

  if (writePatterns.some((pattern) => pattern.test(message))) {
    return true;
  }

  return (
    !isAssemblyCapacityQuestion(message) &&
    /\b(montar|monte|montagem\s+de|desmontar|desmonte|desmontagem\s+de)\b/.test(
      message,
    )
  );
}

function hasSummaryIntent(message: string) {
  return (
    message.includes("como esta meu estoque") ||
    message.includes("como esta o estoque") ||
    message.includes("como anda meu estoque") ||
    message.includes("como anda o estoque") ||
    message.includes("resumo do estoque") ||
    message.includes("resumo geral") ||
    message.includes("visao geral do estoque") ||
    message.includes("situacao geral do estoque") ||
    message.includes("situacao do estoque") ||
    message.includes("me mostra o estoque") ||
    message.includes("mostre o estoque")
  );
}

function hasAlertsIntent(message: string) {
  return (
    /\b(o que|quais?|preciso|precisamos|devo|devemos|tenho|tem|ha)\b.{0,80}\b(comprar|repor|reposicao)\b/.test(
      message,
    ) ||
    /\b(o que|quais?|tenho|tem|ha)\b.{0,60}\b(falta|faltam|faltando|acabando)\b/.test(
      message,
    ) ||
    /\bbuscar\b.{0,40}\brepor\b/.test(message) ||
    /\b(esta|estao)\b.{0,30}\b(faltando|acabando)\b/.test(message) ||
    message.includes("estoque baixo") ||
    message.includes("estoque zerado") ||
    message.includes("itens baixos") ||
    message.includes("itens zerados") ||
    /\bitens\b.{0,30}\b(baixos|zerados)\b/.test(message) ||
    message.includes("abaixo do minimo")
  );
}

export function isItemFollowUpMessage(message: string) {
  const normalizedMessage = normalizeAssistantText(message);

  return (
    /^(e\s+)?quant(as?|os?)\b.{0,40}\b(consigo|posso|montad)/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(qual\s+e\s+)?(o\s+)?minimo\b/.test(normalizedMessage) ||
    /^(e\s+)?(as\s+|os\s+)?avuls(as|os)?\b/.test(normalizedMessage) ||
    /^(e\s+)?quant(as?|os?)\s+(estao|tem)\b.{0,30}\b(montad|avuls)/.test(
      normalizedMessage,
    )
  );
}

function hasItemQueryIntent(message: string) {
  if (isAssemblyCapacityQuestion(message) || isItemFollowUpMessage(message)) {
    return true;
  }

  const hasQueryCue =
    /\b(quanto|quantos|quanta|quantas|qual|quais|tenho|temos|tem|possuo|possui|ha|existe|existem|disponivel|disponiveis|consultar|consulte|ver|veja|mostrar|mostre|buscar|busque|procurar|procure|falar|fale|dizer|diga|contar|conte|explicar|explique|informar|informe)\b/.test(
      message,
    );
  const hasStockConcept =
    /\b(estoque|saldo|quantidade|item|itens|codigo|codigos|servo|servos|kit|kits|reparo|reparos|peca|pecas|caixa|caixas|configuracao|configuracoes|modelo|modelos|montagem|montar)\b/.test(
      message,
    );
  const hasBusinessCode =
    /\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*\b/.test(
      message,
    ) ||
    /\b(codigo|item|servo|kit|reparo|peca|caixa|do|da|de)\s+\d+\b/.test(
      message,
    ) ||
    /\b(quanto|quantos|quanta|quantas)\s+\d+\s+(tenho|temos|tem)\b/.test(
      message,
    ) ||
    /\b(tenho|temos|tem|possuo|possui)\s+\d+\s*[?.!]*$/.test(message);

  return hasQueryCue && (hasStockConcept || hasBusinessCode);
}

function hasGeneralConversationIntent(message: string) {
  return (
    /^(bom dia|boa tarde|boa noite|ola|oi)(?:[\s,.!?]+(?:assistente|negocios k))?[\s,.!?]*$/.test(
      message,
    ) ||
    /\b(obrigado|obrigada|valeu|agradeco)\b/.test(message) ||
    /\b(cumprimenta|cumprimentou|cumprimento|cordialidade)\b/.test(message) ||
    message.includes("quem e voce") ||
    message.includes("o que voce consegue fazer") ||
    message.includes("o que voce pode fazer") ||
    message.includes("como voce pode me ajudar") ||
    message.includes("tudo bem") ||
    /^e ai\b/.test(message)
  );
}

export function classifyAssistantIntent(message: string): AssistantIntent {
  const normalizedMessage = normalizeAssistantText(message);

  if (hasUnsupportedWriteIntent(normalizedMessage)) {
    return "UNSUPPORTED_WRITE";
  }

  if (hasSummaryIntent(normalizedMessage)) {
    return "SUMMARY";
  }

  if (hasAlertsIntent(normalizedMessage)) {
    return "ALERTS";
  }

  if (hasItemQueryIntent(normalizedMessage)) {
    return "ITEM_QUERY";
  }

  if (hasGeneralConversationIntent(normalizedMessage)) {
    return "GENERAL_CONVERSATION";
  }

  return "AMBIGUOUS";
}

function cleanQueryCandidate(value: string) {
  const candidate = value
    .trim()
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’?!.,;:]+$/g, "")
    .trim();

  if (
    !candidate ||
    candidate.length > assistantQueryMaxLength ||
    /^(estoque|saldo|item|codigo|servo|kit|reparo|peca|caixa|configuracao)$/i.test(
      normalizeAssistantText(candidate),
    )
  ) {
    return null;
  }

  return candidate;
}

export function extractExplicitItemQuery(message: string) {
  const alphanumericCodes =
    message.match(/\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi) ??
    [];

  if (alphanumericCodes.length > 0) {
    return cleanQueryCandidate(alphanumericCodes.at(-1) ?? "");
  }

  const numericCode = message.match(
    /\b(?:codigo|item|servo|do|da|de)\s+(\d+)\b/i,
  )?.[1];

  if (numericCode) {
    return numericCode;
  }

  const phrasePatterns = [
    /\b(?:fale|diga|conte|explique|informe)\s+(?:me\s+)?(?:sobre\s+)?(?:o|a|do|da|de)?\s*([^?!.]+)$/i,
    /\b(?:consultar|consulte|buscar|busque|procurar|procure|mostrar|mostre)\s+(?:o|a|do|da|de)?\s*([^?!.]+)$/i,
    /\b(?:quanto|quantos|quanta|quantas)\s+(?:eu\s+)?(?:tenho|temos|tem)\s+(?:do|da|de)?\s*([^?!.]+)$/i,
    /\b(?:tenho|temos|tem|possuo|possui|existe)\s+(?:o|a|do|da|de)?\s*([^?!.]+)$/i,
  ];

  for (const pattern of phrasePatterns) {
    const candidate = message.match(pattern)?.[1];
    const cleanedCandidate = candidate ? cleanQueryCandidate(candidate) : null;

    if (cleanedCandidate) {
      return cleanedCandidate;
    }
  }

  return null;
}

export function getExplicitGreeting(message: string) {
  const greeting = normalizeAssistantText(message).match(
    /^(bom dia|boa tarde|boa noite|ola|oi)\b/,
  )?.[1];

  switch (greeting) {
    case "bom dia":
      return "Bom dia";
    case "boa tarde":
      return "Boa tarde";
    case "boa noite":
      return "Boa noite";
    case "ola":
      return "Olá";
    case "oi":
      return "Oi";
    default:
      return null;
  }
}
