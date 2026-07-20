import { createClient } from "@/lib/supabase/server";
import { calculatePhysicalStockByItem } from "@/lib/stock-calculations";
import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";

type ItemType = "SERVO" | "INSTALLATION_KIT" | "REPAIR_KIT" | "LOOSE_PART";

type ItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: ItemType;
  minimum_stock: number;
  is_active: boolean;
};

type ServoModelRow = {
  item_id: string;
  model: string | null;
};

type ServoRepairCompatibilityRow = {
  servo_id: string;
  repair_kit_id: string;
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
  image_path: string | null;
};

type CommercialConfigurationCodeRow = {
  configuration_id: string;
  code: string;
};

type ConfigurationBalanceRow = {
  configuration_id: string;
  quantity: number;
};

type MovementBatchRow = {
  id: string;
  movement_type:
    | "INBOUND"
    | "OUTBOUND"
    | "ASSEMBLY"
    | "DISASSEMBLY"
    | "ADJUSTMENT"
    | "REVERSAL";
  source: "MANUAL" | "AI_CHAT" | "ORDER_PHOTO";
  description: string | null;
  user_name_snapshot: string | null;
  occurred_at: string;
};

export type StockSummary = {
  servoTotal: number;
  looseKitTotal: number;
  repairKitTotal: number;
  lowStockItems: number;
};

export type RecentMovement = {
  id: string;
  type: MovementBatchRow["movement_type"];
  typeLabel: string;
  sourceLabel: string;
  description: string | null;
  userName: string | null;
  occurredAt: string;
};

type RelatedItem = {
  code: string;
  description: string;
  model?: string | null;
};

export type SearchResult = {
  id: string;
  kind: "item" | "configuration";
  code: string;
  description: string;
  type: ItemType | "COMMERCIAL_CONFIGURATION";
  typeLabel: string;
  model?: string | null;
  servo?: RelatedItem;
  installationKit?: RelatedItem;
  compatibleServos?: RelatedItem[];
  compatibleRepairs?: RelatedItem[];
  imageUrl?: string | null;
};

type SearchResultDraft = SearchResult & {
  imagePath?: string | null;
};

export type HomeData = {
  summary: StockSummary;
  recentMovements: RecentMovement[];
  searchResults: SearchResult[];
};

export type HomeDataResult =
  | { data: HomeData; error: null }
  | { data: null; error: string };

const itemTypeLabels: Record<ItemType, string> = {
  SERVO: "SERVO",
  INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Jogo de reparo",
  LOOSE_PART: "Peça avulsa",
};

const movementTypeLabels: Record<MovementBatchRow["movement_type"], string> = {
  INBOUND: "Entrada",
  OUTBOUND: "Saída",
  ASSEMBLY: "Montagem",
  DISASSEMBLY: "Desmontagem",
  ADJUSTMENT: "Ajuste",
  REVERSAL: "Reversão",
};

