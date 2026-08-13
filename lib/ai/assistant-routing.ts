import {
  assistantQueryMaxLength,
  type AssistantInventoryItemSummaryMetric,
} from "@/lib/assistant-types";
import { extractServoModelCandidate } from "@/lib/servo-model-search";

export type AssistantIntent =
  | "UNSUPPORTED_WRITE"
  | "SUMMARY"
  | "ALERTS"
  | "CATALOG_MEDIA"
  | "ITEM_QUERY"
  | "GENERAL_CONVERSATION"
  | "AMBIGUOUS";

export type AssistantInventoryItemRoute = {
  queryCode: string;
  metric: AssistantInventoryItemSummaryMetric;
};

export type AssistantClarificationRoute =
  | { kind: "CATALOG_CODE"; code: string }
  | { kind: "SUPPLIER_ORDERS"; contextual: boolean }
  | { kind: "GENERIC" };

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
    /\b(cancelar|cancele|finalizar|finalize|editar|edite|alterar|altere)\b.{0,50}\b(pedido|negociacao)\b/,
    /\b(marcar|registre|registrar)\b.{0,50}\b(retirada|retirado|pedido)\b/,
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

function hasCatalogMediaIntent(message: string) {
  const hasExplicitMediaWord = /\b(foto|fotos|imagem|imagens)\b/.test(
    message,
  );

  if (hasExplicitMediaWord) {
    return true;
  }

  const hasVisualVerb =
    /\b(ver|veja|mostrar|mostre|abrir|abra|visualizar|visualize)\b/.test(
      message,
    );
  const hasCatalogTarget =
    /\b(codigo|item|servo|kit|reparo|peca|caixa|configuracao)\b/.test(
      message,
    );
  const asksOperationalData =
    /\b(estoque|saldo|quantidade|quanto|quantos|quanta|quantas|tenho|temos|tem|disponivel|montar|montagem|minimo)\b/.test(
      message,
    );

  return hasVisualVerb && hasCatalogTarget && !asksOperationalData;
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
    ) ||
    /^(e\s+)?quant(as?|os?)\s+(?:estao\s+)?(?:com\s+kit|sem\s+kit|separad)/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(qual\s+e\s+)?(a\s+)?situacao\b/.test(normalizedMessage) ||
    /^(e\s+)?(esta|ta)\s+(baixo|zerado)\b/.test(normalizedMessage) ||
    /^(e\s+)?quanto\s+falta\b.{0,40}\bminimo\b/.test(normalizedMessage) ||
    /^(e\s+)?(o\s+que\s+e|qual\s+e|descricao)\b/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(qual\s+)?(servo|kit|composicao)\b/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(?:dentro\s+de|nas|em|quais)\s+caixas\b/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(?:tem|esta)\s+pouco\s+(?:dele|desse|deste)?\b/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(?:qual\s+(?:kit|servo)\s+dele|do\s+que\s+(?:ele\s+)?e\s+formado)\b/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(?:quais\s+(?:configuracoes|codigos)|em\s+quais\s+configuracoes|como\b.{0,35}\bdistribuidos|mostre\s+as\s+configuracoes)\b/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(?:com\s+kit|sem\s+kit|separados?)\b/.test(
      normalizedMessage,
    ) ||
    /^(e\s+)?(mostre|mostrar|ver|abra|abrir)\b.{0,20}\b(foto|imagem)\b/.test(
      normalizedMessage,
    )
  );
}

export type AssistantServoModelInventoryView =
  | "TOTAL"
  | "MOUNTED"
  | "LOOSE"
  | "BREAKDOWN"
  | "BOX_AMBIGUOUS";

export function isServoModelInventoryFollowUp(message: string) {
  const normalizedMessage = normalizeAssistantText(message);

  return (
    /^(e\s+)?(?:quanto|quantos|quantas)\b/.test(normalizedMessage) ||
    /^(e\s+)?(?:no\s+total|com\s+kit|sem\s+kit|separados?)\b/.test(
      normalizedMessage,
    ) ||
    /\b(configuracoes|codigos\s+com\s+kit|distribuidos|caixas|qual\s+(?:kit|servo))\b/.test(
      normalizedMessage,
    )
  );
}

