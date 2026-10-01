import {
  type InventoryCommercialConfiguration,
  type InventoryDataResult,
  type InventoryPhysicalItem,
  type StockState,
} from "@/lib/inventory-types";
import {
  calculatePhysicalStockByItem,
  calculatePhysicalStockSummary,
  getConfigurationStockState,
  type PhysicalStockItemType,
} from "@/lib/stock-calculations";
import { isInventoryConfigurationVisible } from "@/lib/configuration-image-visibility";
import { createCompatibleKitImageMap } from "@/lib/compatible-kit-images";
import { customerFacingInventoryLabels } from "@/lib/customer-facing-inventory-labels";
import { loadSharedCatalogSnapshot } from "@/lib/shared-catalog";
import { logPerformanceAudit, performancePayloadBytes } from "@/lib/performance-audit";
import {
  buildFreshMinimumStockMaps,
  loadFreshMinimumStocks,
  loadFreshStockBalances,
} from "@/lib/stock-operational-data";
import { createClient } from "@/lib/supabase/server";
import { buildBundleInventory, loadBundleInventoryRows } from "@/lib/bundle-inventory";

type ItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: PhysicalStockItemType;
  minimum_stock: number;
  is_active: boolean;
};

type ServoModelRow = {
  item_id: string;
  model: string | null;
};

type StockBalanceRow = {
  item_id: string;
  quantity: number;
};

type CommercialConfigurationRow = {
  id: string;
  description: string | null;
  servo_id: string;
  installation_kit_id: string;
  is_active: boolean;
  image_path: string | null;
  minimum_stock: number;
};

type CommercialConfigurationCodeRow = {
  id: string;
  configuration_id: string;
  code: string;
  is_active: boolean;
};

type ConfigurationBalanceRow = {
  configuration_id: string;
  quantity: number;
};

type InventoryCommercialConfigurationDraft = Omit<
  InventoryCommercialConfiguration,
  "hasImage"
> & {
  imagePath: string | null;
};

const physicalItemTypeLabels: Record<PhysicalStockItemType, string> = {
  SERVO: customerFacingInventoryLabels.looseServo,
  INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Jogo de reparo",
  LOOSE_PART: "Peça avulsa",
};

