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
import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import { createClient } from "@/lib/supabase/server";

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
  "imageUrl"
> & {
  imagePath: string | null;
};

const physicalItemTypeLabels: Record<PhysicalStockItemType, string> = {
  SERVO: "Servoembreagem",
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

function getStockState(totalQuantity: number, minimumStock: number): StockState {
  if (totalQuantity === 0) {
    return "ZERO";
  }

  if (
    totalQuantity > 0 &&
    minimumStock > 0 &&
    totalQuantity <= minimumStock
  ) {
    return "LOW";
  }

  return "AVAILABLE";
}

export async function loadInventoryData(): Promise<InventoryDataResult> {
  try {
    const supabase = await createClient();
    const [
      itemsResult,
      servoModelsResult,
      stockBalancesResult,
      configurationsResult,
      configurationCodesResult,
      configurationBalancesResult,
    ] = await Promise.all([
      supabase
        .from("items")
        .select("id, code, description, item_type, minimum_stock, is_active"),
      supabase.from("servo_models").select("item_id, model"),
      supabase.from("stock_balances").select("item_id, quantity"),
      supabase
        .from("commercial_configurations")
        .select(
          "id, description, servo_id, installation_kit_id, is_active, image_path, minimum_stock",
        ),
      supabase
        .from("commercial_configuration_codes")
        .select("id, configuration_id, code, is_active"),
      supabase
        .from("configuration_stock_balances")
        .select("configuration_id, quantity"),
    ]);

    const readError = [
      itemsResult.error,
      servoModelsResult.error,
      stockBalancesResult.error,
      configurationsResult.error,
      configurationCodesResult.error,
      configurationBalancesResult.error,
    ].find(Boolean);

    if (readError) {
      return {
        data: null,
        error: "Não foi possível carregar o catálogo de estoque agora.",
      };
    }

    const items = (itemsResult.data ?? []) as ItemRow[];
    const servoModels = (servoModelsResult.data ?? []) as ServoModelRow[];
    const stockBalances = (stockBalancesResult.data ?? []) as StockBalanceRow[];
    const configurations = (configurationsResult.data ??
      []) as CommercialConfigurationRow[];
    const configurationCodes = (configurationCodesResult.data ??
      []) as CommercialConfigurationCodeRow[];
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
        state: getStockState(quantities.totalQuantity, item.minimum_stock),
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
    );
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
        const assembledQuantity =
          assembledByConfigurationId.get(configuration.id) ?? 0;

        if (
          servo?.item_type !== "SERVO" ||
          installationKit?.item_type !== "INSTALLATION_KIT" ||
          (assembledQuantity === 0 &&
            (!configuration.is_active ||
              !servo.is_active ||
              !installationKit.is_active ||
              activeAliases.length === 0))
        ) {
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
    const imageUrlByPath = await createCommercialImageUrlMap(
      supabase,
      sortedConfigurationDrafts.map(
        (configuration) => configuration.imagePath,
      ),
    );
    const catalogConfigurations: InventoryCommercialConfiguration[] =
      sortedConfigurationDrafts.map(({ imagePath, ...configuration }) => ({
        ...configuration,
        imageUrl: imagePath
          ? (imageUrlByPath.get(imagePath) ?? null)
          : null,
      }));

    return {
      data: {
        summary,
        physicalItems: sortedPhysicalItems,
        configurations: catalogConfigurations,
        physicalCatalogCount: physicalCatalog.length,
        configurationCatalogCount: configurationCatalog.length,
      },
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar o catálogo de estoque agora.",
    };
  }
}
