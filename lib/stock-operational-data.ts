import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { SharedCatalogSnapshot } from "@/lib/shared-catalog";
import { fetchAllSupabaseRows } from "@/lib/supabase-read-pagination";
import { logPerformanceAudit } from "@/lib/performance-audit";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type StockBalanceRow = {
  item_id: string;
  quantity: number;
};

export type ConfigurationStockBalanceRow = {
  configuration_id: string;
  quantity: number;
};

export type ItemMinimumStockRow = {
  id: string;
  minimum_stock: number;
};

export type ConfigurationMinimumStockRow = {
  id: string;
  minimum_stock: number;
};

export function buildFreshMinimumStockMaps(
  snapshot: Pick<SharedCatalogSnapshot, "items" | "configurations">,
  itemMinimums: ItemMinimumStockRow[],
  configurationMinimums: ConfigurationMinimumStockRow[],
) {
  const itemMinimumById = new Map(
    itemMinimums.map((row) => [row.id, row.minimum_stock]),
  );
  const configurationMinimumById = new Map(
    configurationMinimums.map((row) => [row.id, row.minimum_stock]),
  );

  // A persistent structural snapshot can briefly outlive an out-of-band
  // catalog deletion. Never turn a missing fresh minimum into a false zero.
  if (
    snapshot.items.some((item) => !itemMinimumById.has(item.id)) ||
    snapshot.configurations.some(
      (configuration) => !configurationMinimumById.has(configuration.id),
    )
  ) {
    throw new Error("Fresh minimum stock data does not match the catalog.");
  }

  return { itemMinimumById, configurationMinimumById };
}

export async function loadFreshStockBalances(
  supabase: Pick<SupabaseClient, "from">,
) {
  const startedAt = performance.now();
  const [stockBalancesResult, configurationBalancesResult] = await Promise.all([
    fetchAllSupabaseRows<StockBalanceRow>(
      (from, to) =>
        supabase
          .from("stock_balances")
          .select("item_id, quantity")
          .order("item_id")
          .range(from, to),
      (row) => row.item_id,
    ),
    fetchAllSupabaseRows<ConfigurationStockBalanceRow>(
      (from, to) =>
        supabase
          .from("configuration_stock_balances")
          .select("configuration_id, quantity")
          .order("configuration_id")
          .range(from, to),
      (row) => row.configuration_id,
    ),
  ]);

  logPerformanceAudit({ loader: "stock", phase: "fresh_balances", durationMs: Math.round(performance.now() - startedAt), streamCount: 2, waveCount: 1, rowCount: (stockBalancesResult.data?.length ?? 0) + (configurationBalancesResult.data?.length ?? 0) });
  return {
    stockBalancesResult,
    configurationBalancesResult,
  };
}

export async function loadFreshMinimumStocks(
  supabase: Pick<SupabaseClient, "from">,
) {
  const startedAt = performance.now();
  const [itemMinimumsResult, configurationMinimumsResult] = await Promise.all([
    fetchAllSupabaseRows<ItemMinimumStockRow>(
      (from, to) =>
        supabase
          .from("items")
          .select("id, minimum_stock")
          .order("id")
          .range(from, to),
      (row) => row.id,
    ),
    fetchAllSupabaseRows<ConfigurationMinimumStockRow>(
      (from, to) =>
        supabase
          .from("commercial_configurations")
          .select("id, minimum_stock")
          .order("id")
          .range(from, to),
      (row) => row.id,
    ),
  ]);

  logPerformanceAudit({ loader: "stock", phase: "fresh_minimums", durationMs: Math.round(performance.now() - startedAt), streamCount: 2, waveCount: 1, rowCount: (itemMinimumsResult.data?.length ?? 0) + (configurationMinimumsResult.data?.length ?? 0) });
  return {
    itemMinimumsResult,
    configurationMinimumsResult,
  };
}