export function routeServoModelInventoryView(
  message: string,
): AssistantServoModelInventoryView {
  const normalizedMessage = normalizeAssistantText(message);

  if (
    /\b(dentro\s+de\s+caixas|nas\s+caixas|em\s+caixas|quais\s+caixas)\b/.test(
      normalizedMessage,
    )
  ) {
    return "BOX_AMBIGUOUS";
  }

  if (
    /\b(quais\s+(?:configuracoes|codigos(?:\s+com\s+kit)?)|em\s+quais\s+configuracoes|como\b.{0,45}\bdistribuidos|mostre\s+as\s+configuracoes|qual\s+(?:kit|servo))\b/.test(
      normalizedMessage,
    )
  ) {
    return "BREAKDOWN";
  }

  if (/\b(sem\s+kit|separados?)\b/.test(normalizedMessage)) {
    return "LOOSE";
  }

  if (/\b(com\s+kit|montados?\s+com\s+kit)\b/.test(normalizedMessage)) {
    return "MOUNTED";
  }

  return "TOTAL";
}

export function hasClearInventoryQueryIntent(message: string) {
  const normalizedMessage = normalizeAssistantText(message);

  if (/\b(pedido|pedidos|negociacao|fornecedor)\b/.test(normalizedMessage)) {
    return false;
  }

  return /\b(quanto|quantos|quanta|quantas|tenho|temos|tem|estoque|saldo|quantidade|disponivel|situacao|baixo|baixa|pouco|minimo|composicao|configuracoes|qual\s+kit|qual\s+servo)\b/.test(
    normalizedMessage,
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
  const hasServoModelCandidate = Boolean(
    extractServoModelCandidate(message),
  );
  const hasModelStatusCue =
    hasServoModelCandidate &&
    /\b(esta|estao|baixo|baixa|zerado|zerada|minimo|estoque)\b/.test(
      message,
    );

  return (
    (hasQueryCue &&
      (hasStockConcept || hasBusinessCode || hasServoModelCandidate)) ||
    hasModelStatusCue
  );
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

  if (hasCatalogMediaIntent(normalizedMessage)) {
    return "CATALOG_MEDIA";
  }

  if (hasItemQueryIntent(normalizedMessage)) {
    return "ITEM_QUERY";
  }

  if (hasGeneralConversationIntent(normalizedMessage)) {
    return "GENERAL_CONVERSATION";
  }

  return "AMBIGUOUS";
}

function normalizeCatalogCode(value: string) {
  return value
    .trim()
    .replace(/\s*-\s*/g, "-")
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/gi, "")
    .toLocaleUpperCase("pt-BR");
}

