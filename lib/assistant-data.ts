import "server-only";

import {
  assistantQueryMaxLength,
  type AssistantCatalogMediaBlock,
  type AssistantCatalogMediaTarget,
  type AssistantCommercialConfigurationResult,
  type AssistantInventoryAlertCard,
  type AssistantInventoryAlertsBlock,
  type AssistantItemLookupResult,
  type AssistantMediaDescriptor,
  type AssistantPhysicalItemResult,
  type AssistantStockAttentionItem,
  type AssistantStockSummaryResult,
} from "@/lib/assistant-types";
import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import {
  createCompatibleKitImageMap,
  type CompatibleKitImageOption,
} from "@/lib/compatible-kit-images";
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
  image_path: string | null;
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
        "id, description, servo_id, installation_kit_id, minimum_stock, is_active, image_path",
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

const physicalItemTypeLabels: Record<PhysicalStockItemType, string> = {
  SERVO: "Servoembreagem",
  INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Jogo de reparo",
  LOOSE_PART: "Peça avulsa",
};

type AssistantMediaMaps = {
  configurationImageById: Map<
    string,
    Extract<
      AssistantMediaDescriptor,
      { kind: "commercial_configuration_image" }
    >
  >;
  compatibleKitImagesByItemId: Map<string, CompatibleKitImageOption[]>;
};

