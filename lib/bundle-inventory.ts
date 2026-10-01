import type { InventoryCommercialBundle } from "@/lib/inventory-types";
import type { SharedCatalogSnapshot } from "@/lib/shared-catalog";
import { getServoFamilyLabel } from "@/lib/inventory-family";
import { getConfigurationStockState } from "@/lib/stock-calculations";
import { fetchAllSupabaseRows } from "@/lib/supabase-read-pagination";
import type { createClient } from "@/lib/supabase/server";

export type BundleRow = {
  id: string;
  description: string;
  minimum_stock: number;
  is_active: boolean;
};
export type BundleCodeRow = {
  id: string;
  bundle_id: string;
  code: string;
  is_active: boolean;
};
export type BundleComponentRow = {
  bundle_id: string;
  item_id: string | null;
  configuration_id: string | null;
  quantity_per_bundle: number;
};
export type BundleBalanceRow = { bundle_id: string; quantity: number };

// Every table is paginated and read with the current authenticated client.
// Balances and minimums are deliberately request-fresh, with no persistent cache.
export async function loadBundleInventoryRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const [bundles, codes, components, balances] = await Promise.all([
    fetchAllSupabaseRows<BundleRow>(
      (from, to) =>
        supabase
          .from("commercial_bundles")
          .select("id, description, minimum_stock, is_active")
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
    fetchAllSupabaseRows<BundleComponentRow>(
      (from, to) =>
        supabase
          .from("commercial_bundle_components")
          .select("bundle_id, item_id, configuration_id, quantity_per_bundle")
          .order("bundle_id")
          .order("configuration_id")
          .order("item_id")
          .range(from, to),
      (row) =>
        `${row.bundle_id}:${row.configuration_id ? "CONFIGURATION" : "ITEM"}:${row.configuration_id ?? row.item_id}`,
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
  if ([bundles, codes, components, balances].some((result) => result.error))
    throw new Error("Não foi possível carregar os conjuntos.");
  return {
    bundles: bundles.data ?? [],
    codes: codes.data ?? [],
    components: components.data ?? [],
    balances: balances.data ?? [],
  };
}

export function buildBundleInventory(
  rows: {
    bundles: BundleRow[];
    codes: BundleCodeRow[];
    components: BundleComponentRow[];
    balances: BundleBalanceRow[];
  },
  snapshot: SharedCatalogSnapshot,
  itemBalances: Map<string, number>,
  configurationBalances: Map<string, number>,
) {
  const items = new Map(snapshot.items.map((item) => [item.id, item]));
  const configurations = new Map(
    snapshot.configurations.map((configuration) => [
      configuration.id,
      configuration,
    ]),
  );
  const models = new Map(
    snapshot.servoModels.map((model) => [model.item_id, model.model]),
  );
  const balances = new Map(
    rows.balances.map((balance) => [balance.bundle_id, balance.quantity]),
  );
  const componentsByBundle = new Map<string, BundleComponentRow[]>();
  const codesByBundle = new Map<string, BundleCodeRow[]>();
  const codesByConfiguration = new Map<
    string,
    typeof snapshot.commercialCodes
  >();
  for (const component of rows.components)
    componentsByBundle.set(component.bundle_id, [
      ...(componentsByBundle.get(component.bundle_id) ?? []),
      component,
    ]);
  for (const code of rows.codes)
    codesByBundle.set(code.bundle_id, [
      ...(codesByBundle.get(code.bundle_id) ?? []),
      code,
    ]);
  for (const code of snapshot.commercialCodes)
    codesByConfiguration.set(code.configuration_id, [
      ...(codesByConfiguration.get(code.configuration_id) ?? []),
      code,
    ]);
  const embeddedItems = new Map<string, number>();
  const embeddedConfigurations = new Map<string, number>();
  const add = (map: Map<string, number>, id: string, quantity: number) => {
    const total = (map.get(id) ?? 0) + quantity;
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error("Quantidade física de conjunto fora do limite seguro.");
    }
    map.set(id, total);
  };
  const bundles: InventoryCommercialBundle[] = rows.bundles.flatMap(
    (bundle) => {
      const readyQuantity = balances.get(bundle.id) ?? 0;
      const aliases = (codesByBundle.get(bundle.id) ?? [])
        .sort((a, b) =>
          a.code.localeCompare(b.code, "pt-BR", { numeric: true }),
        )
        .map((code) => ({ code: code.code, isActive: code.is_active }));
      const recipe = (componentsByBundle.get(bundle.id) ?? [])
        .map((component) => {
          const configuration = component.configuration_id
            ? configurations.get(component.configuration_id)
            : null;
          const item = component.item_id ? items.get(component.item_id) : null;
          const configurationCodes = configuration
            ? (codesByConfiguration.get(configuration.id) ?? [])
            : [];
          const servo = configuration
            ? items.get(configuration.servo_id)
            : null;
          const kit = configuration
            ? items.get(configuration.installation_kit_id)
            : null;
          if (
            (!item && !configuration) ||
            (configuration && (!servo || !kit)) ||
            component.quantity_per_bundle <= 0
          )
            throw new Error("Receita de conjunto incompleta.");
          const embedded = readyQuantity * component.quantity_per_bundle;
          if (configuration) {
            add(embeddedConfigurations, configuration.id, embedded);
            add(embeddedItems, configuration.servo_id, embedded);
            add(embeddedItems, configuration.installation_kit_id, embedded);
          } else if (item) add(embeddedItems, item.id, embedded);
          return {
            kind: configuration
              ? ("COMMERCIAL_CONFIGURATION" as const)
              : ("ITEM" as const),
            id: (configuration ?? item)!.id,
            code:
              item?.code ??
              configurationCodes.find((code) => code.is_active)?.code ??
              configurationCodes[0]?.code ??
              configuration!.description ??
              "Sem código",
            description:
              item?.description ??
              configuration!.description ??
              "Configuração comercial",
            quantityPerBundle: component.quantity_per_bundle,
            availableQuantity: configuration
              ? (configurationBalances.get(configuration.id) ?? 0)
              : (itemBalances.get(item!.id) ?? 0),
            isActive: configuration
              ? configuration.is_active &&
                !!servo?.is_active &&
                !!kit?.is_active &&
                configurationCodes.some((code) => code.is_active)
              : item!.is_active,
            family: servo
              ? getServoFamilyLabel(
                  models.get(servo.id) ?? null,
                  servo.description,
                )
              : null,
          };
        })
        .sort(
          (a, b) =>
            Number(b.kind === "COMMERCIAL_CONFIGURATION") -
              Number(a.kind === "COMMERCIAL_CONFIGURATION") ||
            a.code.localeCompare(b.code, "pt-BR", { numeric: true }),
        );
      if (recipe.length === 0) throw new Error("Conjunto sem receita.");
      const activeAliases = aliases.filter((alias) => alias.isActive);
      if (
        (!bundle.is_active ||
          !activeAliases.length ||
          recipe.some((component) => !component.isActive)) &&
        readyQuantity === 0
      )
        return [];
      return [
        {
          id: bundle.id,
          description: bundle.description,
          codes: (activeAliases.length ? activeAliases : aliases).map(
            (alias) => alias.code,
          ),
          aliases,
          isActive: bundle.is_active,
          readyQuantity,
          minimumStock: bundle.minimum_stock,
          state: getConfigurationStockState(
            readyQuantity,
            bundle.minimum_stock,
          ),
          maximumAssemblable: recipe.reduce(
            (maximum, component) =>
              Math.min(
                maximum,
                Math.floor(
                  component.availableQuantity / component.quantityPerBundle,
                ),
              ),
            2_147_483_647,
          ),
          recipe,
          family:
            recipe.find((component) => component.family)?.family ??
            "Outros conjuntos",
        },
      ];
    },
  );
  return { bundles, embeddedItems, embeddedConfigurations };
}
