import "server-only";

import type { AssistantCommercialBundleResult } from "@/lib/assistant-types";
import {
  buildBundleInventory,
  type BundleRow,
  type BundleCodeRow,
  type BundleComponentRow,
  type BundleBalanceRow,
} from "@/lib/bundle-inventory";
import type { SharedCatalogSnapshot } from "@/lib/shared-catalog";
import type { createClient } from "@/lib/supabase/server";
import {
  fetchAllSupabaseRows,
  fetchAllSupabaseRowsByChunks,
} from "@/lib/supabase-read-pagination";

type Client = Awaited<ReturnType<typeof createClient>>;
type ComponentSnapshot = {
  catalog: SharedCatalogSnapshot;
  itemBalances: Map<string, number>;
  configurationBalances: Map<string, number>;
};

// Uses only the caller's authenticated/RLS client. Exact queries fan out only to
// the requested recipes; balances/minimums are read fresh, never cached.
export async function loadAssistantBundles(
  client: Client,
  queryCodes?: string[],
  existing?: ComponentSnapshot,
): Promise<AssistantCommercialBundleResult[]> {
  const exactCodes = await fetchAllSupabaseRows<BundleCodeRow>(
    (from, to) => {
      const query = client
        .from("commercial_bundle_codes")
        .select("id, bundle_id, code, is_active")
        .eq("is_active", true);
      return (queryCodes ? query.in("code", queryCodes) : query)
        .order("id")
        .range(from, to);
    },
    (row) => row.id,
  );
  if (exactCodes.error) throw new Error("Catálogo de conjuntos indisponível.");
  const ids = [
    ...new Set((exactCodes.data ?? []).map((code) => code.bundle_id)),
  ];
  if (!ids.length) return [];
  const read = <T>(
    table: string,
    columns: string,
    key: string,
    values: string[],
    identity: (row: T) => string,
  ) =>
    fetchAllSupabaseRowsByChunks<string, T>(
      values,
      async (chunk, from, to) => {
        const result = await client
          .from(table)
          .select(columns)
          .in(key, chunk)
          .order(key)
          .order(columns.startsWith("id,") ? "id" : key)
          .range(from, to);
        return {
          data: result.data as unknown as T[] | null,
          error: result.error,
        };
      },
      identity,
    );
  const [bundles, codes, components, balances] = await Promise.all([
    read<BundleRow>(
      "commercial_bundles",
      "id, description, minimum_stock, is_active",
      "id",
      ids,
      (row) => row.id,
    ),
    read<BundleCodeRow>(
      "commercial_bundle_codes",
      "id, bundle_id, code, is_active",
      "bundle_id",
      ids,
      (row) => row.id,
    ),
    fetchAllSupabaseRowsByChunks<string, BundleComponentRow>(
      ids,
      (chunk, from, to) =>
        client
          .from("commercial_bundle_components")
          .select("bundle_id, item_id, configuration_id, quantity_per_bundle")
          .in("bundle_id", chunk)
          .order("bundle_id")
          .order("configuration_id")
          .order("item_id")
          .range(from, to),
      (row) => `${row.bundle_id}:${row.configuration_id ? "CONFIGURATION" : "ITEM"}:${row.configuration_id ?? row.item_id}`,
    ),
    read<BundleBalanceRow>(
      "bundle_stock_balances",
      "bundle_id, quantity",
      "bundle_id",
      ids,
      (row) => row.bundle_id,
    ),
  ]);
  if ([bundles, codes, components, balances].some((result) => result.error))
    throw new Error("Conjuntos indisponíveis.");
  const recipe = components.data ?? [];
  let snapshot = existing;
  if (!snapshot) {
    const configurationIds = [
      ...new Set(
        recipe.flatMap((component) =>
          component.configuration_id ? [component.configuration_id] : [],
        ),
      ),
    ];
    const [configurations, commercialCodes, configurationBalances] =
      await Promise.all([
        read<SharedCatalogSnapshot["configurations"][number]>(
          "commercial_configurations",
          "id, description, servo_id, installation_kit_id, is_active, image_path",
          "id",
          configurationIds,
          (row) => row.id,
        ),
        read<SharedCatalogSnapshot["commercialCodes"][number]>(
          "commercial_configuration_codes",
          "id, configuration_id, code, is_active",
          "configuration_id",
          configurationIds,
          (row) => row.id,
        ),
        read<{ configuration_id: string; quantity: number }>(
          "configuration_stock_balances",
          "configuration_id, quantity",
          "configuration_id",
          configurationIds,
          (row) => row.configuration_id,
        ),
      ]);
    const itemIds = [
      ...new Set([
        ...recipe.flatMap((component) =>
          component.item_id ? [component.item_id] : [],
        ),
        ...(configurations.data ?? []).flatMap((configuration) => [
          configuration.servo_id,
          configuration.installation_kit_id,
        ]),
      ]),
    ];
    const [items, itemBalances] = await Promise.all([
      read<SharedCatalogSnapshot["items"][number]>(
        "items",
        "id, code, description, item_type, is_active",
        "id",
        itemIds,
        (row) => row.id,
      ),
      read<{ item_id: string; quantity: number }>(
        "stock_balances",
        "item_id, quantity",
        "item_id",
        itemIds,
        (row) => row.item_id,
      ),
    ]);
    if (
      [
        configurations,
        commercialCodes,
        configurationBalances,
        items,
        itemBalances,
      ].some((result) => result.error)
    )
      throw new Error("Componentes indisponíveis.");
    snapshot = {
      catalog: {
        items: items.data ?? [],
        configurations: configurations.data ?? [],
        commercialCodes: commercialCodes.data ?? [],
        servoModels: [],
      },
      itemBalances: new Map(
        (itemBalances.data ?? []).map((balance) => [
          balance.item_id,
          balance.quantity,
        ]),
      ),
      configurationBalances: new Map(
        (configurationBalances.data ?? []).map((balance) => [
          balance.configuration_id,
          balance.quantity,
        ]),
      ),
    };
  }
  return buildBundleInventory(
    {
      bundles: bundles.data ?? [],
      codes: codes.data ?? [],
      components: recipe,
      balances: balances.data ?? [],
    },
    snapshot.catalog,
    snapshot.itemBalances,
    snapshot.configurationBalances,
  )
    .bundles.filter(
      (bundle) =>
        bundle.isActive && bundle.aliases.some((alias) => alias.isActive),
    )
    .map((bundle) => ({
      kind: "COMMERCIAL_BUNDLE",
      bundle_id: bundle.id,
      code: bundle.codes[0],
      aliases: bundle.aliases
        .filter((alias) => alias.isActive)
        .map((alias) => alias.code),
      description: bundle.description,
      ready_quantity: bundle.readyQuantity,
      minimum_stock: bundle.minimumStock,
      state: bundle.state,
      maximum_assemblable: bundle.recipe.every(
        (component) => component.isActive,
      )
        ? bundle.maximumAssemblable
        : 0,
      recipe: bundle.recipe.map((component) => ({
        kind: component.kind,
        id: component.id,
        code: component.code,
        description: component.description,
        quantity_per_bundle: component.quantityPerBundle,
        available_quantity: component.availableQuantity,
      })),
    }));
}