export function extractCatalogMediaCode(message: string) {
  const normalizedMessage = normalizeAssistantText(message);
  const searchableMessage = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([A-Z0-9])\s*-\s*([A-Z0-9])/gi, "$1-$2");

  if (!hasCatalogMediaIntent(normalizedMessage)) {
    return null;
  }

  const alphanumericCodes =
    searchableMessage.match(
      /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+(?:\s*-\s*[A-Z0-9]+)*\b/gi,
    ) ?? [];
  const contextualNumericCodes = Array.from(
    searchableMessage.matchAll(
      /\b(?:codigo|item|servo|kit|reparo|peca|caixa|configuracao|foto|imagem)\s+(?:do|da|de|n[ao])?\s*(\d+)\b/gi,
    ),
    (match) => match[1],
  );
  const candidates = Array.from(
    new Set(
      [...alphanumericCodes, ...contextualNumericCodes]
        .map(normalizeCatalogCode)
        .filter(Boolean),
    ),
  );

  return candidates.length === 1 ? candidates[0] : null;
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
  const searchableMessage = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([A-Z0-9])\s*-\s*([A-Z0-9])/gi, "$1-$2");
  const numericCode = searchableMessage.match(
    /\b(?:codigo|cod\.?|itens?|servos?|kits?|reparos?|pecas?|caixas?|suportes?|do|da|de)\s+(\d+)\b/i,
  )?.[1];

  if (numericCode) {
    return numericCode;
  }

  const servoModelCandidate = extractServoModelCandidate(message);

  if (servoModelCandidate) {
    const modelIndex = searchableMessage
      .toLocaleLowerCase("pt-BR")
      .indexOf(servoModelCandidate.toLocaleLowerCase("pt-BR"));
    const suffixText = searchableMessage
      .slice(modelIndex + servoModelCandidate.length)
      .trim();
    const ignoredSuffixes = new Set([
      "abaixo",
      "avulso",
      "avulsos",
      "com",
      "da",
      "de",
      "do",
      "e",
      "em",
      "esta",
      "estoque",
      "existe",
      "modelo",
      "montado",
      "montados",
      "na",
      "nas",
      "no",
      "nos",
      "para",
      "pedido",
      "pedidos",
      "possuo",
      "sem",
      "tem",
      "tenho",
    ]);
    const suffixParts: string[] = [];

    for (const part of suffixText.split(/\s+/).slice(0, 3)) {
      const cleanedPart = part.replace(/^[^\p{L}\p{N}]+|[?!.;,]+$/gu, "");
      const normalizedPart = normalizeAssistantText(cleanedPart);

      if (
        !cleanedPart ||
        ignoredSuffixes.has(normalizedPart) ||
        !/^[\p{L}\p{N}/_-]+$/u.test(cleanedPart)
      ) {
        break;
      }

      suffixParts.push(cleanedPart);
    }

    const candidate =
      suffixParts.length > 0
        ? `${servoModelCandidate} ${suffixParts.join(" ")}`
        : servoModelCandidate;

    return cleanQueryCandidate(candidate);
  }

  const alphanumericCodes =
    searchableMessage.match(
      /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi,
    ) ??
    [];

  if (alphanumericCodes.length > 0) {
    return cleanQueryCandidate(alphanumericCodes.at(-1) ?? "");
  }

  const phrasePatterns = [
    /\b(?:fale|diga|conte|explique|informe)\s+(?:me\s+)?(?:sobre\s+)?(?:o|a|do|da|de)?\s*([^?!.]+)$/i,
    /\b(?:consultar|consulte|buscar|busque|procurar|procure|mostrar|mostre)\s+(?:o|a|do|da|de)?\s*([^?!.]+)$/i,
    /\b(?:quanto|quantos|quanta|quantas)\s+(?:eu\s+)?(?:tenho|temos|tem)\s+(?:do|da|de)?\s*([^?!.]+)$/i,
    /\b(?:tenho|temos|tem|possuo|possui|existe)\s+(?:o|a|do|da|de)?\s*([^?!.]+)$/i,
  ];

  for (const pattern of phrasePatterns) {
    const candidate = searchableMessage.match(pattern)?.[1];
    const cleanedCandidate = candidate ? cleanQueryCandidate(candidate) : null;

    if (cleanedCandidate) {
      return cleanedCandidate;
    }
  }

  return null;
}

