import {
  calculateStatistics,
  createStatisticsRange,
  type StatisticsAssemblyOperationRow,
  type StatisticsBatchRow,
  type StatisticsCalculationInput,
  type StatisticsCommercialCodeRow,
  type StatisticsConfigurationBalanceRow,
  type StatisticsConfigurationMovementRow,
  type StatisticsConfigurationRow,
  type StatisticsInboundLineRow,
  type StatisticsItemRow,
  type StatisticsOutboundLineRow,
  type StatisticsStockBalanceRow,
  type StatisticsStockMovementRow,
} from "@/lib/statistics-calculations";
import { fetchAllStatisticsRows } from "@/lib/statistics-pagination";
import {
  statisticsPeriods,
  type StatisticsDataResult,
  type StatisticsPeriod,
  type StatisticsSearchParams,
} from "@/lib/statistics-types";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseStatisticsPeriod(
  searchParams: StatisticsSearchParams,
): StatisticsPeriod {
  const value = Number(firstValue(searchParams.periodo));

  return statisticsPeriods.includes(value as StatisticsPeriod)
    ? (value as StatisticsPeriod)
    : 90;
}

function chunks<T>(values: T[], size = 100) {
  const result: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

async function fetchRowsByBatchIds<T>(
  batchIds: string[],
  fetchChunk: (
    client: SupabaseClient,
    ids: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  client: SupabaseClient,
) {
  if (batchIds.length === 0) {
    return { data: [] as T[], error: null };
  }

  const results = await Promise.all(
    chunks(batchIds).map((ids) =>
      fetchAllStatisticsRows<T>((from, to) =>
        fetchChunk(client, ids, from, to),
      ),
    ),
  );

  return {
    data: results.flatMap((result) => (result.data ?? []) as T[]),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

function statisticsError(): StatisticsDataResult {
  return {
    data: null,
    error: "Não foi possível calcular as estatísticas agora.",
  };
}

export async function loadStatisticsData(
  period: StatisticsPeriod,
  now = new Date(),
): Promise<StatisticsDataResult> {
  try {
    const supabase = await createClient();
    const range = createStatisticsRange(period, now);
    const [
      batchesResult,
      itemsResult,
      configurationsResult,
      commercialCodesResult,
      stockBalancesResult,
      configurationBalancesResult,
    ] = await Promise.all([
      fetchAllStatisticsRows<StatisticsBatchRow>((from, to) =>
        supabase
          .from("movement_batches")
          .select("id, movement_type, occurred_at")
          .gte("occurred_at", range.previousStart.toISOString())
          .lt("occurred_at", range.currentEndExclusive.toISOString())
          .order("occurred_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllStatisticsRows<StatisticsItemRow>((from, to) =>
        supabase
          .from("items")
          .select(
            "id, code, description, item_type, minimum_stock, is_active",
          )
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllStatisticsRows<StatisticsConfigurationRow>((from, to) =>
        supabase
          .from("commercial_configurations")
          .select(
            "id, description, servo_id, installation_kit_id, minimum_stock, is_active",
          )
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllStatisticsRows<StatisticsCommercialCodeRow>((from, to) =>
        supabase
          .from("commercial_configuration_codes")
          .select("id, configuration_id, code, is_active")
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllStatisticsRows<StatisticsStockBalanceRow>((from, to) =>
        supabase
          .from("stock_balances")
          .select("item_id, quantity")
          .order("item_id", { ascending: true })
          .range(from, to),
      ),
      fetchAllStatisticsRows<StatisticsConfigurationBalanceRow>((from, to) =>
        supabase
          .from("configuration_stock_balances")
          .select("configuration_id, quantity")
          .order("configuration_id", { ascending: true })
          .range(from, to),
      ),
    ]);

    const initialError = [
      batchesResult.error,
      itemsResult.error,
      configurationsResult.error,
      commercialCodesResult.error,
      stockBalancesResult.error,
      configurationBalancesResult.error,
    ].find(Boolean);

    if (initialError) {
      return statisticsError();
    }

    const batches = (batchesResult.data ?? []) as StatisticsBatchRow[];
    const batchIds = batches.map((batch) => batch.id);
    const [
      inboundResult,
      outboundResult,
      stockMovementsResult,
      configurationMovementsResult,
      assemblyOperationsResult,
    ] = await Promise.all([
      fetchRowsByBatchIds<StatisticsInboundLineRow>(
        batchIds,
        (client, ids, from, to) =>
          client
            .from("inbound_batch_lines")
            .select(
              "id, batch_id, item_id, commercial_configuration_code_id, quantity",
            )
            .in("batch_id", ids)
            .order("batch_id", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        supabase,
      ),
      fetchRowsByBatchIds<StatisticsOutboundLineRow>(
        batchIds,
        (client, ids, from, to) =>
          client
            .from("outbound_batch_lines")
            .select(
              "id, batch_id, item_id, commercial_configuration_code_id, quantity, assembled_quantity_used, auto_assembled_quantity",
            )
            .in("batch_id", ids)
            .order("batch_id", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        supabase,
      ),
      fetchRowsByBatchIds<StatisticsStockMovementRow>(
        batchIds,
        (client, ids, from, to) =>
          client
            .from("stock_movements")
            .select("id, batch_id, item_id, quantity_change")
            .in("batch_id", ids)
            .order("batch_id", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        supabase,
      ),
      fetchRowsByBatchIds<StatisticsConfigurationMovementRow>(
        batchIds,
        (client, ids, from, to) =>
          client
            .from("configuration_stock_movements")
            .select("id, batch_id, configuration_id, quantity_change")
            .in("batch_id", ids)
            .order("batch_id", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        supabase,
      ),
      fetchRowsByBatchIds<StatisticsAssemblyOperationRow>(
        batchIds,
        (client, ids, from, to) =>
          client
            .from("assembly_operations")
            .select(
              "id, batch_id, configuration_id, operation_type, quantity, commercial_code_snapshot",
            )
            .in("batch_id", ids)
            .order("batch_id", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        supabase,
      ),
    ]);

    const historyError = [
      inboundResult.error,
      outboundResult.error,
      stockMovementsResult.error,
      configurationMovementsResult.error,
      assemblyOperationsResult.error,
    ].find(Boolean);

    if (historyError) {
      return statisticsError();
    }

    const input: StatisticsCalculationInput = {
      period,
      now,
      batches,
      inboundLines: inboundResult.data,
      outboundLines: outboundResult.data,
      stockMovements: stockMovementsResult.data,
      configurationMovements: configurationMovementsResult.data,
      assemblyOperations: assemblyOperationsResult.data,
      items: (itemsResult.data ?? []) as StatisticsItemRow[],
      configurations: (configurationsResult.data ??
        []) as StatisticsConfigurationRow[],
      commercialCodes: (commercialCodesResult.data ??
        []) as StatisticsCommercialCodeRow[],
      stockBalances: (stockBalancesResult.data ??
        []) as StatisticsStockBalanceRow[],
      configurationBalances: (configurationBalancesResult.data ??
        []) as StatisticsConfigurationBalanceRow[],
    };

    return { data: calculateStatistics(input), error: null };
  } catch {
    return statisticsError();
  }
}