async function buildAssistantMediaMaps(
  snapshot: AssistantStockSnapshot,
  requestedConfigurationIds: Set<string>,
  requestedInstallationKitIds: Set<string>,
): Promise<AssistantMediaMaps> {
  if (
    requestedConfigurationIds.size === 0 &&
    requestedInstallationKitIds.size === 0
  ) {
    return {
      configurationImageById: new Map(),
      compatibleKitImagesByItemId: new Map(),
    };
  }

  const activeItemById = new Map(
    snapshot.items
      .filter((item) => item.is_active)
      .map((item) => [item.id, item]),
  );
  const modelByItemId = new Map(
    snapshot.servoModels.map((servo) => [
      servo.item_id,
      servo.model?.trim() || null,
    ]),
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

  const relevantConfigurations = snapshot.configurations.filter(
    (configuration) => {
      const servo = activeItemById.get(configuration.servo_id);
      const installationKit = activeItemById.get(
        configuration.installation_kit_id,
      );

      return (
        Boolean(configuration.image_path) &&
        configuration.is_active &&
        servo?.item_type === "SERVO" &&
        installationKit?.item_type === "INSTALLATION_KIT" &&
        (activeAliasesByConfigurationId.get(configuration.id)?.length ?? 0) >
          0 &&
        (requestedConfigurationIds.has(configuration.id) ||
          requestedInstallationKitIds.has(configuration.installation_kit_id))
      );
    },
  );
  const supabase = await createClient();
  const imageUrlByPath = await createCommercialImageUrlMap(
    supabase,
    relevantConfigurations.map((configuration) => configuration.image_path),
  );
  const configurationImageById: AssistantMediaMaps["configurationImageById"] =
    new Map();
  const compatibleKitImagesByItemId = createCompatibleKitImageMap(
    relevantConfigurations.flatMap((configuration) => {
      const imageUrl = configuration.image_path
        ? (imageUrlByPath.get(configuration.image_path) ?? null)
        : null;
      const servo = activeItemById.get(configuration.servo_id);
      const installationKit = activeItemById.get(
        configuration.installation_kit_id,
      );
      const commercialCodes =
        activeAliasesByConfigurationId.get(configuration.id) ?? [];

      if (
        !imageUrl ||
        servo?.item_type !== "SERVO" ||
        installationKit?.item_type !== "INSTALLATION_KIT"
      ) {
        return [];
      }

      configurationImageById.set(configuration.id, {
        kind: "commercial_configuration_image",
        commercialCodes,
        imageUrl,
      });

      return [
        {
          installationKitId: installationKit.id,
          configurationId: configuration.id,
          commercialCodes,
          servoCode: servo.code,
          servoDescription: servo.description,
          servoModel: modelByItemId.get(servo.id) ?? null,
          installationKitCode: installationKit.code,
          description:
            configuration.description?.trim() ||
            `${servo.description} + ${installationKit.code}`,
          imageUrl,
        },
      ];
    }),
  );

  return {
    configurationImageById,
    compatibleKitImagesByItemId,
  };
}

function buildInventoryTargetHref(
  targetKind: "item" | "commercial_configuration",
  targetId: string,
  includeAttentionFilter = false,
) {
  const targetParam =
    targetKind === "item" ? "item" : "configuration";
  const params = new URLSearchParams();

  if (includeAttentionFilter) {
    params.set("status", "attention");
  }

  params.set(targetParam, targetId);
  return `/estoque?${params.toString()}`;
}

function getAttentionFallbackText(
  items: AssistantStockAttentionItem[],
  zeroCount: number,
  lowCount: number,
  remainingCount: number,
) {
  if (zeroCount + lowCount === 0) {
    return "Estoque em dia. Nenhum item precisa de reposição no momento.";
  }

  const itemLines = items.map(
    (item) =>
      `Código ${item.code}, ${item.description}, estoque ${item.current_quantity}, mínimo ${item.minimum_stock}, ${item.status === "ZERO" ? "zerado" : "baixo"}.`,
  );
  const remainingLine =
    remainingCount > 0
      ? `${remainingCount} ${
          remainingCount === 1
            ? "item adicional precisa"
            : "itens adicionais precisam"
        } de atenção.`
      : null;

  return [
    "Itens para repor.",
    `${zeroCount} ${zeroCount === 1 ? "item zerado" : "itens zerados"} e ${lowCount} ${lowCount === 1 ? "item baixo" : "itens baixos"}.`,
    ...itemLines,
    ...(remainingLine ? [remainingLine] : []),
  ].join("\n");
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

async function loadAssistantCatalogMediaSnapshot(
  queryCode: string,
): Promise<AssistantStockSnapshot> {
  const supabase = await createClient();
  const [itemsResult, exactCodesResult] = await Promise.all([
    supabase
      .from("items")
      .select("id, code, description, item_type, minimum_stock, is_active")
      .eq("code", queryCode)
      .eq("is_active", true)
      .limit(2),
    supabase
      .from("commercial_configuration_codes")
      .select("configuration_id, code, is_active")
      .eq("code", queryCode)
      .eq("is_active", true)
      .limit(2),
  ]);

  if (itemsResult.error || exactCodesResult.error) {
    throw new AssistantDataError();
  }

  const exactItems = (itemsResult.data ?? []) as ItemRow[];
  const exactCodes = (exactCodesResult.data ??
    []) as CommercialConfigurationCodeRow[];
  const exactConfigurationIds = Array.from(
    new Set(exactCodes.map((code) => code.configuration_id)),
  );
  const installationKitIds = exactItems
    .filter((item) => item.item_type === "INSTALLATION_KIT")
    .map((item) => item.id);
  const configurationSelect =
    "id, description, servo_id, installation_kit_id, minimum_stock, is_active, image_path";
  const exactConfigurationsPromise =
    exactConfigurationIds.length > 0
      ? supabase
          .from("commercial_configurations")
          .select(configurationSelect)
          .in("id", exactConfigurationIds)
      : Promise.resolve({ data: [], error: null });
  const compatibleConfigurationsPromise =
    installationKitIds.length > 0
      ? supabase
          .from("commercial_configurations")
          .select(configurationSelect)
          .in("installation_kit_id", installationKitIds)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null });
  const [exactConfigurationsResult, compatibleConfigurationsResult] =
    await Promise.all([
      exactConfigurationsPromise,
      compatibleConfigurationsPromise,
    ]);

  if (
    exactConfigurationsResult.error ||
    compatibleConfigurationsResult.error
  ) {
    throw new AssistantDataError();
  }

  const configurationById = new Map<string, CommercialConfigurationRow>();
  [
    ...(exactConfigurationsResult.data ?? []),
    ...(compatibleConfigurationsResult.data ?? []),
  ].forEach((configuration) => {
    const row = configuration as CommercialConfigurationRow;
    configurationById.set(row.id, row);
  });
  const configurations = Array.from(configurationById.values());
  const configurationIds = configurations.map(
    (configuration) => configuration.id,
  );
  const componentItemIds = Array.from(
    new Set(
      configurations.flatMap((configuration) => [
        configuration.servo_id,
        configuration.installation_kit_id,
      ]),
    ),
  );
  const servoIds = Array.from(
    new Set(configurations.map((configuration) => configuration.servo_id)),
  );
  const componentItemsPromise =
    componentItemIds.length > 0
      ? supabase
          .from("items")
          .select(
            "id, code, description, item_type, minimum_stock, is_active",
          )
          .in("id", componentItemIds)
      : Promise.resolve({ data: [], error: null });
  const aliasesPromise =
    configurationIds.length > 0
      ? supabase
          .from("commercial_configuration_codes")
          .select("configuration_id, code, is_active")
          .in("configuration_id", configurationIds)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null });
  const servoModelsPromise =
    servoIds.length > 0
      ? supabase
          .from("servo_models")
          .select("item_id, model")
          .in("item_id", servoIds)
      : Promise.resolve({ data: [], error: null });
  const [componentItemsResult, aliasesResult, servoModelsResult] =
    await Promise.all([
      componentItemsPromise,
      aliasesPromise,
      servoModelsPromise,
    ]);

  if (
    componentItemsResult.error ||
    aliasesResult.error ||
    servoModelsResult.error
  ) {
    throw new AssistantDataError();
  }

  const itemById = new Map<string, ItemRow>();
  [
    ...exactItems,
    ...((componentItemsResult.data ?? []) as ItemRow[]),
  ].forEach((item) => itemById.set(item.id, item));

  return {
    items: Array.from(itemById.values()),
    servoModels: (servoModelsResult.data ?? []) as ServoModelRow[],
    stockBalances: [],
    configurations,
    configurationCodes: (aliasesResult.data ??
      []) as CommercialConfigurationCodeRow[],
    configurationBalances: [],
    repairCompatibilities: [],
  };
}

