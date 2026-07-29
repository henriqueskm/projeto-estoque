export type PurchaseRecommendationRoute =
  | { kind: "CLARIFICATION"; queryCode: string }
  | {
      kind: "QUERY";
      mode:
        | "buy_now"
        | "already_ordered"
        | "missing_minimum"
        | "all"
        | "code";
      queryCode: string | null;
      codeIntent: "recommendation" | "pending" | null;
    };

function normalizeCode(value: string) {
  return value
    .trim()
    .replace(/\s*-\s*/g, "-")
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/gi, "")
    .toLocaleUpperCase("pt-BR");
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function extractRecommendationCode(message: string) {
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([A-Z0-9])\s*-\s*([A-Z0-9])/gi, "$1-$2");
  const matches =
    normalized.match(
      /\b(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi,
    ) ?? [];
  const codes = Array.from(
    new Set(matches.map(normalizeCode).filter(Boolean)),
  );

  return codes.length === 1 ? codes[0] : null;
}

export function routePurchaseRecommendationQuestion(
  message: string,
): PurchaseRecommendationRoute | null {
  const normalized = normalizeText(message);
  const queryCode = extractRecommendationCode(message);

  if (
    queryCode &&
    /^compra\s+(?:do|da|de)\s+/i.test(normalized)
  ) {
    return { kind: "CLARIFICATION", queryCode };
  }

  const asksMissingMinimum =
    /\b(sem|nao\s+(?:tem|possui|temos|possuem))\b.{0,28}\b(estoque\s+)?minimo\b/.test(
      normalized,
    );
  const asksAlreadyOrdered =
    /\b(ja\s+(?:foi|foram|esta|estao|tem|temos|possui|possuem)\s+comprad[oa]s?|ja\s+comprad[oa]s?|compra\s+pendente)\b/.test(
      normalized,
    ) ||
    /\babaixo\b.{0,35}\bminimo\b.{0,35}\b(?:em|no|nos)\s+pedidos?\b/.test(
      normalized,
    );
  const asksBuyNow =
    /\bo\s+que\s+(?:eu\s+)?preciso\s+comprar\b/.test(normalized) ||
    /\b(?:monte|montar|mostre|mostrar)\b.{0,35}\blista\s+(?:recomendada\s+)?de\s+compra\b/.test(
      normalized,
    ) ||
    /\bquais?\b.{0,20}\bitens?\b.{0,25}\b(?:preciso|precisamos)\s+repor\b/.test(
      normalized,
    ) ||
    /\babaixo\b.{0,30}\bminimo\b.{0,30}\bsem\s+pedidos?\b/.test(
      normalized,
    ) ||
    /\bo\s+que\s+falta\s+comprar\s+hoje\b/.test(normalized) ||
    /\blista\s+recomendada\s+de\s+compra\b/.test(normalized);
  const asksCodeRecommendation =
    Boolean(queryCode) &&
    (/\bquanto\b.{0,25}\bpreciso\s+comprar\b/.test(normalized) ||
      /\bpreciso\s+comprar\b/.test(normalized) ||
      /\bja\s+esta\b.{0,18}\bpedidos?\b/.test(normalized) ||
      /\bcompra\s+pendente\b/.test(normalized));

  if (asksCodeRecommendation && queryCode) {
    return {
      kind: "QUERY",
      mode: "code",
      queryCode,
      codeIntent:
        /\b(?:ja\s+esta|compra\s+pendente)\b/.test(normalized)
          ? "pending"
          : "recommendation",
    };
  }

  if (asksMissingMinimum) {
    return {
      kind: "QUERY",
      mode: "missing_minimum",
      queryCode: null,
      codeIntent: null,
    };
  }

  if (asksAlreadyOrdered) {
    return {
      kind: "QUERY",
      mode: "already_ordered",
      queryCode: null,
      codeIntent: null,
    };
  }

  if (asksBuyNow) {
    return {
      kind: "QUERY",
      mode: "buy_now",
      queryCode: null,
      codeIntent: null,
    };
  }

  return null;
}
