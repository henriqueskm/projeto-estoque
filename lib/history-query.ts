import { movementTypes, movementSources, type HistorySearchParams, type HistoryFilters } from "@/lib/history-types";

const datePartFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isOneOf<T extends string>(
  value: string | undefined,
  options: readonly T[],
): value is T {
  return value !== undefined && options.includes(value as T);
}

function parseCalendarDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { value, year, month, day };
}

function addCalendarDay(value: string) {
  const parsed = parseCalendarDate(value);

  if (!parsed) {
    return value;
  }

  const date = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1),
  );

  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function getZonedParts(date: Date) {
  const parts = Object.fromEntries(
    datePartFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function saoPauloStartIso(value: string) {
  const parsed = parseCalendarDate(value);

  if (!parsed) {
    return null;
  }

  const targetUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  let estimate = targetUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = getZonedParts(new Date(estimate));
    const representedUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    estimate += targetUtc - representedUtc;
  }

  return new Date(estimate).toISOString();
}

export function parseHistoryFilters(
  searchParams: HistorySearchParams,
): HistoryFilters {
  const typeValue = firstValue(searchParams.tipo);
  const sourceValue = firstValue(searchParams.origem);
  const rawDateFrom = firstValue(searchParams.dataInicial);
  const rawDateTo = firstValue(searchParams.dataFinal);
  const validDateFrom = parseCalendarDate(rawDateFrom);
  const validDateTo = parseCalendarDate(rawDateTo);
  const pageValue = firstValue(searchParams.pagina);
  const parsedPage =
    pageValue && /^\d+$/.test(pageValue) ? Number(pageValue) : 1;
  const dateFrom = validDateFrom?.value ?? "";
  let dateTo = validDateTo?.value ?? "";
  let dateRangeAdjusted =
    Boolean(rawDateFrom && !validDateFrom) || Boolean(rawDateTo && !validDateTo);

  if (dateFrom && dateTo && dateFrom > dateTo) {
    dateTo = dateFrom;
    dateRangeAdjusted = true;
  }

  return {
    type:
      typeValue === "ALL" || isOneOf(typeValue, movementTypes)
        ? typeValue
        : "ALL",
    source:
      sourceValue === "ALL" || isOneOf(sourceValue, movementSources)
        ? sourceValue
        : "ALL",
    dateFrom,
    dateTo,
    dateFromIso: dateFrom ? saoPauloStartIso(dateFrom) : null,
    dateToExclusiveIso: dateTo
      ? saoPauloStartIso(addCalendarDay(dateTo))
      : null,
    user: (firstValue(searchParams.usuario) ?? "").trim().slice(0, 100),
    query: (firstValue(searchParams.busca) ?? "").trim().slice(0, 100),
    page:
      Number.isSafeInteger(parsedPage) && parsedPage > 0
        ? Math.min(parsedPage, 1_000_000)
        : 1,
    dateRangeAdjusted,
  };
}

export function createHistoryHref(
  filters: HistoryFilters,
  page = filters.page,
) {
  const params = new URLSearchParams();

  if (filters.type !== "ALL") {
    params.set("tipo", filters.type);
  }

  if (filters.source !== "ALL") {
    params.set("origem", filters.source);
  }

  if (filters.dateFrom) {
    params.set("dataInicial", filters.dateFrom);
  }

  if (filters.dateTo) {
    params.set("dataFinal", filters.dateTo);
  }

  if (filters.user) {
    params.set("usuario", filters.user);
  }

  if (filters.query) {
    params.set("busca", filters.query);
  }

  if (page > 1) {
    params.set("pagina", String(page));
  }

  const query = params.toString();
  return query ? `/historico?${query}` : "/historico";
}