const movementSourceLabels: Record<MovementBatchRow["source"], string> = {
  MANUAL: "Manual",
  AI_CHAT: "Assistente IA",
  ORDER_PHOTO: "Pedido por foto",
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function includesSearch(search: string, values: Array<string | null | undefined>) {
  return values.some((value) =>
    value ? normalizeSearch(value).includes(search) : false,
  );
}

function getDistinctModel(description: string, model: string | null | undefined) {
  const trimmedModel = model?.trim();

  if (
    !trimmedModel ||
    normalizeSearch(description).includes(normalizeSearch(trimmedModel))
  ) {
    return undefined;
  }

  return trimmedModel;
}

function buildSearchResults(
  query: string,
  items: ItemRow[],
  servoModels: ServoModelRow[],
  repairCompatibilities: ServoRepairCompatibilityRow[],
  configurations: CommercialConfigurationRow[],
  configurationCodes: CommercialConfigurationCodeRow[],
): SearchResultDraft[] {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const search = normalizeSearch(trimmedQuery);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const configurationById = new Map(
    configurations.map((configuration) => [configuration.id, configuration]),
  );
  const servoModelById = new Map(
    servoModels.map((servo) => [servo.item_id, servo.model]),
  );
  const servoIdsByRepairId = new Map<string, string[]>();
  const repairIdsByServoId = new Map<string, string[]>();

  repairCompatibilities.forEach((compatibility) => {
    const servoIds = servoIdsByRepairId.get(compatibility.repair_kit_id) ?? [];
    servoIds.push(compatibility.servo_id);
    servoIdsByRepairId.set(compatibility.repair_kit_id, servoIds);

    const repairIds = repairIdsByServoId.get(compatibility.servo_id) ?? [];
    repairIds.push(compatibility.repair_kit_id);
    repairIdsByServoId.set(compatibility.servo_id, repairIds);
  });

  const getRelatedItems = (
    itemIds: string[] | undefined,
    itemType: "SERVO" | "REPAIR_KIT",
  ) =>
    (itemIds ?? [])
      .map((itemId) => itemById.get(itemId))
      .filter((item): item is ItemRow => item?.item_type === itemType)
      .map((item) => ({
        code: item.code,
        description: item.description,
      }))
      .sort((first, second) =>
        first.code.localeCompare(second.code, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        }),
      );

  const itemResults: SearchResult[] = items
    .filter((item) =>
      includesSearch(search, [
        item.code,
        item.description,
        item.item_type === "SERVO" ? servoModelById.get(item.id) : null,
      ]),
    )
    .map((item) => {
      const result: SearchResult = {
        id: item.id,
        kind: "item",
        code: item.code,
        description: item.description,
        type: item.item_type,
        typeLabel: itemTypeLabels[item.item_type],
        model:
          item.item_type === "SERVO"
            ? getDistinctModel(item.description, servoModelById.get(item.id))
            : undefined,
      };

      if (item.item_type === "REPAIR_KIT") {
        result.compatibleServos = getRelatedItems(
          servoIdsByRepairId.get(item.id),
          "SERVO",
        );
      }

      if (item.item_type === "SERVO") {
        result.compatibleRepairs = getRelatedItems(
          repairIdsByServoId.get(item.id),
          "REPAIR_KIT",
        );
      }

      return result;
    });

  const configurationResults: SearchResult[] = configurationCodes.flatMap(
    (configurationCode) => {
      const configuration = configurationById.get(
        configurationCode.configuration_id,
      );

      if (!configuration) {
        return [];
      }

      const servo = itemById.get(configuration.servo_id);
      const installationKit = itemById.get(configuration.installation_kit_id);

      if (!servo || !installationKit) {
        return [];
      }

      const servoModel = servoModelById.get(servo.id);
      const distinctServoModel = getDistinctModel(
        servo.description,
        servoModel,
      );
      const matches = includesSearch(search, [
        configurationCode.code,
        configuration.description,
        servo.code,
        servo.description,
        servoModel,
        installationKit.code,
        installationKit.description,
      ]);

      if (!matches) {
        return [];
      }

      return [
        {
          id: configuration.id,
          kind: "configuration" as const,
          code: configurationCode.code,
          description: `${servo.description} + ${installationKit.code}`,
          type: "COMMERCIAL_CONFIGURATION" as const,
          typeLabel: "Configuração comercial",
          servo: {
            code: servo.code,
            description: servo.description,
            model: distinctServoModel,
          },
          installationKit: {
            code: installationKit.code,
            description: `Kit de instalação ${configurationCode.code}`,
          },
          compatibleRepairs: getRelatedItems(
            repairIdsByServoId.get(servo.id),
            "REPAIR_KIT",
          ),
          imagePath: configuration.image_path,
        },
      ];
    },
  );

  return [...itemResults, ...configurationResults].sort((first, second) =>
    first.code.localeCompare(second.code, "pt-BR", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function buildSummary(
  items: ItemRow[],
  stockBalances: StockBalanceRow[],
  configurations: CommercialConfigurationRow[],
  configurationBalances: ConfigurationBalanceRow[],
): StockSummary {
  const physicalStockByItem = calculatePhysicalStockByItem(
    items.map((item) => ({
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
  const physicalQuantity = (item: ItemRow) =>
    physicalStockByItem.get(item.id)?.totalQuantity ?? 0;

  return {
    servoTotal: items
      .filter((item) => item.item_type === "SERVO")
      .reduce((total, item) => total + physicalQuantity(item), 0),
    looseKitTotal: items
      .filter((item) => item.item_type === "INSTALLATION_KIT")
      .reduce(
        (total, item) =>
          total + (physicalStockByItem.get(item.id)?.looseQuantity ?? 0),
        0,
      ),
    repairKitTotal: items
      .filter((item) => item.item_type === "REPAIR_KIT")
      .reduce(
        (total, item) =>
          total + (physicalStockByItem.get(item.id)?.looseQuantity ?? 0),
        0,
      ),
    lowStockItems: items.filter(
      (item) =>
        item.is_active &&
        item.minimum_stock > 0 &&
        physicalQuantity(item) <= item.minimum_stock,
    ).length,
  };
}

export async function loadHomeData(query: string): Promise<HomeDataResult> {
  try {
    const supabase = await createClient();
    const [
      itemsResult,
      servoModelsResult,
      repairCompatibilitiesResult,
      stockBalancesResult,
      configurationsResult,
      configurationCodesResult,
      configurationBalancesResult,
      movementsResult,
    ] = await Promise.all([
      supabase
        .from("items")
        .select("id, code, description, item_type, minimum_stock, is_active"),
      supabase.from("servo_models").select("item_id, model"),
      supabase
        .from("servo_repair_compatibility")
        .select("servo_id, repair_kit_id"),
      supabase.from("stock_balances").select("item_id, quantity"),
      supabase
        .from("commercial_configurations")
        .select(
          "id, description, servo_id, installation_kit_id, image_path",
        ),
      supabase
        .from("commercial_configuration_codes")
        .select("configuration_id, code"),
      supabase
        .from("configuration_stock_balances")
        .select("configuration_id, quantity"),
      supabase
        .from("movement_batches")
        .select(
          "id, movement_type, source, description, user_name_snapshot, occurred_at",
        )
        .order("occurred_at", { ascending: false })
        .limit(5),
    ]);

    const readError = [
      itemsResult.error,
      servoModelsResult.error,
      repairCompatibilitiesResult.error,
      stockBalancesResult.error,
      configurationsResult.error,
      configurationCodesResult.error,
      configurationBalancesResult.error,
      movementsResult.error,
    ].find(Boolean);

    if (readError) {
      return {
        data: null,
        error: "Não foi possível carregar os dados do estoque agora.",
      };
    }

    const items = (itemsResult.data ?? []) as ItemRow[];
    const servoModels = (servoModelsResult.data ?? []) as ServoModelRow[];
    const repairCompatibilities = (repairCompatibilitiesResult.data ??
      []) as ServoRepairCompatibilityRow[];
    const stockBalances = (stockBalancesResult.data ?? []) as StockBalanceRow[];
    const configurations = (configurationsResult.data ??
      []) as CommercialConfigurationRow[];
    const configurationCodes = (configurationCodesResult.data ??
      []) as CommercialConfigurationCodeRow[];
    const configurationBalances = (configurationBalancesResult.data ??
      []) as ConfigurationBalanceRow[];
    const movements = (movementsResult.data ?? []) as MovementBatchRow[];
    const searchResultDrafts = buildSearchResults(
      query,
      items,
      servoModels,
      repairCompatibilities,
      configurations,
      configurationCodes,
    );
    const imageUrlByPath = await createCommercialImageUrlMap(
      supabase,
      searchResultDrafts.map((result) => result.imagePath),
    );
    const searchResults: SearchResult[] = searchResultDrafts.map(
      ({ imagePath, ...result }) =>
        result.kind === "configuration"
          ? {
              ...result,
              imageUrl: imagePath
                ? (imageUrlByPath.get(imagePath) ?? null)
                : null,
            }
          : result,
    );

    return {
      data: {
        summary: buildSummary(
          items,
          stockBalances,
          configurations,
          configurationBalances,
        ),
        recentMovements: movements.map((movement) => ({
          id: movement.id,
          type: movement.movement_type,
          typeLabel: movementTypeLabels[movement.movement_type],
          sourceLabel: movementSourceLabels[movement.source],
          description: movement.description,
          userName: movement.user_name_snapshot,
          occurredAt: movement.occurred_at,
        })),
        searchResults,
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
