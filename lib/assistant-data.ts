import "server-only";

import {
  assistantQueryMaxLength,
  type AssistantCommercialConfigurationResult,
  type AssistantItemLookupResult,
  type AssistantLowStockResult,
  type AssistantPhysicalItemResult,
  type AssistantStockAttentionItem,
  type AssistantStockSummaryResult,
} from "@/lib/assistant-types";
import { loadHomeData } from "@/lib/home-data";
import {
  calculatePhysicalStockByItem,
  getConfigurationStockState,
  type PhysicalStockItemType,
} from "@/lib/stock-calculations";
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
  minimum_stock: number;
  is_active: boolean;
};

type CommercialConfigurationCodeRow = {
  configuration_id: string;
  code: string;
  is_active: boolean;
};

type ConfigurationBalanceRow = {
  configuration_id: string;
  quantity: number;
};

type RepairCompatibilityRow = {
  servo_id: string;
  repair_kit_id: string;
};

type AssistantStockSnapshot = {
  items: ItemRow[];
  servoModels: ServoModelRow[];
  stockBalances: StockBalanceRow[];
  configurations: CommercialConfigurationRow[];
  configurationCodes: CommercialConfigurationCodeRow[];
  configurationBalances: ConfigurationBalanceRow[];
  repairCompatibilities: RepairCompatibilityRow[];
};