function isExactCatalogCode(value: string) {
  return /^(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*$/i.test(value);
}

export function isItemToSupplierOrdersFollowUp(message: string) {
  return /^(?:e\s+)?(?:nos?|em)\s+pedidos?\s*[?!.]*$/i.test(
    normalizeAssistantText(message),
  );
}

export function routeAssistantClarification(
  message: string,
  hasSupplierOrderContext: boolean,
): AssistantClarificationRoute | null {
  const normalizedMessage = normalizeAssistantText(message);
  const explicitQuery = extractExplicitItemQuery(message);
  const normalizedCode = explicitQuery
    ? normalizeCatalogCode(explicitQuery)
    : null;
  const hasExplicitDomain =
    /\b(estoque|saldo|pedidos?|negociacao|foto|fotos|imagem|imagens|minimo|zerad[oa]s?|baix[oa]s?|reposicao|composicao|servo\s+e\s+kit|retirada|retirar|entrada)\b/.test(
      normalizedMessage,
    );
  const asksAmbiguousCodeQuestion =
    Boolean(normalizedCode && isExactCatalogCode(normalizedCode)) &&
    !hasExplicitDomain &&
    (/^(?:eu\s+)?tenho\b/.test(normalizedMessage) &&
    !/\bquant(?:o|os|a|as)\b/.test(normalizedMessage)
      ? true
      : /\bquanto\s+tem\b/.test(normalizedMessage) ||
        /\bsituacao\b/.test(normalizedMessage) ||
        /\b(?:quero\s+)?(?:consultar|ver|veja|mostrar|mostre|falar|fale|contar|conte|dizer|diga|explicar|explique|informar|informe)\b/.test(
          normalizedMessage,
        ) ||
        normalizeCatalogCode(
          normalizedMessage.replace(/[?!.]+$/g, ""),
        ) === normalizedCode);

  if (asksAmbiguousCodeQuestion && normalizedCode) {
    return { kind: "CATALOG_CODE", code: normalizedCode };
  }

  if (
    hasSupplierOrderContext &&
    /^(?:e\s+)?agora\s*[?!.]*$/.test(normalizedMessage)
  ) {
    return { kind: "SUPPLIER_ORDERS", contextual: true };
  }

  if (
    /\b(?:quero|preciso|gostaria\s+de)\s+(?:consultar|ver|buscar|procurar)\s+(?:um\s+)?pedido\b/.test(
      normalizedMessage,
    ) ||
    /^(?:consultar|ver|buscar|procurar)\s+(?:um\s+)?pedido\s*[?!.]*$/.test(
      normalizedMessage,
    )
  ) {
    return { kind: "SUPPLIER_ORDERS", contextual: false };
  }

  if (
    /\bpreciso\s+de\s+ajuda\b/.test(normalizedMessage) ||
    /\bnao\s+sei\s+(?:o\s+)?que\s+perguntar\b/.test(
      normalizedMessage,
    ) ||
    /\bo\s+que\s+voce\s+(?:consegue|pode)\s+fazer\b/.test(
      normalizedMessage,
    ) ||
    /\bcomo\s+voce\s+pode\s+me\s+ajudar\b/.test(normalizedMessage) ||
    /\b(?:mostre|mostrar|ver)\s+(?:as\s+)?(?:opcoes|exemplos)\b/.test(
      normalizedMessage,
    )
  ) {
    return { kind: "GENERIC" };
  }

  return null;
}

export function routeInventoryItemSummaryQuestion(
  message: string,
  lastItemQuery: string | null,
): AssistantInventoryItemRoute | null {
  const normalizedMessage = normalizeAssistantText(message);

  if (/\b(foto|fotos|imagem|imagens)\b/.test(normalizedMessage)) {
    return null;
  }

  const explicitQuery = extractExplicitItemQuery(message);
  const contextualQuery =
    !explicitQuery &&
    lastItemQuery &&
    isItemFollowUpMessage(message)
      ? lastItemQuery
      : null;
  const rawQuery = explicitQuery ?? contextualQuery;

  if (!rawQuery) {
    return null;
  }

  if (extractServoModelCandidate(rawQuery)) {
    return null;
  }

  const queryCode = normalizeCatalogCode(rawQuery);

  if (!queryCode || !isExactCatalogCode(queryCode)) {
    return null;
  }

  const asksComposition =
    /\b(composicao|forma(?:m|do|da|dos|das)|qual\s+servo|qual\s+kit|servo\s+e\s+kit)\b/.test(
      normalizedMessage,
    );
  const asksDescription =
    /\b(o\s+que\s+e|descricao|descreva)\b/.test(normalizedMessage) ||
    /\bqual\s+e\b.{0,24}\b(codigo|item|servo|kit|reparo|peca|caixa|configuracao)\b/.test(
      normalizedMessage,
    );
  const asksShortfall =
    /\b(falta|faltam|faltando)\b.{0,45}\bminimo\b|\bminimo\b.{0,45}\b(falta|faltam|faltando)\b/.test(
      normalizedMessage,
    );
  const asksMinimum = /\bminimo\b/.test(normalizedMessage);
  const asksStatus =
    /\b(baixo|baixos|baixa|baixas|pouco|zerado|zerados|zerada|zeradas|repor|reposicao|situacao)\b/.test(
      normalizedMessage,
    );
  const asksStock =
    /\b(quanto|quantos|quanta|quantas|tenho|temos|tem|possuo|possui|estoque|saldo|quantidade|disponivel|existe|existem|montad[ao]s?)\b/.test(
      normalizedMessage,
    );

  const metric: AssistantInventoryItemSummaryMetric = asksComposition
    ? "COMPOSITION"
    : asksDescription
      ? "DESCRIPTION"
      : asksShortfall
        ? "SHORTFALL"
        : asksMinimum
          ? "MINIMUM"
          : asksStatus
            ? "STATUS"
            : "STOCK";

  if (
    !asksComposition &&
    !asksDescription &&
    !asksShortfall &&
    !asksMinimum &&
    !asksStatus &&
    !asksStock
  ) {
    return null;
  }

  return { queryCode, metric };
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

export function getStandaloneGreeting(message: string) {
  const normalizedMessage = normalizeAssistantText(message);

  if (
    !/^(bom dia|boa tarde|boa noite|ola|oi)(?:[\s,.!?]+(?:assistente|negocios k))?[\s,.!?]*$/.test(
      normalizedMessage,
    )
  ) {
    return null;
  }

  const greeting = normalizedMessage.match(
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
    case "oi":
      return "Olá";
    default:
      return null;
  }
}
