import { createClient } from "@/lib/supabase/server";
import { loadSharedCatalogSnapshot } from "@/lib/shared-catalog";
import {
  buildFreshMinimumStockMaps,
  loadFreshMinimumStocks,
  loadFreshStockBalances,
} from "@/lib/stock-operational-data";
import {
  calculatePhysicalStockSummary,
  type PhysicalStockSummary,
} from "@/lib/stock-calculations";

type ItemType = "SERVO" | "INSTALLATION_KIT" | "REPAIR_KIT" | "LOOSE_PART";

type ItemRow = {
  id: string;
  item_type: ItemType;
  minimum_stock: number;
  is_active: boolean;
};

type StockBalanceRow = {
  item_id: string;
  quantity: number;
};

type CommercialConfigurationRow = {
  id: string;
  servo_id: string;
  installation_kit_id: string;
  minimum_stock: number;
  is_active: boolean;
};

type CommercialConfigurationCodeRow = {
  id: string;
  configuration_id: string;
  is_active: boolean;
};

type ConfigurationBalanceRow = {
  configuration_id: string;
  quantity: number;
};

export type StockSummary = PhysicalStockSummary;

export type HomeData = {
  summary: StockSummary;
};

export type HomeDataResult =
  | { data: HomeData; error: null }
  | { data: null; error: string };

function buildSummary(
  items: ItemRow[],
  stockBalances: StockBalanceRow[],
  configurations: CommercialConfigurationRow[],
  configurationCodes: CommercialConfigurationCodeRow[],
  configurationBalances: ConfigurationBalanceRow[],
): StockSummary {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const configurationIdsWithActiveCodes = new Set(
    configurationCodes
      .filter((code) => code.is_active)
      .map((code) => code.configuration_id),
  );

  return calculatePhysicalStockSummary(
    items.map((item) => ({
      id: item.id,
      itemType: item.item_type,
      minimumStock: item.minimum_stock,
      isActive: item.is_active,
    })),
    stockBalances.map((balance) => ({
      itemId: balance.item_id,
      quantity: balance.quantity,
    })),
    configurations.map((configuration) => ({
      id: configuration.id,
      servoId: configuration.servo_id,
      installationKitId: configuration.installation_kit_id,
      minimumStock: configuration.minimum_stock,
      isActive:
        configuration.is_active &&
        configurationIdsWithActiveCodes.has(configuration.id) &&
        itemById.get(configuration.servo_id)?.is_active === true &&
        itemById.get(configuration.installation_kit_id)?.is_active === true,
    })),
    configurationBalances.map((balance) => ({
      configurationId: balance.configuration_id,
      quantity: balance.quantity,
    })),
  );
}

export async function loadHomeData(): Promise<HomeDataResult> {
  try {
    const supabase = await createClient();
    const [snapshot, operationalState, minimumState] = await Promise.all([
      loadSharedCatalogSnapshot(),
      loadFreshStockBalances(supabase),
      loadFreshMinimumStocks(supabase),
    ]);
    const { stockBalancesResult, configurationBalancesResult } =
      operationalState;
    const { itemMinimumsResult, configurationMinimumsResult } = minimumState;

    const readError = [
      stockBalancesResult.error,
      configurationBalancesResult.error,
      itemMinimumsResult.error,
      configurationMinimumsResult.error,
    ].find(Boolean);

    if (readError) {
      return {
        data: null,
        error: "Não foi possível carregar os dados do estoque agora.",
      };
    }

    const { itemMinimumById, configurationMinimumById } =
      buildFreshMinimumStockMaps(
        snapshot,
        itemMinimumsResult.data ?? [],
        configurationMinimumsResult.data ?? [],
      );
    const items: ItemRow[] = snapshot.items.map((item) => ({
      id: item.id,
      item_type: item.item_type,
      minimum_stock: itemMinimumById.get(item.id)!,
      is_active: item.is_active,
    }));
    const stockBalances = (stockBalancesResult.data ?? []) as StockBalanceRow[];
    const configurations: CommercialConfigurationRow[] =
      snapshot.configurations.map((configuration) => ({
        id: configuration.id,
        servo_id: configuration.servo_id,
        installation_kit_id: configuration.installation_kit_id,
        minimum_stock: configurationMinimumById.get(configuration.id)!,
        is_active: configuration.is_active,
      }));
    const configurationCodes: CommercialConfigurationCodeRow[] =
      snapshot.commercialCodes.map((code) => ({
        id: code.id,
        configuration_id: code.configuration_id,
        is_active: code.is_active,
      }));
    const configurationBalances = (configurationBalancesResult.data ??
      []) as ConfigurationBalanceRow[];

    return {
      data: {
        summary: buildSummary(
          items,
          stockBalances,
          configurations,
          configurationCodes,
          configurationBalances,
        ),
      },
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar os dados do estoque agora.",
    };
  }
}
