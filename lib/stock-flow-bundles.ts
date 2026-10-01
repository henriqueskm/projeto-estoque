import type { StockFlowBundleCode } from "@/lib/inbound-types";
import type {
  BundleRow,
  BundleCodeRow,
  BundleBalanceRow,
} from "@/lib/bundle-inventory";
import { fetchAllSupabaseRows } from "@/lib/supabase-read-pagination";
import type { createClient } from "@/lib/supabase/server";

// Ready bundles are received/shipped independently of their recipe. No component
// availability is used here, and operational balances are always read fresh.
export async function loadStockFlowBundleCodes(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<StockFlowBundleCode[]> {
  const [bundles, codes, balances] = await Promise.all([
    fetchAllSupabaseRows<Omit<BundleRow, "minimum_stock">>(
      (from, to) =>
        supabase
          .from("commercial_bundles")
          .select("id, description, is_active")
          .order("id")
          .range(from, to),
      (row) => row.id,
    ),
    fetchAllSupabaseRows<BundleCodeRow>(
      (from, to) =>
        supabase
          .from("commercial_bundle_codes")
          .select("id, bundle_id, code, is_active")
          .order("id")
          .range(from, to),
      (row) => row.id,
    ),
    fetchAllSupabaseRows<BundleBalanceRow>(
      (from, to) =>
        supabase
          .from("bundle_stock_balances")
          .select("bundle_id, quantity")
          .order("bundle_id")
          .range(from, to),
      (row) => row.bundle_id,
    ),
  ]);
  if ([bundles, codes, balances].some((result) => result.error))
    throw new Error("Não foi possível carregar os conjuntos.");
  const byId = new Map(
    (bundles.data ?? []).map((bundle) => [bundle.id, bundle]),
  );
  const balanceById = new Map(
    (balances.data ?? []).map((balance) => [
      balance.bundle_id,
      balance.quantity,
    ]),
  );
  const activeCodes = (codes.data ?? []).filter(
    (code) => code.is_active && byId.get(code.bundle_id)?.is_active,
  );
  const aliasesByBundle = new Map<string, string[]>();
  for (const code of activeCodes) {
    const aliases = aliasesByBundle.get(code.bundle_id) ?? [];
    aliases.push(code.code);
    aliasesByBundle.set(code.bundle_id, aliases);
  }
  return activeCodes
    .map((code) => ({
      kind: "BUNDLE_CODE" as const,
      bundleCodeId: code.id,
      bundleId: code.bundle_id,
      code: code.code,
      description: byId.get(code.bundle_id)!.description,
      readyBalance: balanceById.get(code.bundle_id) ?? 0,
      aliases: aliasesByBundle.get(code.bundle_id) ?? [],
    }))
    .sort((first, second) =>
      first.code.localeCompare(second.code, "pt-BR", { numeric: true }),
    );
}
