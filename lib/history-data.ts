import { createClient } from "@/lib/supabase/server";
import {
  getHistoryBalanceLabel,
  historyItemTypeLabels,
  historyPageSize,
  isUuid,
  movementSources,
  movementTypes,
  type HistoryAssemblyOperation,
  type HistoryBatchDetail,
  type HistoryBatchListItem,
  type HistoryConfiguration,
  type HistoryConfigurationMovement,
  type HistoryDetailResult,
  type HistoryFilters,
  type HistoryInboundLine,
  type HistoryItem,
  type HistoryListResult,
  type HistoryOutboundLine,
  type HistorySearchParams,
  type HistoryStockMovement,
  type MovementSource,
  type MovementType,
} from "@/lib/history-types";
import type { PhysicalItemType } from "@/lib/inbound-types";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type MovementBatchRow = {
  id: string;
  movement_type: MovementType;
  source: MovementSource;
  description: string | null;
  user_name_snapshot: string | null;
  reversed_batch_id: string | null;
  occurred_at: string;
};

type InboundLineRow = {
  id: string;
  batch_id: string;
  item_id: string | null;
  commercial_configuration_code_id: string | null;
  quantity: number;
  created_at: string;
};

type OutboundLineRow = InboundLineRow & {
  assembled_quantity_used: number;
  auto_assembled_quantity: number;
};

type StockMovementRow = {
  id: string;
  batch_id: string;
  item_id: string;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  created_at: string;
};

type ConfigurationMovementRow = {
  id: string;
  batch_id: string;
  configuration_id: string;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  created_at: string;
};

type AssemblyOperationRow = {
  id: string;
  batch_id: string;
  configuration_id: string;
  operation_type: "ASSEMBLY" | "DISASSEMBLY";
  quantity: number;
  created_at: string;
};

type ItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: PhysicalItemType;
};

type CommercialCodeRow = {
  id: string;
  configuration_id: string;
  code: string;
};

type ConfigurationRow = {
  id: string;
  description: string | null;
  servo_id: string;
  installation_kit_id: string;
};

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

function escapeLikePattern(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

async function fetchBatchPage(
  supabase: SupabaseClient,
  filters: HistoryFilters,
  page: number,
) {
  let query = supabase
    .from("movement_batches")
    .select(
      "id, movement_type, source, description, user_name_snapshot, reversed_batch_id, occurred_at",
      { count: "exact" },
    );

  if (filters.type !== "ALL") {
    query = query.eq("movement_type", filters.type);
  }

  if (filters.source !== "ALL") {
    query = query.eq("source", filters.source);
  }

  if (filters.dateFromIso) {
    query = query.gte("occurred_at", filters.dateFromIso);
  }

  if (filters.dateToExclusiveIso) {
    query = query.lt("occurred_at", filters.dateToExclusiveIso);
  }

  if (filters.user) {
    query = query.ilike(
      "user_name_snapshot",
      `%${escapeLikePattern(filters.user)}%`,
    );
  }

  if (filters.query) {
    query = isUuid(filters.query)
      ? query.eq("id", filters.query)
      : query.ilike(
          "description",
          `%${escapeLikePattern(filters.query)}%`,
        );
  }

  const start = (page - 1) * historyPageSize;

  return query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + historyPageSize - 1);
}

function groupByBatch<T extends { batch_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();

  rows.forEach((row) => {
    const batchRows = grouped.get(row.batch_id) ?? [];
    batchRows.push(row);
    grouped.set(row.batch_id, batchRows);
  });

  return grouped;
}

function pluralized(
  quantity: number,
  singular: string,
  plural: string,
) {
  return `${quantity} ${quantity === 1 ? singular : plural}`;
}

