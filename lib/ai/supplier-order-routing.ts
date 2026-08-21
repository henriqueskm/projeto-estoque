import type {
  SupplierOrderClosureKind,
  SupplierOrderStatus,
  SupplierOrderView,
} from "@/lib/supplier-orders-types";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export type SupplierOrderAggregateMetric =
  | "ORDER_COUNT"
  | "ORDERED_UNITS"
  | "PICKED_UNITS"
  | "WAITING_PICKUP_UNITS"
  | "WAITING_STOCK_UNITS";

export type SupplierOrderSort =
  | "ORDER_DATE_DESC"
  | "ORDER_DATE_ASC"
  | "WAITING_PICKUP_DESC"
  | "WAITING_STOCK_DESC";

export type SupplierOrderAssistantQuery = {
  mode: "LIST" | "DETAIL" | "AGGREGATE";
  view: SupplierOrderView | "all";
  negotiationNumber: string | null;
  supplierOrderId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  dateField: "order_date" | "closed_at";
  statuses: SupplierOrderStatus[];
  closureKinds: SupplierOrderClosureKind[];
  hasWaitingPickup: boolean | null;
  hasWaitingStock: boolean | null;
  fullyStockedAfterPickup: boolean | null;
  catalogCode: string | null;
  sort: SupplierOrderSort;
  aggregateMetric: SupplierOrderAggregateMetric | null;
  lineFocus: "ALL" | "WAITING_PICKUP" | "WAITING_STOCK";
  resultLimit: number;
  description: string;
};

export type SupplierOrderRoutingResult =
  | { kind: "NOT_ORDER_QUERY" }
  | {
      kind: "NEEDS_ORDER_CONTEXT";
      message: string;
    }
  | {
      kind: "ORDER_QUERY";
      query: SupplierOrderAssistantQuery;
    };

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const monthByName = new Map([
  ["janeiro", 1],
  ["fevereiro", 2],
  ["marco", 3],
  ["abril", 4],
  ["maio", 5],
  ["junho", 6],
  ["julho", 7],
  ["agosto", 8],
  ["setembro", 9],
  ["outubro", 10],
  ["novembro", 11],
  ["dezembro", 12],
]);