export async function consultAssistantCatalogMedia(
  rawCode: string,
): Promise<AssistantCatalogMediaBlock> {
  const queryCode = rawCode.trim().toLocaleUpperCase("pt-BR");

  if (!queryCode || queryCode.length > assistantQueryMaxLength) {
    throw new AssistantDataError();
  }

  const normalizedCode = normalizeSearch(queryCode);
  const snapshot = await loadAssistantCatalogMediaSnapshot(queryCode);
  const { physicalItems, configurations } = buildLookupCatalog(snapshot);
  const physicalMatches = physicalItems.filter(
    (item) => normalizeSearch(item.code) === normalizedCode,
  );
  const configurationMatches = configurations
    .filter((configuration) =>
      configuration.aliases.some(
        (alias) => normalizeSearch(alias) === normalizedCode,
      ),
    )
    .map((configuration) => ({
      ...configuration,
      matched_commercial_code:
        configuration.aliases.find(
          (alias) => normalizeSearch(alias) === normalizedCode,
        ) ?? configuration.aliases[0],
    }));
  const requestedConfigurationIds = new Set(
    configurationMatches.map((configuration) => configuration.configuration_id),
  );
  const requestedInstallationKitIds = new Set(
    physicalMatches
      .filter((item) => item.kind === "INSTALLATION_KIT")
      .map((item) => item.item_id),
  );
  const mediaMaps = await buildAssistantMediaMaps(
    snapshot,
    requestedConfigurationIds,
    requestedInstallationKitIds,
  );
  const results: AssistantCatalogMediaTarget[] = [
    ...physicalMatches.map((item) => {
      const compatibleImages =
        item.kind === "INSTALLATION_KIT"
          ? (mediaMaps.compatibleKitImagesByItemId.get(item.item_id) ?? [])
          : [];

      return {
        targetKind: "item" as const,
        targetId: item.item_id,
        displayCode: item.code,
        description: item.description,
        typeLabel: physicalItemTypeLabels[item.kind],
        href: buildInventoryTargetHref("item", item.item_id),
        mediaDescriptor:
          compatibleImages.length > 0
            ? ({
                kind: "compatible_kit_images",
                kitCode: item.code,
                options: compatibleImages,
              } satisfies AssistantMediaDescriptor)
            : null,
      };
    }),
    ...configurationMatches.map((configuration) => ({
      targetKind: "commercial_configuration" as const,
      targetId: configuration.configuration_id,
      displayCode: configuration.matched_commercial_code,
      description: configuration.description,
      typeLabel: "Caixa completa",
      href: buildInventoryTargetHref(
        "commercial_configuration",
        configuration.configuration_id,
      ),
      mediaDescriptor:
        mediaMaps.configurationImageById.get(
          configuration.configuration_id,
        ) ?? null,
    })),
  ].sort((first, second) => compareCodes(first.displayCode, second.displayCode));
  const inventoryHref =
    results.length === 1 ? results[0].href : "/estoque";

  if (results.length === 0) {
    return {
      kind: "catalog_media",
      queryCode,
      status: "NOT_FOUND",
      results: [],
      inventoryHref,
      fallbackText: `Não encontrei o código “${queryCode}” no catálogo.`,
    };
  }

  if (results.length > 1) {
    return {
      kind: "catalog_media",
      queryCode,
      status: "AMBIGUOUS",
      results,
      inventoryHref,
      fallbackText: [
        `Encontrei mais de um resultado para o código “${queryCode}”.`,
        ...results.map(
          (result) =>
            `Código ${result.displayCode}, ${result.description}, ${result.typeLabel}.`,
        ),
      ].join("\n"),
    };
  }

  const result = results[0];
  const hasMedia = result.mediaDescriptor !== null;

  return {
    kind: "catalog_media",
    queryCode,
    status: "FOUND",
    results,
    inventoryHref,
    fallbackText: hasMedia
      ? `Código ${result.displayCode}, ${result.description}. Foto disponível.`
      : `Encontrei o código ${result.displayCode}, mas ainda não há uma foto cadastrada para ${result.targetKind === "commercial_configuration" ? "essa configuração" : "esse item"}.`,
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

export async function consultAssistantLowStock(): Promise<AssistantInventoryAlertsBlock> {
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
          target_kind: "item" as const,
          target_id: item.id,
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
      target_kind: "commercial_configuration",
      target_id: configuration.id,
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
  const zeroCount = attentionItems.filter(
    (item) => item.status === "ZERO",
  ).length;
  const lowCount = attentionItems.length - zeroCount;
  const displayedItems = attentionItems.slice(0, 10);
  const remainingCount = attentionItems.length - displayedItems.length;
  const requestedConfigurationIds = new Set(
    displayedItems
      .filter((item) => item.target_kind === "commercial_configuration")
      .map((item) => item.target_id),
  );
  const requestedInstallationKitIds = new Set(
    displayedItems
      .filter((item) => item.type === "INSTALLATION_KIT")
      .map((item) => item.target_id),
  );
  const mediaMaps = await buildAssistantMediaMaps(
    snapshot,
    requestedConfigurationIds,
    requestedInstallationKitIds,
  );
  const cards: AssistantInventoryAlertCard[] = displayedItems.map((item) => {
    const compatibleImages =
      item.type === "INSTALLATION_KIT"
        ? (mediaMaps.compatibleKitImagesByItemId.get(item.target_id) ?? [])
        : [];
    const mediaDescriptor: AssistantMediaDescriptor | null =
      item.target_kind === "commercial_configuration"
        ? (mediaMaps.configurationImageById.get(item.target_id) ?? null)
        : compatibleImages.length > 0
          ? {
              kind: "compatible_kit_images",
              kitCode: item.code,
              options: compatibleImages,
            }
          : null;

    return {
      targetKind: item.target_kind,
      targetId: item.target_id,
      displayCode: item.code,
      description: item.description,
      currentStock: item.current_quantity,
      minimumStock: item.minimum_stock,
      status: item.status,
      href: buildInventoryTargetHref(
        item.target_kind,
        item.target_id,
        true,
      ),
      mediaDescriptor,
    };
  });

  return {
    kind: "inventory_alerts",
    title: "Itens para repor",
    summary: {
      zeroCount,
      lowCount,
      totalCount: attentionItems.length,
    },
    zeroItems: cards.filter((item) => item.status === "ZERO"),
    lowItems: cards.filter((item) => item.status === "LOW"),
    remainingCount,
    inventoryHref: "/estoque?status=attention",
    fallbackText: getAttentionFallbackText(
      displayedItems,
      zeroCount,
      lowCount,
      remainingCount,
    ),
  };
}