function buildBatchSummary(
  inboundLines: InboundLineRow[],
  outboundLines: OutboundLineRow[],
  stockMovements: StockMovementRow[],
  configurationMovements: ConfigurationMovementRow[],
  assemblyOperations: AssemblyOperationRow[],
) {
  if (inboundLines.length > 0) {
    const physicalLines = inboundLines.filter((line) => line.item_id);
    const commercialLines = inboundLines.filter(
      (line) => line.commercial_configuration_code_id,
    );
    const physicalQuantity = physicalLines.reduce(
      (total, line) => total + line.quantity,
      0,
    );
    const commercialQuantity = commercialLines.reduce(
      (total, line) => total + line.quantity,
      0,
    );

    if (physicalLines.length > 0 && commercialLines.length > 0) {
      return [
        pluralized(
          physicalLines.length,
          "item separado",
          "itens separados",
        ),
        pluralized(
          commercialQuantity,
          "caixa com kit",
          "caixas com kit",
        ),
      ].join(" · ");
    }

    if (commercialLines.length > 0) {
      return [
        pluralized(
          commercialLines.length,
          "código comercial",
          "códigos comerciais",
        ),
        pluralized(
          commercialQuantity,
          "caixa com kit",
          "caixas com kit",
        ),
      ].join(" · ");
    }

    return [
      pluralized(
        physicalLines.length,
        "item separado",
        "itens separados",
      ),
      pluralized(physicalQuantity, "unidade", "unidades"),
    ].join(" · ");
  }

  if (outboundLines.length > 0) {
    const physicalLines = outboundLines.filter((line) => line.item_id);
    const commercialLines = outboundLines.filter(
      (line) => line.commercial_configuration_code_id,
    );
    const physicalQuantity = physicalLines.reduce(
      (total, line) => total + line.quantity,
      0,
    );
    const commercialQuantity = commercialLines.reduce(
      (total, line) => total + line.quantity,
      0,
    );
    const autoAssembledQuantity = commercialLines.reduce(
      (total, line) => total + line.auto_assembled_quantity,
      0,
    );
    const segments: string[] = [];

    if (physicalLines.length > 0) {
      segments.push(
        pluralized(
          physicalLines.length,
          "item separado",
          "itens separados",
        ),
      );

      if (commercialLines.length === 0) {
        segments.push(pluralized(physicalQuantity, "unidade", "unidades"));
      }
    }

    if (commercialLines.length > 0) {
      segments.push(
        pluralized(
          commercialLines.length,
          "código comercial",
          "códigos comerciais",
        ),
      );
      segments.push(
        pluralized(commercialQuantity, "caixa solicitada", "caixas solicitadas"),
      );
    }

    if (autoAssembledQuantity > 0) {
      segments.push(
        pluralized(
          autoAssembledQuantity,
          "montagem automática",
          "montagens automáticas",
        ),
      );
    }

    return segments.join(" · ");
  }

  const fallbackSegments: string[] = [];

  if (stockMovements.length > 0) {
    fallbackSegments.push(
      pluralized(
        stockMovements.length,
        "saldo físico alterado",
        "saldos físicos alterados",
      ),
    );
  }

  if (configurationMovements.length > 0) {
    fallbackSegments.push(
      pluralized(
        configurationMovements.length,
        "movimento em caixa",
        "movimentos em caixas",
      ),
    );
  }

  if (
    fallbackSegments.length === 0 &&
    assemblyOperations.length > 0
  ) {
    fallbackSegments.push(
      pluralized(
        assemblyOperations.length,
        "operação de montagem",
        "operações de montagem",
      ),
    );
  }

  return fallbackSegments.join(" · ") || "Sem impacto detalhado registrado";
}