function formatIsoDate(date: CalendarDate) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function toUtcDate(date: CalendarDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function fromUtcDate(date: Date): CalendarDate {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addDays(date: CalendarDate, amount: number) {
  const result = toUtcDate(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return fromUtcDate(result);
}

function addMonths(date: CalendarDate, amount: number) {
  const result = new Date(Date.UTC(date.year, date.month - 1 + amount, 1));
  return fromUtcDate(result);
}

function endOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidDate(date: CalendarDate) {
  const parsed = toUtcDate(date);
  return (
    parsed.getUTCFullYear() === date.year &&
    parsed.getUTCMonth() + 1 === date.month &&
    parsed.getUTCDate() === date.day
  );
}

export function getSaoPauloCalendarDate(now = new Date()): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

function resolveNamedMonth(
  month: number,
  explicitYear: number | null,
  today: CalendarDate,
) {
  const year =
    explicitYear ??
    (month <= today.month ? today.year : today.year - 1);
  return {
    from: formatIsoDate({ year, month, day: 1 }),
    to: formatIsoDate({
      year,
      month,
      day: endOfMonth(year, month),
    }),
  };
}

function resolveDateRange(message: string, today: CalendarDate) {
  if (/\banteontem\b/.test(message)) {
    const date = formatIsoDate(addDays(today, -2));
    return { from: date, to: date, description: "de anteontem" };
  }

  if (/\bontem\b/.test(message)) {
    const date = formatIsoDate(addDays(today, -1));
    return { from: date, to: date, description: "de ontem" };
  }

  if (/\bhoje\b/.test(message)) {
    const date = formatIsoDate(today);
    return { from: date, to: date, description: "de hoje" };
  }

  const lastDays = message.match(
    /\b(?:ultimos?|nos ultimos?)\s+(\d{1,3})\s+dias?\b/,
  );
  if (lastDays) {
    const amount = Math.max(1, Number(lastDays[1]));
    return {
      from: formatIsoDate(addDays(today, -(amount - 1))),
      to: formatIsoDate(today),
      description: `dos últimos ${amount} dias`,
    };
  }

  if (/\besta semana\b|\bsemana atual\b/.test(message)) {
    const date = toUtcDate(today);
    const weekday = date.getUTCDay() || 7;
    return {
      from: formatIsoDate(addDays(today, -(weekday - 1))),
      to: formatIsoDate(today),
      description: "desta semana",
    };
  }

  if (/\bsemana passada\b|\bultima semana\b/.test(message)) {
    const date = toUtcDate(today);
    const weekday = date.getUTCDay() || 7;
    const currentMonday = addDays(today, -(weekday - 1));
    return {
      from: formatIsoDate(addDays(currentMonday, -7)),
      to: formatIsoDate(addDays(currentMonday, -1)),
      description: "da semana passada",
    };
  }

  const lastMonths = message.match(
    /\b(?:ultimos?|nos ultimos?)\s+(\d{1,2})\s+mes(?:es)?\b/,
  );
  if (lastMonths) {
    const amount = Math.max(1, Number(lastMonths[1]));
    const firstMonth = addMonths(today, -(amount - 1));
    return {
      from: formatIsoDate({
        year: firstMonth.year,
        month: firstMonth.month,
        day: 1,
      }),
      to: formatIsoDate(today),
      description: `dos últimos ${amount} meses`,
    };
  }

  if (/\beste mes\b|\bmes atual\b/.test(message)) {
    return {
      from: formatIsoDate({
        year: today.year,
        month: today.month,
        day: 1,
      }),
      to: formatIsoDate(today),
      description: "deste mês",
    };
  }

  if (/\bmes passado\b|\bultimo mes\b/.test(message)) {
    const previous = addMonths(today, -1);
    return {
      from: formatIsoDate({
        year: previous.year,
        month: previous.month,
        day: 1,
      }),
      to: formatIsoDate({
        year: previous.year,
        month: previous.month,
        day: endOfMonth(previous.year, previous.month),
      }),
      description: "do mês passado",
    };
  }

  const explicitRange = message.match(
    /\b(?:entre|de)\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(?:e|a|ate)\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/,
  );
  if (explicitRange) {
    const firstYear = normalizeYear(explicitRange[3], today.year);
    const secondYear = normalizeYear(explicitRange[6], firstYear);
    const first = {
      year: firstYear,
      month: Number(explicitRange[2]),
      day: Number(explicitRange[1]),
    };
    const second = {
      year: secondYear,
      month: Number(explicitRange[5]),
      day: Number(explicitRange[4]),
    };

    if (isValidDate(first) && isValidDate(second)) {
      return {
        from: formatIsoDate(first),
        to: formatIsoDate(second),
        description: `de ${explicitRange[1]}/${explicitRange[2]} a ${explicitRange[4]}/${explicitRange[5]}`,
      };
    }
  }

  const namedRange = message.match(
    /\b(?:entre|de)\s+(\d{1,2})\s+(?:e|a|ate)\s+(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (namedRange) {
    const month = monthByName.get(namedRange[3]);
    const year = Number(namedRange[4] || today.year);
    const first = { year, month: month ?? 0, day: Number(namedRange[1]) };
    const second = { year, month: month ?? 0, day: Number(namedRange[2]) };

    if (month && isValidDate(first) && isValidDate(second)) {
      return {
        from: formatIsoDate(first),
        to: formatIsoDate(second),
        description: `de ${namedRange[1]} a ${namedRange[2]} de ${namedRange[3]}`,
      };
    }
  }

  const fortnight = message.match(
    /\b(primeira|segunda)\s+quinzena\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (fortnight) {
    const month = monthByName.get(fortnight[2]);
    if (month) {
      const period = resolveNamedMonth(
        month,
        fortnight[3] ? Number(fortnight[3]) : null,
        today,
      );
      const year = Number(period.from.slice(0, 4));
      return {
        from: formatIsoDate({
          year,
          month,
          day: fortnight[1] === "primeira" ? 1 : 16,
        }),
        to: formatIsoDate({
          year,
          month,
          day:
            fortnight[1] === "primeira"
              ? 15
              : endOfMonth(year, month),
        }),
        description: `${fortnight[1]} quinzena de ${fortnight[2]}`,
      };
    }
  }

  const numericDate = message.match(
    /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/,
  );
  if (numericDate) {
    const date = {
      year: normalizeYear(numericDate[3], today.year),
      month: Number(numericDate[2]),
      day: Number(numericDate[1]),
    };
    if (isValidDate(date)) {
      const iso = formatIsoDate(date);
      return {
        from: iso,
        to: iso,
        description: `de ${numericDate[1]}/${numericDate[2]}/${date.year}`,
      };
    }
  }

  const namedDate = message.match(
    /\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (namedDate) {
    const month = monthByName.get(namedDate[2]);
    const date = {
      year: Number(namedDate[3] || today.year),
      month: month ?? 0,
      day: Number(namedDate[1]),
    };
    if (month && isValidDate(date)) {
      const iso = formatIsoDate(date);
      return {
        from: iso,
        to: iso,
        description: `de ${namedDate[1]} de ${namedDate[2]}`,
      };
    }
  }

  for (const [name, month] of monthByName) {
    const match = message.match(
      new RegExp(`\\b${name}(?:\\s+de\\s+(\\d{4}))?\\b`),
    );
    if (match) {
      const period = resolveNamedMonth(
        month,
        match[1] ? Number(match[1]) : null,
        today,
      );
      return {
        ...period,
        description: `de ${name}${match[1] ? ` de ${match[1]}` : ""}`,
      };
    }
  }

  return null;
}

function normalizeYear(rawYear: string | undefined, fallback: number) {
  if (!rawYear) {
    return fallback;
  }

  const year = Number(rawYear);
  return year < 100 ? 2000 + year : year;
}

export function normalizeNegotiationNumber(value: string) {
  const normalized = value
    .trim()
    .replace(/\s+/g, " ");

  if (
    !normalized ||
    normalized.length > 120 ||
    !/^[\p{L}\p{N} /-]+$/u.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function extractNegotiationNumber(rawMessage: string) {
  const searchableMessage = rawMessage.trim();
  const match = searchableMessage.match(
    /\b(?:pedido|negocia(?:ção|cao))\b(?:\s+(?:n|número|numero)\b)?\s*[º°#:]?\s*(.+?)(?=\s*,|\s*[?!.;]*$)/iu,
  );
  const withoutLeadingPreposition = match?.[1]
    ?.replace(/^(?:no|na|do|da|de)\s+/i, "")
    .trim();
  const candidate = withoutLeadingPreposition
    ? normalizeNegotiationNumber(withoutLeadingPreposition)
    : null;

  if (!candidate) {
    return null;
  }

  const normalizedCandidate = normalizeText(candidate);
  return /^(?:com|de|do|da|que|mais|maior|menor|recente|recentes|antigo|antigos|ativo|ativos|pendente|pendentes|parcial|parciais|concluido|concluidos|finalizado|finalizados|cancelado|cancelados|hoje|ontem)(?:\b|$)/i.test(
    normalizedCandidate,
  )
    ? null
    : candidate;
}

function extractCatalogCode(message: string) {
  const catalogCodePattern =
    "((?:[a-z]+\\s+\\d+)|(?=[a-z0-9-]*\\d)[a-z0-9]+(?:-[a-z0-9]+)*)";
  const explicitMatch = message.match(
    new RegExp(
      `\\b(?:codigo|item|produto)\\s+(?:do|da|de)?\\s*${catalogCodePattern}\\b`,
    ),
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1]
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleUpperCase("pt-BR");
  }

  const contextualPatterns = [
    new RegExp(
      `\\b(?:com|tenho|tem|temos|existe|aparece|possu(?:i|em)|inclu(?:i|em)|contem)\\s+(?:o\\s+|a\\s+)?${catalogCodePattern}\\b`,
    ),
    new RegExp(
      `\\b(?:pedi|solicitad[oa]s?|retirad[oa]s?|retirar)\\s+(?:do|da|de|o|a)?\\s*${catalogCodePattern}\\b`,
    ),
    new RegExp(
      `\\b(?:do|da|de)\\s+${catalogCodePattern}\\s+(?:nos?\\s+pedidos?|aguarda|aguardam|espera|esperam)\\b`,
    ),
  ];

  for (const pattern of contextualPatterns) {
    const match = message.match(pattern)?.[1];

    if (match) {
      return match
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleUpperCase("pt-BR");
    }
  }

  return null;
}

function isCatalogCodeFollowUp(message: string) {
  return (
    /^(?:e\s+)?quanto\b.{0,45}\b(pedi|pedido|solicitad[oa]s?|retirad[oa]s?|retirar|entrada|estoque)\b/.test(
      message,
    ) ||
    /^(?:e\s+)?(?:o\s+que|qual|quais|tem|existe)\b.{0,35}\b(retirad[oa]s?|entrada|falta)\b/.test(
      message,
    )
  );
}

function isSupplierOrderMessage(
  message: string,
  hasContext: boolean,
  hasCatalogContext: boolean,
) {
  return (
    /\b(pedido|pedidos|pedida|pedidas|negociacao|negociacoes|fornecedor|fornecedores)\b/.test(
      message,
    ) ||
    /\bparcialmente\s+retirados?\b/.test(message) ||
    /\b(?:o\s+que\s+)?falta\s+retirar\b/.test(message) ||
    /\b(?:o\s+que\s+)?foi\s+comprado\b/.test(message) ||
    /\bquanto\s+falta\s+(?:entrar|dar\s+entrada|colocar)\s+(?:no\s+)?estoque\b/.test(message) ||
    (hasContext && /^(?:e\s+)?(?:o\s+que\s+)?(?:ainda\s+)?falta\s+colocar\s+no\s+estoque\b/.test(message)) ||
    /\bquanto\s+(?:eu\s+)?pedi\b/.test(message) ||
    /\bquanto\b.{0,45}\b(retirad[oa]s?|retirar|aguarda(?:m)?\s+entrada)\b/.test(
      message,
    ) ||
    (hasCatalogContext && isCatalogCodeFollowUp(message)) ||
    (hasContext &&
      /^(?:e\s+)?(?:quais\s+)?itens?\b.{0,40}\b(falta|faltam|retirar|entrada)\b/.test(
        message,
      )) ||
    (hasContext &&
      /^(?:e\s+)?quanto\b.{0,35}\b(entrar|entrada|retirar|retirad[oa]s?|solicitad[oa]s?)\b/.test(
        message,
      )) ||
    (hasContext && /^(?:e\s+)?(?:entrar|entrada)(?:\s+no\s+estoque)?\b/.test(message)) ||
    (hasContext &&
      /\b(desse|deste|dessa|desta|daquele|daquela|dele|nele|esse|este)\b/.test(
        message,
      ) &&
      /\b(item|itens|retirad|estoque|entrada|falta|detalhe|abrir|abra|mostrar|mostre)\b/.test(
        message,
      ))
  );
}

export function routeSupplierOrderQuestion(
  rawMessage: string,
  supplierOrderId: string | null,
  now = new Date(),
  supplierOrderCatalogCode: string | null = null,
): SupplierOrderRoutingResult {
  const message = normalizeText(rawMessage);
  const hasContext = Boolean(supplierOrderId);
  const hasCatalogContext = Boolean(supplierOrderCatalogCode);

  if (
    !isSupplierOrderMessage(message, hasContext, hasCatalogContext)
  ) {
    return { kind: "NOT_ORDER_QUERY" };
  }

  const explicitNegotiation = extractNegotiationNumber(rawMessage);
  const extractedCatalogCode = extractCatalogCode(message);
  const catalogCode =
    extractedCatalogCode ??
    (supplierOrderCatalogCode && isCatalogCodeFollowUp(message)
      ? supplierOrderCatalogCode
      : null);
  const asksUnnamedOrderDetail =
    !explicitNegotiation &&
    /\bpedido\b/.test(message) &&
    !/\b(maior|menor|mais recente|mais antigo)\b/.test(message) &&
    /\b(detalhes?|itens?|composicao|falta|faltam|retirada|entrada|abrir|abra|mostrar|mostre)\b/.test(
      message,
    );
  const refersToCurrentOrder =
    /\b(desse|deste|dessa|desta|daquele|daquela|dele|nele|esse|este)\s+pedido\b/.test(
      message,
    ) ||
    /^(abra|abre|detalhe|detalhes|itens|o que falta|quanto falta)/.test(
      message,
    ) ||
    /^(?:e\s+)?(?:quais\s+)?itens?\b.{0,40}\b(falta|faltam|retirar|entrada)\b/.test(
      message,
    ) ||
    /^(?:e\s+)?quanto\b.{0,35}\b(entrar|entrada|retirar|retirad[oa]s?|solicitad[oa]s?)\b/.test(
      message,
    ) ||
    asksUnnamedOrderDetail;

  if (
    refersToCurrentOrder &&
    !explicitNegotiation &&
    !supplierOrderId &&
    !catalogCode
  ) {
    return {
      kind: "NEEDS_ORDER_CONTEXT",
      message:
        "Qual é o número da negociação do pedido que você quer consultar?",
    };
  }

  const dateRange = resolveDateRange(message, getSaoPauloCalendarDate(now));
  const statuses: SupplierOrderStatus[] = [];
  const closureKinds: SupplierOrderClosureKind[] = [];
  let view: SupplierOrderAssistantQuery["view"] = "all";

  if (
    (/\bpedidos?\b.{0,40}\bpendentes?\b|\bstatus\s+(?:esta\s+)?pendente\b/.test(
      message,
    ) &&
      !/\b(retirada|entrada)\b.{0,12}\bpendentes?\b/.test(message))
  ) {
    statuses.push("PENDING");
  }
  if (
    /\bpedidos?\b.{0,32}\bparciais?\b|\bstatus\s+(?:esta\s+)?parcial\b|\bretirada\s+parcial\b|\bparcialmente\s+retirados?\b/.test(
      message,
    )
  ) {
    statuses.push("PARTIAL");
  }
  if (
    /\bpedidos?\b.{0,32}\bconcluidos?\b|\bstatus\s+(?:esta\s+)?concluido\b/.test(
      message,
    )
  ) {
    statuses.push("COMPLETED");
  }
  if (/\bpedidos?\b.{0,32}\bcancelados?\b|\bstatus\s+(?:esta\s+)?cancelado\b/.test(message)) {
    statuses.push("CANCELLED");
    closureKinds.push("CANCELLED");
    view = "history";
  }
  if (/\bfinalizados?\b/.test(message)) {
    closureKinds.push("FINALIZED");
    view = "history";
  }
  if (/\bhistorico\b|\bencerrados?\b/.test(message)) view = "history";
  if (/\bativos?\b|\bem aberto\b|\bem andamento\b/.test(message)) {
    view = "active";
  }

  const hasWaitingPickup =
    /\b(aguardando|aguardam|pendente|pendentes|falta|faltam)\b.{0,35}\b(retirada|retirar|buscar)\b/.test(
      message,
    ) ||
    /\b(retirada|retirar|buscar)\b.{0,35}\b(aguardando|aguardam|pendente|pendentes|falta|faltam)\b/.test(
      message,
    )
      ? true
      : null;
  const fullyStockedAfterPickup =
    /\b(retirados?|retirada)\b.{0,45}\b(lancados?|entrada\s+concluida|ja\s+entraram)\b/.test(
      message,
    ) &&
    !/\b(nao|ainda)\b.{0,20}\b(lancados?|entrada)\b/.test(message)
      ? true
      : null;
  const hasWaitingStock =
    /\b(o que|quais?|quanto)\b.{0,40}\b(pode|podem)\b.{0,20}\b(entrar|entrada)\b/.test(
      message,
    ) ||
    /\b(ainda|algo)\b.{0,24}\b(entrar|entrada|lancar|lancado)\b/.test(
      message,
    ) ||
    /\b(aguardando|pendente|pendentes|falta|faltam)\b.{0,35}\b(entrada|estoque)\b/.test(
      message,
    ) ||
    /\b(entrada|estoque)\b.{0,35}\b(aguardando|pendente|pendentes|falta|faltam)\b/.test(
      message,
    ) ||
    /\b(retirados?|retirada)\b.{0,45}\b(ainda\s+nao|nao)\b.{0,20}\b(lancados?|estoque|entrada)\b/.test(
      message,
    ) ||
    /\b(falta|faltam)\b.{0,20}\b(entrar|entrada|colocar)\b.{0,20}\bestoque\b/.test(
      message,
    )
      ? true
      : null;

  const asksCount =
    /\b(quantos|quantas|total)\b/.test(message) &&
    /\b(pedidos?|unidades?)\b/.test(message);
  let aggregateMetric: SupplierOrderAggregateMetric | null = null;
  const catalogAggregateMetric =
    catalogCode &&
    (/\bquanto\b.{0,40}\b(aguarda|aguardam|entrada|estoque)\b/.test(
      message,
    ) ||
      /\b(aguarda|aguardam)\b.{0,30}\bentrada\b/.test(message))
      ? "WAITING_STOCK_UNITS"
      : catalogCode &&
          /\bquanto\b.{0,40}\b(falta|faltam|retirar)\b/.test(message)
        ? "WAITING_PICKUP_UNITS"
        : catalogCode &&
            /\bquanto\b.{0,40}\b(retirad[oa]s?)\b/.test(message)
          ? "PICKED_UNITS"
          : catalogCode &&
              /\bquanto\b.{0,40}\b(pedi|pedido|solicitad[oa]s?)\b/.test(
                message,
              )
            ? "ORDERED_UNITS"
            : null;

  if (catalogAggregateMetric) {
    aggregateMetric = catalogAggregateMetric;
  } else if (asksCount) {
    if (/\b(unidades?)\b/.test(message)) {
      aggregateMetric = hasWaitingStock
        ? "WAITING_STOCK_UNITS"
        : hasWaitingPickup
          ? "WAITING_PICKUP_UNITS"
          : /\bretirad[ao]s?\b/.test(message)
            ? "PICKED_UNITS"
            : "ORDERED_UNITS";
    } else {
      aggregateMetric = "ORDER_COUNT";
    }
  }

  const asksDetails =
    Boolean(explicitNegotiation) ||
    Boolean(supplierOrderId && refersToCurrentOrder) ||
    /\b(detalhes?|itens?|composicao|abrir|abra|mostre esse|mostrar esse)\b/.test(
      message,
    );
  const sort: SupplierOrderSort =
    /\bmaior\b.{0,30}\b(pendente|falta|retirada)\b/.test(message)
      ? "WAITING_PICKUP_DESC"
      : /\bmaior\b.{0,30}\b(entrada|estoque)\b/.test(message)
        ? "WAITING_STOCK_DESC"
        : /\bmais antigo|mais antigos|primeiros\b/.test(message)
          ? "ORDER_DATE_ASC"
          : "ORDER_DATE_DESC";
  const lineFocus: SupplierOrderAssistantQuery["lineFocus"] = hasWaitingStock
    ? "WAITING_STOCK"
    : hasWaitingPickup
      ? "WAITING_PICKUP"
      : "ALL";
  const requestedTop = message.match(
    /\b(?:os|as|top)?\s*(\d{1,2})\s+pedidos?\b/,
  )?.[1];
  const resultLimit = requestedTop
    ? Math.min(10, Math.max(1, Number(requestedTop)))
    : /\b(?:qual\s+(?:foi\s+)?o\s+)?pedido\s+(?:mais\s+)?(?:recente|antigo)\b|\bpedido\s+com\s+maior\b/.test(
          message,
        )
      ? 1
      : 10;
  const dateField =
    view === "history" &&
    /\b(encerrad|finalizad|cancelad)\b/.test(message)
      ? "closed_at"
      : "order_date";
  const descriptionParts = [
    catalogCode ? `Cód. ${catalogCode}` : null,
    view === "active"
      ? "ativos"
      : view === "history"
        ? "do histórico"
        : null,
    statuses.length > 0
      ? statuses
          .map((status) => ({
            PENDING: "pendentes",
            PARTIAL: "parciais",
            COMPLETED: "concluídos",
            CANCELLED: "cancelados",
          })[status])
          .join(", ")
      : null,
    closureKinds.length > 0
      ? closureKinds
          .map((closureKind) =>
            closureKind === "FINALIZED" ? "finalizados" : "cancelados",
          )
          .join(", ")
      : null,
    hasWaitingPickup ? "com retirada pendente" : null,
    hasWaitingStock ? "com entrada pendente" : null,
    fullyStockedAfterPickup ? "retirados e totalmente lançados" : null,
    dateRange?.description ?? null,
  ].filter(Boolean);

  return {
    kind: "ORDER_QUERY",
    query: {
      mode: explicitNegotiation
        ? "DETAIL"
        : aggregateMetric
          ? "AGGREGATE"
          : asksDetails
          ? "DETAIL"
          : "LIST",
      view,
      negotiationNumber: explicitNegotiation,
      supplierOrderId:
        !explicitNegotiation && refersToCurrentOrder
          ? supplierOrderId
          : null,
      dateFrom: dateRange?.from ?? null,
      dateTo: dateRange?.to ?? null,
      dateField,
      statuses: Array.from(new Set(statuses)),
      closureKinds: Array.from(new Set(closureKinds)),
      hasWaitingPickup,
      hasWaitingStock,
      fullyStockedAfterPickup,
      catalogCode,
      sort,
      aggregateMetric,
      lineFocus,
      resultLimit,
      description:
        descriptionParts.length > 0
          ? descriptionParts.join(" · ")
          : "todos os pedidos",
    },
  };
}
