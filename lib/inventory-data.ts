import {
  inventoryPageSize,
  type InventoryCommercialConfiguration,
  type InventoryDataResult,
  type InventoryFilters,
  type InventoryPhysicalItem,
  type InventorySearchParams,
  type PhysicalTypeFilter,
  type StockState,
  type StockStateFilter,
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

const physicalTypeByFilter: Record<
  Exclude<PhysicalTypeFilter, "todos">,
  PhysicalStockItemType
> = {
  servo: "SERVO",
  "kit-instalacao": "INSTALLATION_KIT",
  "jogo-reparo": "REPAIR_KIT",
  "peca-avulsa": "LOOSE_PART",
};

const stockStateByFilter: Record<
  Exclude<StockStateFilter, "todos">,
  StockState
> = {
  disponivel: "AVAILABLE",
  baixo: "LOW",
  zerado: "ZERO",
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isOneOf<T extends string>(
  value: string | undefined,
  options: readonly T[],
): value is T {
  return value !== undefined && options.includes(value as T);
}

export function parseInventoryFilters(
  searchParams: InventorySearchParams,
): InventoryFilters {
  const tabValue = firstValue(searchParams.aba);
  const typeValue = firstValue(searchParams.tipo);
  const stockStateValue = firstValue(searchParams.situacao);
  const mountedStateValue = firstValue(searchParams.montado);
  const pageValue = firstValue(searchParams.pagina);
  const parsedPage =
    pageValue && /^\d+$/.test(pageValue) ? Number(pageValue) : 1;

  return {
    tab: tabValue === "configuracoes" ? "configuracoes" : "fisicos",
    query: (firstValue(searchParams.q) ?? "").trim().slice(0, 100),
    type: isOneOf(typeValue, [
      "todos",
      "servo",
      "kit-instalacao",
      "jogo-reparo",
      "peca-avulsa",
    ])
      ? typeValue
      : "todos",
    stockState: isOneOf(stockStateValue, [
      "todos",
      "disponivel",
      "baixo",
      "zerado",
    ])
      ? stockStateValue
      : "todos",
    mountedState: isOneOf(mountedStateValue, [
      "todos",
      "com-saldo",
      "sem-saldo",
    ])
      ? mountedStateValue
      : "todos",
    page:
      Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function matchesSearch(
  normalizedQuery: string,
  values: Array<string | null | undefined>,
) {
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) =>
    value ? normalizeSearch(value).includes(normalizedQuery) : false,
  );
}

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

function paginate<T>(items: T[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / inventoryPageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const start = (currentPage - 1) * inventoryPageSize;

  return {
    items: items.slice(start, start + inventoryPageSize),
    pagination: {
      currentPage,
      totalPages,
      totalResults: items.length,
      pageSize: inventoryPageSize,
    },
  };
}

export async function loadInventoryData(
  filters: InventoryFilters,
): Promise<InventoryDataResult> {
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
        .select("id, configuration_id, code")
        .eq("is_active", true),
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
      configurationCodes.map((code) => code.configuration_id),
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
    const codesByConfigurationId = new Map<string, string[]>();

    configurationCodes.forEach((configurationCode) => {
      const codes =
        codesByConfigurationId.get(configurationCode.configuration_id) ?? [];
      codes.push(configurationCode.code);
      codesByConfigurationId.set(configurationCode.configuration_id, codes);
    });

    const configurationCatalog: InventoryCommercialConfigurationDraft[] =
      configurations.flatMap((configuration) => {
        if (!configuration.is_active) {
          return [];
        }

        const servo = itemById.get(configuration.servo_id);
        const installationKit = itemById.get(
          configuration.installation_kit_id,
        );
        const codes = (
          codesByConfigurationId.get(configuration.id) ?? []
        ).sort(compareCodes);

        if (
          codes.length === 0 ||
          !servo?.is_active ||
          servo.item_type !== "SERVO" ||
          !installationKit?.is_active ||
          installationKit.item_type !== "INSTALLATION_KIT"
        ) {
          return [];
        }

        const assembledQuantity =
          assembledByConfigurationId.get(configuration.id) ?? 0;

        return [
          {
            id: configuration.id,
            codes,
            description:
              configuration.description?.trim() ||
              `${servo.description} + ${installationKit.code}`,
            imagePath: configuration.image_path,
            servo: {
              code: servo.code,
              description: servo.description,
              model: servoModelByItemId.get(servo.id) ?? null,
            },
            installationKit: {
              code: installationKit.code,
              description: installationKit.description,
            },
            assembledQuantity,
            minimumStock: configuration.minimum_stock,
            state: getConfigurationStockState(
              assembledQuantity,
              configuration.minimum_stock,
            ),
            hasAliases: codes.length > 1,
          },
        ];
      });
    const normalizedQuery = normalizeSearch(filters.query);
    const filteredPhysicalItems = physicalCatalog
      .filter((item) =>
        matchesSearch(normalizedQuery, [
          item.code,
          item.description,
          item.model,
          item.itemType,
          item.typeLabel,
        ]),
      )
      .filter(
        (item) =>
          filters.type === "todos" ||
          item.itemType === physicalTypeByFilter[filters.type],
      )
      .filter(
        (item) =>
          filters.stockState === "todos" ||
          item.state === stockStateByFilter[filters.stockState],
      )
      .sort((first, second) =>
        compareCodeAndId(first.code, first.id, second.code, second.id),
      );
    const filteredConfigurations = configurationCatalog
      .filter((configuration) =>
        matchesSearch(normalizedQuery, [
          ...configuration.codes,
          configuration.description,
          configuration.servo.code,
          configuration.servo.description,
          configuration.servo.model,
          configuration.installationKit.code,
          configuration.installationKit.description,
        ]),
      )
      .filter(
        (configuration) =>
          filters.mountedState === "todos" ||
          (filters.mountedState === "com-saldo"
            ? configuration.assembledQuantity > 0
            : configuration.assembledQuantity === 0),
      )
      .sort((first, second) =>
        compareCodeAndId(
          first.codes[0],
          first.id,
          second.codes[0],
          second.id,
        ),
      );
    const currentResults =
      filters.tab === "fisicos"
        ? paginate(filteredPhysicalItems, filters.page)
        : paginate(filteredConfigurations, filters.page);
    const currentConfigurationDrafts =
      filters.tab === "configuracoes"
        ? (currentResults.items as InventoryCommercialConfigurationDraft[])
        : [];
    const imageUrlByPath = await createCommercialImageUrlMap(
      supabase,
      currentConfigurationDrafts.map(
        (configuration) => configuration.imagePath,
      ),
    );
    const currentConfigurations: InventoryCommercialConfiguration[] =
      currentConfigurationDrafts.map(({ imagePath, ...configuration }) => ({
        ...configuration,
        imageUrl: imagePath
          ? (imageUrlByPath.get(imagePath) ?? null)
          : null,
      }));

    return {
      data: {
        summary,
        physicalItems:
          filters.tab === "fisicos"
            ? (currentResults.items as InventoryPhysicalItem[])
            : [],
        configurations:
          filters.tab === "configuracoes"
            ? currentConfigurations
            : [],
        physicalCatalogCount: physicalCatalog.length,
        configurationCatalogCount: configurationCatalog.length,
        pagination: currentResults.pagination,
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