export class AssistantDataError extends Error {
  constructor() {
    super("Assistant stock data is unavailable.");
    this.name = "AssistantDataError";
  }
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function compareCodes(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function getLookupResultCode(
  result: AssistantPhysicalItemResult | AssistantCommercialConfigurationResult,
) {
  return result.kind === "COMMERCIAL_CONFIGURATION"
    ? result.matched_commercial_code
    : result.code;
}

function matchesSearch(
  normalizedQuery: string,
  values: Array<string | null | undefined>,
) {
  return values.some((value) =>
    value ? normalizeSearch(value).includes(normalizedQuery) : false,
  );
}

async function loadAssistantStockSnapshot(): Promise<AssistantStockSnapshot> {
  const supabase = await createClient();
  const [
    itemsResult,
    servoModelsResult,
    stockBalancesResult,
    configurationsResult,
    configurationCodesResult,
    configurationBalancesResult,
    repairCompatibilitiesResult,
  ] = await Promise.all([
    supabase
      .from("items")
      .select("id, code, description, item_type, minimum_stock, is_active"),
    supabase.from("servo_models").select("item_id, model"),
    supabase.from("stock_balances").select("item_id, quantity"),
    supabase
      .from("commercial_configurations")
      .select(
        "id, description, servo_id, installation_kit_id, minimum_stock, is_active",
      ),
    supabase
      .from("commercial_configuration_codes")
      .select("configuration_id, code, is_active"),
    supabase
      .from("configuration_stock_balances")
      .select("configuration_id, quantity"),
    supabase
      .from("servo_repair_compatibility")
      .select("servo_id, repair_kit_id"),
  ]);

  const readError = [
    itemsResult.error,
    servoModelsResult.error,
    stockBalancesResult.error,
    configurationsResult.error,
    configurationCodesResult.error,
    configurationBalancesResult.error,
    repairCompatibilitiesResult.error,
  ].find(Boolean);

  if (readError) {
    throw new AssistantDataError();
  }

  return {
    items: (itemsResult.data ?? []) as ItemRow[],
    servoModels: (servoModelsResult.data ?? []) as ServoModelRow[],
    stockBalances: (stockBalancesResult.data ?? []) as StockBalanceRow[],
    configurations: (configurationsResult.data ??
      []) as CommercialConfigurationRow[],
    configurationCodes: (configurationCodesResult.data ??
      []) as CommercialConfigurationCodeRow[],
    configurationBalances: (configurationBalancesResult.data ??
      []) as ConfigurationBalanceRow[],
    repairCompatibilities: (repairCompatibilitiesResult.data ??
      []) as RepairCompatibilityRow[],
  };
}

function buildLookupCatalog(snapshot: AssistantStockSnapshot) {
  const activeItems = snapshot.items.filter((item) => item.is_active);
  const activeItemById = new Map(activeItems.map((item) => [item.id, item]));
  const modelByItemId = new Map(
    snapshot.servoModels.map((servo) => [
      servo.item_id,
      servo.model?.trim() || null,
    ]),
  );
  const looseQuantityByItemId = new Map(
    snapshot.stockBalances.map((balance) => [
      balance.item_id,
      balance.quantity,
    ]),
  );
  const assembledQuantityByConfigurationId = new Map(
    snapshot.configurationBalances.map((balance) => [
      balance.configuration_id,
      balance.quantity,
    ]),
  );
  const physicalStockByItemId = calculatePhysicalStockByItem(
    activeItems.map((item) => ({
      id: item.id,
      itemType: item.item_type,
    })),
    snapshot.stockBalances.map((balance) => ({
      itemId: balance.item_id,
      quantity: balance.quantity,
    })),
    snapshot.configurations.map((configuration) => ({
      id: configuration.id,
      servoId: configuration.servo_id,
      installationKitId: configuration.installation_kit_id,
    })),
    snapshot.configurationBalances.map((balance) => ({
      configurationId: balance.configuration_id,
      quantity: balance.quantity,
    })),
  );
  const activeAliasesByConfigurationId = new Map<string, string[]>();

  snapshot.configurationCodes
    .filter((code) => code.is_active)
    .forEach((code) => {
      const aliases =
        activeAliasesByConfigurationId.get(code.configuration_id) ?? [];
      aliases.push(code.code);
      activeAliasesByConfigurationId.set(code.configuration_id, aliases);
    });

  activeAliasesByConfigurationId.forEach((aliases) =>
    aliases.sort(compareCodes),
  );

  const physicalItems: AssistantPhysicalItemResult[] = activeItems.map(
    (item) => {
      const quantities = physicalStockByItemId.get(item.id) ?? {
        looseQuantity: 0,
        mountedQuantity: 0,
        totalQuantity: 0,
      };
      const base = {
        kind: item.item_type,
        item_id: item.id,
        code: item.code,
        description: item.description,
        minimum_stock: item.minimum_stock,
        loose_quantity: quantities.looseQuantity,
      } as const;

      if (item.item_type === "SERVO") {
        return {
          ...base,
          model: modelByItemId.get(item.id) ?? null,
          mounted_quantity: quantities.mountedQuantity,
          total_quantity: quantities.totalQuantity,
        };
      }

      if (item.item_type === "INSTALLATION_KIT") {
        return {
          ...base,
          mounted_quantity: quantities.mountedQuantity,
          total_quantity: quantities.totalQuantity,
        };
      }

      if (item.item_type === "REPAIR_KIT") {
        const compatibleServos = snapshot.repairCompatibilities
          .filter((compatibility) => compatibility.repair_kit_id === item.id)
          .flatMap((compatibility) => {
            const servo = activeItemById.get(compatibility.servo_id);

            if (servo?.item_type !== "SERVO") {
              return [];
            }

            return [
              {
                code: servo.code,
                description: servo.description,
                model: modelByItemId.get(servo.id) ?? null,
              },
            ];
          })
          .sort((first, second) => compareCodes(first.code, second.code));

        return {
          ...base,
          compatible_servos: compatibleServos,
        };
      }

      return base;
    },
  );

  const configurations: AssistantCommercialConfigurationResult[] =
    snapshot.configurations.flatMap((configuration) => {
      const servo = activeItemById.get(configuration.servo_id);
      const installationKit = activeItemById.get(
        configuration.installation_kit_id,
      );
      const aliases =
        activeAliasesByConfigurationId.get(configuration.id) ?? [];

      if (
        !configuration.is_active ||
        servo?.item_type !== "SERVO" ||
        installationKit?.item_type !== "INSTALLATION_KIT" ||
        aliases.length === 0
      ) {
        return [];
      }

      const servoLooseQuantity = looseQuantityByItemId.get(servo.id) ?? 0;
      const kitLooseQuantity =
        looseQuantityByItemId.get(installationKit.id) ?? 0;

      return [
        {
          kind: "COMMERCIAL_CONFIGURATION" as const,
          configuration_id: configuration.id,
          matched_commercial_code: aliases[0],
          aliases,
          description:
            configuration.description?.trim() ||
            `${servo.description} + ${installationKit.code}`,
          servo: {
            code: servo.code,
            description: servo.description,
            model: modelByItemId.get(servo.id) ?? null,
            loose_quantity: servoLooseQuantity,
          },
          installation_kit: {
            code: installationKit.code,
            description: installationKit.description,
            loose_quantity: kitLooseQuantity,
          },
          assembled_quantity:
            assembledQuantityByConfigurationId.get(configuration.id) ?? 0,
          maximum_assemblable: Math.min(
            servoLooseQuantity,
            kitLooseQuantity,
          ),
          minimum_stock: configuration.minimum_stock,
        },
      ];
    });

  return {
    activeItems,
    physicalItems,
    configurations,
    modelByItemId,
    physicalStockByItemId,
    activeAliasesByConfigurationId,
    assembledQuantityByConfigurationId,
  };
}

export async function consultAssistantItem(
  rawQuery: string,
): Promise<AssistantItemLookupResult> {
  const query = rawQuery.trim();

  if (!query || query.length > assistantQueryMaxLength) {
    throw new AssistantDataError();
  }

  const normalizedQuery = normalizeSearch(query);
  const snapshot = await loadAssistantStockSnapshot();
  const { physicalItems, configurations } = buildLookupCatalog(snapshot);
  const exactPhysicalItems = physicalItems.filter(
    (item) => normalizeSearch(item.code) === normalizedQuery,
  );
  const exactConfigurations = configurations
    .filter((configuration) =>
      configuration.aliases.some(
        (alias) => normalizeSearch(alias) === normalizedQuery,
      ),
    )
    .map((configuration) => ({
      ...configuration,
      matched_commercial_code:
        configuration.aliases.find(
          (alias) => normalizeSearch(alias) === normalizedQuery,
        ) ?? configuration.aliases[0],
    }));
  const exactResults = [...exactPhysicalItems, ...exactConfigurations];

  if (exactResults.length > 0) {
    return {
      query,
      exact_code_match: true,
      results: exactResults,
    };
  }

  const matchingPhysicalItems = physicalItems.filter((item) =>
    matchesSearch(normalizedQuery, [
      item.code,
      item.description,
      item.model,
    ]),
  );
  const matchingConfigurations = configurations
    .filter((configuration) =>
      matchesSearch(normalizedQuery, [
        ...configuration.aliases,
        configuration.description,
        configuration.servo.code,
        configuration.servo.description,
        configuration.servo.model,
        configuration.installation_kit.code,
        configuration.installation_kit.description,
      ]),
    )
    .map((configuration) => ({
      ...configuration,
      matched_commercial_code:
        configuration.aliases.find((alias) =>
          normalizeSearch(alias).includes(normalizedQuery),
        ) ?? configuration.aliases[0],
    }));

  return {
    query,
    exact_code_match: false,
    results: [...matchingPhysicalItems, ...matchingConfigurations]
      .sort((first, second) =>
        compareCodes(getLookupResultCode(first), getLookupResultCode(second)),
      )
      .slice(0, 12),
  };
}

export async function consultAssistantStockSummary(): Promise<AssistantStockSummaryResult> {
  const result = await loadHomeData();

  if (result.error || !result.data) {
    throw new AssistantDataError();
  }

  return {
    complete_boxes: result.data.summary.completeBoxesTotal,
    loose_servos: result.data.summary.looseServoTotal,
    loose_installation_kits: result.data.summary.looseKitTotal,
    repair_kits: result.data.summary.repairKitTotal,
    loose_parts: result.data.summary.loosePartTotal,
    low_stock: result.data.summary.lowStockItems,
    out_of_stock: result.data.summary.outOfStockItems,
  };
}

export async function consultAssistantLowStock(): Promise<AssistantLowStockResult> {
  const snapshot = await loadAssistantStockSnapshot();
  const {
    activeItems,
    modelByItemId,
    physicalStockByItemId,
    activeAliasesByConfigurationId,
    assembledQuantityByConfigurationId,
  } = buildLookupCatalog(snapshot);
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  const attentionItems: AssistantStockAttentionItem[] = activeItems
    .flatMap((item) => {
      const currentQuantity =
        physicalStockByItemId.get(item.id)?.totalQuantity ?? 0;

      if (
        item.minimum_stock <= 0 ||
        currentQuantity > item.minimum_stock
      ) {
        return [];
      }

      return [
        {
          type: item.item_type,
          code: item.code,
          description:
            item.item_type === "SERVO" && modelByItemId.get(item.id)
              ? `${item.description} (${modelByItemId.get(item.id)})`
              : item.description,
          current_quantity: currentQuantity,
          minimum_stock: item.minimum_stock,
          status: currentQuantity === 0 ? ("ZERO" as const) : ("LOW" as const),
        },
      ];
    });

  snapshot.configurations.forEach((configuration) => {
    const aliases =
      activeAliasesByConfigurationId.get(configuration.id) ?? [];
    const servo = itemById.get(configuration.servo_id);
    const installationKit = itemById.get(configuration.installation_kit_id);
    const currentQuantity =
      assembledQuantityByConfigurationId.get(configuration.id) ?? 0;
    const state = getConfigurationStockState(
      currentQuantity,
      configuration.minimum_stock,
    );

    if (
      !configuration.is_active ||
      servo?.is_active !== true ||
      installationKit?.is_active !== true ||
      aliases.length === 0 ||
      configuration.minimum_stock <= 0 ||
      (state !== "LOW" && state !== "ZERO")
    ) {
      return;
    }

    attentionItems.push({
      type: "COMMERCIAL_CONFIGURATION",
      code: aliases[0],
      aliases,
      description:
        configuration.description?.trim() ||
        `${servo.description} + ${installationKit.code}`,
      current_quantity: currentQuantity,
      minimum_stock: configuration.minimum_stock,
      status: state,
    });
  });

  attentionItems.sort(
    (first, second) =>
      (first.status === second.status
        ? 0
        : first.status === "ZERO"
          ? -1
          : 1) || compareCodes(first.code, second.code),
  );

  return {
    count: attentionItems.length,
    items: attentionItems,
  };
}