function compareCodes(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function compareCodeAndId(
  firstCode: string,
  firstId: string,
  secondCode: string,
  secondId: string,
) {
  return compareCodes(firstCode, secondCode) || firstId.localeCompare(secondId);
}

function getStockState(looseQuantity: number, minimumStock: number): StockState {
  if (looseQuantity === 0) {
    return "ZERO";
  }

  if (
    looseQuantity > 0 &&
    minimumStock > 0 &&
    looseQuantity <= minimumStock
  ) {
    return "LOW";
  }

  return "AVAILABLE";
}

export async function loadInventoryData(): Promise<InventoryDataResult> {
  const startedAt = performance.now();
  try {
    const supabase = await createClient();
    const [snapshot, operationalState, minimumState, bundleRows] = await Promise.all([
      loadSharedCatalogSnapshot(),
      loadFreshStockBalances(supabase),
      loadFreshMinimumStocks(supabase),
      loadBundleInventoryRows(supabase),
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
        error: "Não foi possível carregar o catálogo de estoque agora.",
      };
    }

    const {
      itemMinimumById: minimumByItemId,
      configurationMinimumById: minimumByConfigurationId,
    } = buildFreshMinimumStockMaps(
      snapshot,
      itemMinimumsResult.data ?? [],
      configurationMinimumsResult.data ?? [],
    );
    const transformStartedAt = performance.now();
    const items: ItemRow[] = snapshot.items.map((item) => ({
      ...item,
      minimum_stock: minimumByItemId.get(item.id)!,
    }));
    const servoModels = snapshot.servoModels as ServoModelRow[];
    const stockBalances = (stockBalancesResult.data ?? []) as StockBalanceRow[];
    const configurations: CommercialConfigurationRow[] =
      snapshot.configurations.map((configuration) => ({
        ...configuration,
        minimum_stock: minimumByConfigurationId.get(configuration.id)!,
      }));
    const configurationCodes =
      snapshot.commercialCodes as CommercialConfigurationCodeRow[];
    const configurationBalances = (configurationBalancesResult.data ??
      []) as ConfigurationBalanceRow[];
    const activeItems = items.filter((item) => item.is_active);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const configurationIdsWithActiveCodes = new Set(
      configurationCodes
        .filter((code) => code.is_active)
        .map((code) => code.configuration_id),
    );
    const looseQuantityByItemId = new Map(
      stockBalances.map((balance) => [balance.item_id, balance.quantity]),
    );
    const servoModelByItemId = new Map(
      servoModels.map((servoModel) => [
        servoModel.item_id,
        servoModel.model?.trim() || null,
      ]),
    );
    const assembledByConfigurationId = new Map(
      configurationBalances.map((balance) => [
        balance.configuration_id,
        balance.quantity,
      ]),
    );
    const { bundles, embeddedItems, embeddedConfigurations } = buildBundleInventory(
      bundleRows, snapshot, looseQuantityByItemId, assembledByConfigurationId,
    );
    const physicalStockByItemId = calculatePhysicalStockByItem(
      activeItems.map((item) => ({
        id: item.id,
        itemType: item.item_type,
      })),
      stockBalances.map((balance) => ({
        itemId: balance.item_id,
        quantity: balance.quantity,
      })),
      configurations.map((configuration) => ({
        id: configuration.id,
        servoId: configuration.servo_id,
        installationKitId: configuration.installation_kit_id,
      })),
      configurationBalances.map((balance) => ({
        configurationId: balance.configuration_id,
        quantity: balance.quantity,
      })),
    );
    const physicalCatalog: InventoryPhysicalItem[] = activeItems.map((item) => {
      const quantities = physicalStockByItemId.get(item.id) ?? {
        looseQuantity: 0,
        mountedQuantity: 0,
        totalQuantity: 0,
      };

      return {
        id: item.id,
        code: item.code,
        description: item.description,
        itemType: item.item_type,
        typeLabel: physicalItemTypeLabels[item.item_type],
        model:
          item.item_type === "SERVO"
            ? (servoModelByItemId.get(item.id) ?? null)
            : null,
        minimumStock: item.minimum_stock,
        ...quantities,
        embeddedQuantity: embeddedItems.get(item.id) ?? 0,
        totalQuantity: quantities.totalQuantity + (embeddedItems.get(item.id) ?? 0),
        state: getStockState(quantities.looseQuantity, item.minimum_stock),
        compatibleKitImages: [],
      };
    });
    const summary = calculatePhysicalStockSummary(
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
      { items: embeddedItems, configurations: embeddedConfigurations },
      "loose",
    );
    summary.lowStockItems += bundles.filter(bundle => bundle.isActive && bundle.state === "LOW").length;
    summary.outOfStockItems += bundles.filter(bundle => bundle.isActive && bundle.state === "ZERO").length;
    const aliasesByConfigurationId = new Map<
      string,
      Array<{ code: string; isActive: boolean }>
    >();

    configurationCodes.forEach((configurationCode) => {
      const aliases =
        aliasesByConfigurationId.get(configurationCode.configuration_id) ?? [];
      aliases.push({
        code: configurationCode.code,
        isActive: configurationCode.is_active,
      });
      aliasesByConfigurationId.set(configurationCode.configuration_id, aliases);
    });

    const configurationCatalog: InventoryCommercialConfigurationDraft[] =
      configurations.flatMap((configuration) => {
        const servo = itemById.get(configuration.servo_id);
        const installationKit = itemById.get(
          configuration.installation_kit_id,
        );
        const aliases = (
          aliasesByConfigurationId.get(configuration.id) ?? []
        ).sort((first, second) => compareCodes(first.code, second.code));
        const activeAliases = aliases.filter((alias) => alias.isActive);
        const embeddedInBundlesQuantity = embeddedConfigurations.get(configuration.id) ?? 0;
        const assembledQuantity =
          assembledByConfigurationId.get(configuration.id) ?? 0;

        if (!servo || !installationKit || !isInventoryConfigurationVisible(
          configuration.is_active, servo, installationKit,
          activeAliases.length > 0, assembledQuantity + embeddedInBundlesQuantity,
        )) {
          return [];
        }

        const displayedAliases =
          activeAliases.length > 0 ? activeAliases : aliases;

        return [
          {
            id: configuration.id,
            codes: displayedAliases.map((alias) => alias.code),
            aliases,
            description:
              configuration.description?.trim() ||
              `${servo.description} + ${installationKit.code}`,
            imagePath: configuration.image_path,
            isActive: configuration.is_active,
            servo: {
              id: servo.id,
              code: servo.code,
              description: servo.description,
              model: servoModelByItemId.get(servo.id) ?? null,
              isActive: servo.is_active,
              looseQuantity: looseQuantityByItemId.get(servo.id) ?? 0,
            },
            installationKit: {
              id: installationKit.id,
              code: installationKit.code,
              description: installationKit.description,
              isActive: installationKit.is_active,
              looseQuantity:
                looseQuantityByItemId.get(installationKit.id) ?? 0,
            },
            assembledQuantity,
            embeddedInBundlesQuantity,
            totalPhysicalQuantity: assembledQuantity + embeddedInBundlesQuantity,
            minimumStock: configuration.minimum_stock,
            state: getConfigurationStockState(
              assembledQuantity,
              configuration.minimum_stock,
            ),
            hasAliases: aliases.length > 1,
          },
        ];
      });
    const sortedPhysicalItems = physicalCatalog.sort((first, second) =>
      compareCodeAndId(first.code, first.id, second.code, second.id),
    );
    const sortedConfigurationDrafts = configurationCatalog.sort(
      (first, second) =>
        compareCodeAndId(
          first.codes[0] ?? first.description,
          first.id,
          second.codes[0] ?? second.description,
          second.id,
        ),
    );
    logPerformanceAudit({ loader: "inventory", phase: "transform_before_images", durationMs: Math.round(performance.now() - transformStartedAt) });
    const catalogConfigurations: InventoryCommercialConfiguration[] =
      sortedConfigurationDrafts.map(({ imagePath, ...configuration }) => ({
        ...configuration,
        hasImage: Boolean(imagePath),
      }));
    const compatibleKitImagesByItemId = createCompatibleKitImageMap(
      sortedConfigurationDrafts.flatMap((configuration) => {
        const activeCodes = configuration.aliases
          .filter((alias) => alias.isActive)
          .map((alias) => alias.code);

        if (
          !configuration.imagePath ||
          !configuration.isActive ||
          !configuration.servo.isActive ||
          !configuration.installationKit.isActive ||
          activeCodes.length === 0
        ) {
          return [];
        }

        return [
          {
            installationKitId: configuration.installationKit.id,
            configurationId: configuration.id,
            commercialCodes: activeCodes,
            servoCode: configuration.servo.code,
            servoDescription: configuration.servo.description,
            servoModel: configuration.servo.model,
            installationKitCode: configuration.installationKit.code,
            description: configuration.description,
            hasImage: true as const,
          },
        ];
      }),
    );
    const physicalItemsWithImages = sortedPhysicalItems.map((item) => ({
      ...item,
      compatibleKitImages:
        item.itemType === "INSTALLATION_KIT"
          ? (compatibleKitImagesByItemId.get(item.id) ?? [])
          : [],
    }));

    const data = {
      summary,
      physicalItems: physicalItemsWithImages,
      configurations: catalogConfigurations,
      bundles,
      physicalCatalogCount: physicalCatalog.length,
      configurationCatalogCount: configurationCatalog.length,
    };
    logPerformanceAudit({ loader: "inventory", phase: "total", durationMs: Math.round(performance.now() - startedAt), rowCount: data.physicalItems.length + data.configurations.length + data.bundles.length, payloadBytes: performancePayloadBytes(data) });
    return { data, error: null };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar o catálogo de estoque agora.",
    };
  }
}