export async function loadHistoryList(
  filters: HistoryFilters,
): Promise<HistoryListResult> {
  try {
    const supabase = await createClient();
    let currentPage = filters.page;
    let batchesResult = await fetchBatchPage(supabase, filters, currentPage);

    if (batchesResult.error) {
      return {
        data: null,
        error: "Não foi possível carregar o histórico agora.",
      };
    }

    const totalResults = batchesResult.count ?? 0;
    const totalPages = Math.max(
      1,
      Math.ceil(totalResults / historyPageSize),
    );

    if (currentPage > totalPages) {
      currentPage = totalPages;
      batchesResult = await fetchBatchPage(supabase, filters, currentPage);

      if (batchesResult.error) {
        return {
          data: null,
          error: "Não foi possível carregar o histórico agora.",
        };
      }
    }

    const batches = (batchesResult.data ?? []) as MovementBatchRow[];
    const batchIds = batches.map((batch) => batch.id);

    if (batchIds.length === 0) {
      return {
        data: {
          batches: [],
          pagination: {
            currentPage,
            totalPages,
            totalResults,
            pageSize: historyPageSize,
          },
        },
        error: null,
      };
    }

    const [
      inboundResult,
      outboundResult,
      stockResult,
      configurationResult,
      assemblyResult,
    ] = await Promise.all([
      supabase
        .from("inbound_batch_lines")
        .select(
          "id, batch_id, item_id, commercial_configuration_code_id, quantity, created_at",
        )
        .in("batch_id", batchIds),
      supabase
        .from("outbound_batch_lines")
        .select(
          "id, batch_id, item_id, commercial_configuration_code_id, quantity, assembled_quantity_used, auto_assembled_quantity, created_at",
        )
        .in("batch_id", batchIds),
      supabase
        .from("stock_movements")
        .select(
          "id, batch_id, item_id, quantity_change, quantity_before, quantity_after, created_at",
        )
        .in("batch_id", batchIds),
      supabase
        .from("configuration_stock_movements")
        .select(
          "id, batch_id, configuration_id, quantity_change, quantity_before, quantity_after, created_at",
        )
        .in("batch_id", batchIds),
      supabase
        .from("assembly_operations")
        .select(
          "id, batch_id, configuration_id, operation_type, quantity, created_at",
        )
        .in("batch_id", batchIds),
    ]);

    const relatedError = [
      inboundResult.error,
      outboundResult.error,
      stockResult.error,
      configurationResult.error,
      assemblyResult.error,
    ].find(Boolean);

    if (relatedError) {
      return {
        data: null,
        error: "Não foi possível carregar o histórico agora.",
      };
    }

    const inboundByBatch = groupByBatch(
      (inboundResult.data ?? []) as InboundLineRow[],
    );
    const outboundByBatch = groupByBatch(
      (outboundResult.data ?? []) as OutboundLineRow[],
    );
    const stockByBatch = groupByBatch(
      (stockResult.data ?? []) as StockMovementRow[],
    );
    const configurationByBatch = groupByBatch(
      (configurationResult.data ?? []) as ConfigurationMovementRow[],
    );
    const assemblyByBatch = groupByBatch(
      (assemblyResult.data ?? []) as AssemblyOperationRow[],
    );
    const listItems: HistoryBatchListItem[] = batches.map((batch) => ({
      id: batch.id,
      movementType: batch.movement_type,
      source: batch.source,
      description: batch.description,
      userName: batch.user_name_snapshot,
      reversedBatchId: batch.reversed_batch_id,
      occurredAt: batch.occurred_at,
      summary: buildBatchSummary(
        inboundByBatch.get(batch.id) ?? [],
        outboundByBatch.get(batch.id) ?? [],
        stockByBatch.get(batch.id) ?? [],
        configurationByBatch.get(batch.id) ?? [],
        assemblyByBatch.get(batch.id) ?? [],
      ),
    }));

    return {
      data: {
        batches: listItems,
        pagination: {
          currentPage,
          totalPages,
          totalResults,
          pageSize: historyPageSize,
        },
      },
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar o histórico agora.",
    };
  }
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function chunks(values: string[], size = 100) {
  const result: string[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

async function fetchItemsByIds(
  supabase: SupabaseClient,
  ids: string[],
) {
  if (ids.length === 0) {
    return { data: [] as ItemRow[], error: null };
  }

  const results = await Promise.all(
    chunks(ids).map((group) =>
      supabase
        .from("items")
        .select("id, code, description, item_type")
        .in("id", group),
    ),
  );

  return {
    data: results.flatMap((result) => (result.data ?? []) as ItemRow[]),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

async function fetchCodesByIds(
  supabase: SupabaseClient,
  ids: string[],
) {
  if (ids.length === 0) {
    return { data: [] as CommercialCodeRow[], error: null };
  }

  const results = await Promise.all(
    chunks(ids).map((group) =>
      supabase
        .from("commercial_configuration_codes")
        .select("id, configuration_id, code")
        .in("id", group),
    ),
  );

  return {
    data: results.flatMap(
      (result) => (result.data ?? []) as CommercialCodeRow[],
    ),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

async function fetchCodesByConfigurationIds(
  supabase: SupabaseClient,
  ids: string[],
) {
  if (ids.length === 0) {
    return { data: [] as CommercialCodeRow[], error: null };
  }

  const results = await Promise.all(
    chunks(ids).map((group) =>
      supabase
        .from("commercial_configuration_codes")
        .select("id, configuration_id, code")
        .in("configuration_id", group),
    ),
  );

  return {
    data: results.flatMap(
      (result) => (result.data ?? []) as CommercialCodeRow[],
    ),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

async function fetchConfigurationsByIds(
  supabase: SupabaseClient,
  ids: string[],
) {
  if (ids.length === 0) {
    return { data: [] as ConfigurationRow[], error: null };
  }

  const results = await Promise.all(
    chunks(ids).map((group) =>
      supabase
        .from("commercial_configurations")
        .select("id, description, servo_id, installation_kit_id")
        .in("id", group),
    ),
  );

  return {
    data: results.flatMap(
      (result) => (result.data ?? []) as ConfigurationRow[],
    ),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

function compareCodes(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function toHistoryItem(item: ItemRow): HistoryItem {
  return {
    id: item.id,
    code: item.code,
    description: item.description,
    itemType: item.item_type,
    typeLabel: historyItemTypeLabels[item.item_type],
    balanceLabel: getHistoryBalanceLabel(item.item_type),
  };
}

function historyDetailError(): HistoryDetailResult {
  return {
    status: "error",
    data: null,
    error: "Não foi possível carregar os detalhes deste lote agora.",
  };
}

export async function loadHistoryBatch(
  batchId: string,
): Promise<HistoryDetailResult> {
  try {
    const supabase = await createClient();
    const batchResult = await supabase
      .from("movement_batches")
      .select(
        "id, movement_type, source, description, user_name_snapshot, reversed_batch_id, occurred_at",
      )
      .eq("id", batchId)
      .maybeSingle();

    if (batchResult.error) {
      return historyDetailError();
    }

    if (!batchResult.data) {
      return { status: "not-found", data: null, error: null };
    }

    const batch = batchResult.data as MovementBatchRow;
    const [
      inboundResult,
      outboundResult,
      stockResult,
      configurationResult,
      assemblyResult,
    ] = await Promise.all([
      supabase
        .from("inbound_batch_lines")
        .select(
          "id, batch_id, item_id, commercial_configuration_code_id, quantity, created_at",
        )
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("outbound_batch_lines")
        .select(
          "id, batch_id, item_id, commercial_configuration_code_id, quantity, assembled_quantity_used, auto_assembled_quantity, created_at",
        )
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("stock_movements")
        .select(
          "id, batch_id, item_id, quantity_change, quantity_before, quantity_after, created_at",
        )
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("configuration_stock_movements")
        .select(
          "id, batch_id, configuration_id, quantity_change, quantity_before, quantity_after, created_at",
        )
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("assembly_operations")
        .select(
          "id, batch_id, configuration_id, operation_type, quantity, created_at",
        )
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ]);

    const relatedError = [
      inboundResult.error,
      outboundResult.error,
      stockResult.error,
      configurationResult.error,
      assemblyResult.error,
    ].find(Boolean);

    if (relatedError) {
      return historyDetailError();
    }

    const inboundRows = (inboundResult.data ?? []) as InboundLineRow[];
    const outboundRows = (outboundResult.data ?? []) as OutboundLineRow[];
    const stockRows = (stockResult.data ?? []) as StockMovementRow[];
    const configurationRows = (configurationResult.data ??
      []) as ConfigurationMovementRow[];
    const assemblyRows = (assemblyResult.data ??
      []) as AssemblyOperationRow[];
    const selectedCodeIds = unique([
      ...inboundRows.map(
        (line) => line.commercial_configuration_code_id,
      ),
      ...outboundRows.map(
        (line) => line.commercial_configuration_code_id,
      ),
    ]);
    const selectedCodesResult = await fetchCodesByIds(
      supabase,
      selectedCodeIds,
    );

    if (selectedCodesResult.error) {
      return historyDetailError();
    }

    const configurationIds = unique([
      ...configurationRows.map((movement) => movement.configuration_id),
      ...assemblyRows.map((operation) => operation.configuration_id),
      ...selectedCodesResult.data.map((code) => code.configuration_id),
    ]);
    const configurationsResult = await fetchConfigurationsByIds(
      supabase,
      configurationIds,
    );

    if (configurationsResult.error) {
      return historyDetailError();
    }

    const itemIds = unique([
      ...inboundRows.map((line) => line.item_id),
      ...outboundRows.map((line) => line.item_id),
      ...stockRows.map((movement) => movement.item_id),
      ...configurationsResult.data.flatMap((configuration) => [
        configuration.servo_id,
        configuration.installation_kit_id,
      ]),
    ]);
    const [itemsResult, allCodesResult] = await Promise.all([
      fetchItemsByIds(supabase, itemIds),
      fetchCodesByConfigurationIds(supabase, configurationIds),
    ]);

    if (itemsResult.error || allCodesResult.error) {
      return historyDetailError();
    }

    const itemById = new Map(
      itemsResult.data.map((item) => [item.id, toHistoryItem(item)]),
    );
    const selectedCodeById = new Map(
      selectedCodesResult.data.map((code) => [code.id, code]),
    );
    const codesByConfigurationId = new Map<string, string[]>();

    allCodesResult.data.forEach((code) => {
      const codes = codesByConfigurationId.get(code.configuration_id) ?? [];
      codes.push(code.code);
      codesByConfigurationId.set(code.configuration_id, codes);
    });

    codesByConfigurationId.forEach((codes) => codes.sort(compareCodes));

    const configurationById = new Map<string, HistoryConfiguration>();

    for (const configuration of configurationsResult.data) {
      const servo = itemById.get(configuration.servo_id);
      const installationKit = itemById.get(
        configuration.installation_kit_id,
      );

      if (!servo || !installationKit) {
        return historyDetailError();
      }

      configurationById.set(configuration.id, {
        id: configuration.id,
        description:
          configuration.description?.trim() ||
          `${servo.description} + ${installationKit.code}`,
        codes: codesByConfigurationId.get(configuration.id) ?? [],
        servo: {
          id: servo.id,
          code: servo.code,
          description: servo.description,
        },
        installationKit: {
          id: installationKit.id,
          code: installationKit.code,
          description: installationKit.description,
        },
      });
    }

    const inboundLines: HistoryInboundLine[] = [];

    for (const line of inboundRows) {
      if (line.item_id) {
        const item = itemById.get(line.item_id);

        if (!item) {
          return historyDetailError();
        }

        inboundLines.push({
          id: line.id,
          kind: "ITEM",
          quantity: line.quantity,
          item,
        });
      } else if (line.commercial_configuration_code_id) {
        const code = selectedCodeById.get(
          line.commercial_configuration_code_id,
        );
        const configuration = code
          ? configurationById.get(code.configuration_id)
          : null;

        if (!code || !configuration) {
          return historyDetailError();
        }

        inboundLines.push({
          id: line.id,
          kind: "COMMERCIAL_CODE",
          quantity: line.quantity,
          commercialCode: code.code,
          configuration,
        });
      }
    }

    const outboundLines: HistoryOutboundLine[] = [];

    for (const line of outboundRows) {
      if (line.item_id) {
        const item = itemById.get(line.item_id);

        if (!item) {
          return historyDetailError();
        }

        outboundLines.push({
          id: line.id,
          kind: "ITEM",
          quantity: line.quantity,
          item,
        });
      } else if (line.commercial_configuration_code_id) {
        const code = selectedCodeById.get(
          line.commercial_configuration_code_id,
        );
        const configuration = code
          ? configurationById.get(code.configuration_id)
          : null;

        if (!code || !configuration) {
          return historyDetailError();
        }

        outboundLines.push({
          id: line.id,
          kind: "COMMERCIAL_CODE",
          quantity: line.quantity,
          assembledQuantityUsed: line.assembled_quantity_used,
          autoAssembledQuantity: line.auto_assembled_quantity,
          commercialCode: code.code,
          configuration,
        });
      }
    }

    inboundLines.sort((first, second) => {
      const firstCode =
        first.kind === "ITEM" ? first.item.code : first.commercialCode;
      const secondCode =
        second.kind === "ITEM" ? second.item.code : second.commercialCode;
      return compareCodes(firstCode, secondCode) || first.id.localeCompare(second.id);
    });
    outboundLines.sort((first, second) => {
      const firstCode =
        first.kind === "ITEM" ? first.item.code : first.commercialCode;
      const secondCode =
        second.kind === "ITEM" ? second.item.code : second.commercialCode;
      return compareCodes(firstCode, secondCode) || first.id.localeCompare(second.id);
    });

    const stockMovements: HistoryStockMovement[] = [];

    for (const movement of stockRows) {
      const item = itemById.get(movement.item_id);

      if (!item) {
        return historyDetailError();
      }

      stockMovements.push({
        id: movement.id,
        item,
        quantityBefore: movement.quantity_before,
        quantityChange: movement.quantity_change,
        quantityAfter: movement.quantity_after,
      });
    }

    stockMovements.sort(
      (first, second) =>
        compareCodes(first.item.code, second.item.code) ||
        first.id.localeCompare(second.id),
    );

    const configurationMovements: HistoryConfigurationMovement[] = [];
    const movementSequenceByConfigurationId = new Map<string, number>();

    for (const movement of configurationRows) {
      const configuration = configurationById.get(
        movement.configuration_id,
      );

      if (!configuration) {
        return historyDetailError();
      }

      const sequence =
        (movementSequenceByConfigurationId.get(movement.configuration_id) ??
          0) + 1;
      movementSequenceByConfigurationId.set(
        movement.configuration_id,
        sequence,
      );
      configurationMovements.push({
        id: movement.id,
        sequence,
        configuration,
        quantityBefore: movement.quantity_before,
        quantityChange: movement.quantity_change,
        quantityAfter: movement.quantity_after,
      });
    }

    const assemblyOperations: HistoryAssemblyOperation[] = [];

    for (const operation of assemblyRows) {
      const configuration = configurationById.get(
        operation.configuration_id,
      );

      if (!configuration) {
        return historyDetailError();
      }

      assemblyOperations.push({
        id: operation.id,
        operationType: operation.operation_type,
        quantity: operation.quantity,
        configuration,
        isAutomaticOutboundAssembly:
          batch.movement_type === "OUTBOUND" &&
          operation.operation_type === "ASSEMBLY",
      });
    }

    const detail: HistoryBatchDetail = {
      id: batch.id,
      movementType: batch.movement_type,
      source: batch.source,
      description: batch.description,
      userName: batch.user_name_snapshot,
      reversedBatchId: batch.reversed_batch_id,
      occurredAt: batch.occurred_at,
      inboundLines,
      outboundLines,
      stockMovements,
      configurationMovements,
      assemblyOperations,
    };

    return { status: "found", data: detail, error: null };
  } catch {
    return historyDetailError();
  }
}
