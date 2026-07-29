import type { PhysicalStockItemType } from "@/lib/stock-calculations";
import type { CompatibleKitImageOption } from "@/lib/compatible-kit-images";
import type { PurchaseRecommendationItem } from "@/lib/purchase-recommendation-types";

export const assistantMessageMaxLength = 2000;
export const assistantQueryMaxLength = 120;
export const assistantRequestMaxCharacters = 4096;

export type AssistantChatRequest = {
  message: string;
  lastItemQuery?: string;
  lastSupplierOrderId?: string;
  lastSupplierOrderCatalogCode?: string;
};

export type AssistantChatSuccess = {
  message: string;
  contextItemQuery?: string | null;
  contextSupplierOrderId?: string | null;
  contextSupplierOrderCatalogCode?: string | null;
  structuredBlock?: AssistantStructuredBlock;
};

export type AssistantChatError = {
  error: string;
};

export type AssistantPhysicalItemResult = {
  kind: PhysicalStockItemType;
  item_id: string;
  code: string;
  description: string;
  minimum_stock: number;
  loose_quantity: number;
  mounted_quantity?: number;
  total_quantity?: number;
  model?: string | null;
  compatible_servos?: Array<{
    code: string;
    description: string;
    model: string | null;
  }>;
};

export type AssistantCommercialConfigurationResult = {
  kind: "COMMERCIAL_CONFIGURATION";
  configuration_id: string;
  matched_commercial_code: string;
  aliases: string[];
  description: string;
  servo: {
    code: string;
    description: string;
    model: string | null;
    loose_quantity: number;
  };
  installation_kit: {
    code: string;
    description: string;
    loose_quantity: number;
  };
  assembled_quantity: number;
  maximum_assemblable: number;
  minimum_stock: number;
};

export type AssistantItemLookupResult = {
  query: string;
  exact_code_match: boolean;
  results: Array<
    AssistantPhysicalItemResult | AssistantCommercialConfigurationResult
  >;
};

export type AssistantStockSummaryResult = {
  complete_boxes: number;
  loose_servos: number;
  loose_installation_kits: number;
  repair_kits: number;
  loose_parts: number;
  low_stock: number;
  out_of_stock: number;
};

export type AssistantStockAttentionItem = {
  target_kind: "item" | "commercial_configuration";
  target_id: string;
  type:
    | PhysicalStockItemType
    | "COMMERCIAL_CONFIGURATION";
  code: string;
  aliases?: string[];
  description: string;
  current_quantity: number;
  minimum_stock: number;
  status: "LOW" | "ZERO";
};

export type AssistantCommercialConfigurationMedia = {
  kind: "commercial_configuration_image";
  commercialCodes: string[];
  imageUrl: string;
};

export type AssistantCompatibleKitMedia = {
  kind: "compatible_kit_images";
  kitCode: string;
  options: CompatibleKitImageOption[];
};

export type AssistantMediaDescriptor =
  | AssistantCommercialConfigurationMedia
  | AssistantCompatibleKitMedia;

export type AssistantInventoryAlertCard = {
  targetKind: "item" | "commercial_configuration";
  targetId: string;
  displayCode: string;
  description: string;
  currentStock: number;
  minimumStock: number;
  status: "ZERO" | "LOW";
  href: string;
  mediaDescriptor: AssistantMediaDescriptor | null;
};

export type AssistantInventoryAlertsBlock = {
  kind: "inventory_alerts";
  title: "Itens para repor";
  summary: {
    zeroCount: number;
    lowCount: number;
    totalCount: number;
  };
  zeroItems: AssistantInventoryAlertCard[];
  lowItems: AssistantInventoryAlertCard[];
  remainingCount: number;
  inventoryHref: "/estoque?status=attention";
  fallbackText: string;
};

export type AssistantCatalogMediaTarget = {
  targetKind: "item" | "commercial_configuration";
  targetId: string;
  displayCode: string;
  description: string;
  typeLabel: string;
  href: string;
  mediaDescriptor: AssistantMediaDescriptor | null;
};

export type AssistantCatalogMediaBlock = {
  kind: "catalog_media";
  queryCode: string;
  status: "FOUND" | "AMBIGUOUS" | "NOT_FOUND";
  results: AssistantCatalogMediaTarget[];
  inventoryHref: string;
  fallbackText: string;
};

export type AssistantInventoryItemSummaryMetric =
  | "STOCK"
  | "MINIMUM"
  | "STATUS"
  | "SHORTFALL"
  | "DESCRIPTION"
  | "COMPOSITION";

export type AssistantInventoryItemSummaryTarget = {
  targetKind: "item" | "commercial_configuration";
  targetId: string;
  displayCode: string;
  itemType:
    | PhysicalStockItemType
    | "COMPLETE_BOX";
  typeLabel: string;
  description: string;
  currentStock: number;
  minimumStock: number | null;
  stockUnitLabel: string;
  status: "ZERO" | "LOW" | "OK" | "NO_MINIMUM";
  statusLabel: string;
  shortfall: number | null;
  href: string;
  mediaDescriptor: AssistantMediaDescriptor | null;
  composition?: {
    servoCode: string;
    servoDescription: string;
    installationKitCode: string;
    installationKitDescription: string;
  };
};

export type AssistantInventoryItemSummaryBlock = {
  kind: "inventory_item_summary";
  queryCode: string;
  status: "FOUND" | "AMBIGUOUS" | "NOT_FOUND";
  metric: AssistantInventoryItemSummaryMetric;
  results: AssistantInventoryItemSummaryTarget[];
  inventoryHref: string;
  primaryText: string;
  fallbackText: string;
};

export type AssistantSupplierOrderCard = {
  id: string;
  negotiationNumber: string;
  orderDate: string;
  status: "PENDING" | "PARTIAL" | "COMPLETED" | "CANCELLED";
  closureKind: "FINALIZED" | "CANCELLED" | null;
  lineCount: number;
  orderedQuantity: number;
  pickedQuantity: number;
  waitingPickupQuantity: number;
  stockedQuantity: number;
  waitingStockQuantity: number;
  href: string;
};

export type AssistantSupplierOrderItemCard = {
  id: string;
  displayCode: string;
  description: string;
  typeLabel: string;
  orderedQuantity: number;
  pickedQuantity: number;
  waitingPickupQuantity: number;
  stockedQuantity: number;
  waitingStockQuantity: number;
  cancelledQuantity: number;
  mediaDescriptor: AssistantMediaDescriptor | null;
};

export type AssistantSupplierOrderCatalogLine =
  AssistantSupplierOrderItemCard & {
    supplierOrderId: string;
  };

export type AssistantSupplierOrderListBlock = {
  kind: "supplier_order_list";
  title: string;
  filtersSummary: string;
  totalCount: number;
  remainingCount: number;
  orders: AssistantSupplierOrderCard[];
  catalogCode: string | null;
  catalogLines: AssistantSupplierOrderCatalogLine[];
  ordersHref: string;
  fallbackText: string;
};

export type AssistantSupplierOrderDetailBlock = {
  kind: "supplier_order_detail";
  title: string;
  order: AssistantSupplierOrderCard;
  items: AssistantSupplierOrderItemCard[];
  catalogCode: string | null;
  hiddenItemCount: number;
  fallbackText: string;
};

export type AssistantSupplierOrderAggregateBlock = {
  kind: "supplier_order_aggregate";
  title: string;
  filtersSummary: string;
  orderCount: number;
  orderedQuantity: number;
  pickedQuantity: number;
  waitingPickupQuantity: number;
  stockedQuantity: number;
  waitingStockQuantity: number;
  catalogCode: string | null;
  primaryMetric:
    | "ORDER_COUNT"
    | "ORDERED_UNITS"
    | "PICKED_UNITS"
    | "WAITING_PICKUP_UNITS"
    | "WAITING_STOCK_UNITS";
  ordersHref: string;
  fallbackText: string;
};

export type AssistantSupplierOrderAmbiguityBlock = {
  kind: "supplier_order_ambiguity";
  title: string;
  description: string;
  orders: AssistantSupplierOrderCard[];
  ordersHref: string;
  fallbackText: string;
};

export type AssistantClarificationCategory =
  | "inventory"
  | "supplier_orders"
  | "replenishment"
  | "media";

export type AssistantClarificationOption = {
  id: string;
  label: string;
  prompt: string;
  category: AssistantClarificationCategory;
};

export type AssistantClarificationBlock = {
  kind: "assistant_clarification";
  title: string;
  message?: string;
  options: AssistantClarificationOption[];
  fallbackText: string;
};

export type AssistantPurchaseRecommendationBlock = {
  kind: "purchase_recommendation_list";
  title: string;
  subtitle: string;
  mode: "buy_now" | "already_ordered" | "missing_minimum" | "all";
  queryCode: string | null;
  queryStatus: "FOUND" | "AMBIGUOUS" | "NOT_FOUND" | null;
  primaryText: string;
  summary: {
    buyNowCount: number;
    alreadyOrderedCount: number;
    missingMinimumCount: number;
  };
  items: PurchaseRecommendationItem[];
  totalCount: number;
  remainingCount: number;
  listHref: "/estoque?view=purchase-recommendations";
  fallbackText: string;
};

export type AssistantStructuredBlock =
  | AssistantInventoryAlertsBlock
  | AssistantCatalogMediaBlock
  | AssistantInventoryItemSummaryBlock
  | AssistantSupplierOrderListBlock
  | AssistantSupplierOrderDetailBlock
  | AssistantSupplierOrderAggregateBlock
  | AssistantSupplierOrderAmbiguityBlock
  | AssistantPurchaseRecommendationBlock
  | AssistantClarificationBlock;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSafeSignedImageUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    const configuredSupabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

    if (!configuredSupabaseUrl) {
      return false;
    }

    const supabaseUrl = new URL(configuredSupabaseUrl);

    return (
      url.protocol === "https:" &&
      url.origin === supabaseUrl.origin &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(
        "/storage/v1/object/sign/commercial-catalog-images/",
      )
    );
  } catch {
    return false;
  }
}

function isSafeInventoryHref(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/estoque")) {
    return false;
  }

  try {
    const url = new URL(value, "https://negocios-k.local");

    if (
      url.origin !== "https://negocios-k.local" ||
      url.pathname !== "/estoque" ||
      url.hash
    ) {
      return false;
    }

    const keys = Array.from(url.searchParams.keys());
    const uniqueKeys = new Set(keys);
    const status = url.searchParams.get("status");
    const itemId = url.searchParams.get("item");
    const configurationId = url.searchParams.get("configuration");

    return (
      keys.length === uniqueKeys.size &&
      keys.every((key) =>
        ["status", "item", "configuration"].includes(key),
      ) &&
      (!status || ["attention", "low", "zero"].includes(status)) &&
      (!itemId || uuidPattern.test(itemId)) &&
      (!configurationId || uuidPattern.test(configurationId)) &&
      !(itemId && configurationId)
    );
  } catch {
    return false;
  }
}

function isExpectedTargetHref(
  href: string,
  targetKind: "item" | "commercial_configuration",
  targetId: string,
  expectedStatus: "attention" | null,
) {
  try {
    const url = new URL(href, "https://negocios-k.local");
    const targetParam =
      targetKind === "item" ? "item" : "configuration";
    const otherTargetParam =
      targetKind === "item" ? "configuration" : "item";

    return (
      url.searchParams.get(targetParam) === targetId &&
      !url.searchParams.has(otherTargetParam) &&
      url.searchParams.get("status") === expectedStatus
    );
  } catch {
    return false;
  }
}

function isSafePurchaseRecommendationHref(
  value: unknown,
): value is "/estoque?view=purchase-recommendations" {
  return value === "/estoque?view=purchase-recommendations";
}

function isSafeSupplierOrdersHref(
  value: unknown,
  expectedOrderId?: string,
): value is string {
  if (typeof value !== "string" || !value.startsWith("/pedidos")) {
    return false;
  }

  try {
    const url = new URL(value, "https://negocios-k.local");
    const keys = Array.from(url.searchParams.keys());
    const uniqueKeys = new Set(keys);
    const view = url.searchParams.get("view");
    const orderId = url.searchParams.get("order");

    return (
      url.origin === "https://negocios-k.local" &&
      url.pathname === "/pedidos" &&
      !url.hash &&
      keys.length === uniqueKeys.size &&
      keys.every((key) => ["view", "order"].includes(key)) &&
      (view === "active" || view === "history") &&
      (!orderId || uuidPattern.test(orderId)) &&
      (expectedOrderId === undefined
        ? !orderId
        : orderId === expectedOrderId)
    );
  } catch {
    return false;
  }
}

function parseSupplierOrderCard(
  value: unknown,
): AssistantSupplierOrderCard | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !uuidPattern.test(value.id) ||
    typeof value.negotiationNumber !== "string" ||
    !value.negotiationNumber.trim() ||
    typeof value.orderDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.orderDate) ||
    !["PENDING", "PARTIAL", "COMPLETED", "CANCELLED"].includes(
      String(value.status),
    ) ||
    (value.closureKind !== null &&
      value.closureKind !== "FINALIZED" &&
      value.closureKind !== "CANCELLED") ||
    !isNonnegativeInteger(value.lineCount) ||
    !isNonnegativeInteger(value.orderedQuantity) ||
    !isNonnegativeInteger(value.pickedQuantity) ||
    !isNonnegativeInteger(value.waitingPickupQuantity) ||
    !isNonnegativeInteger(value.stockedQuantity) ||
    !isNonnegativeInteger(value.waitingStockQuantity) ||
    value.pickedQuantity + value.waitingPickupQuantity >
      value.orderedQuantity ||
    value.stockedQuantity + value.waitingStockQuantity !==
      value.pickedQuantity ||
    !isSafeSupplierOrdersHref(value.href, value.id)
  ) {
    return null;
  }

  return value as AssistantSupplierOrderCard;
}

function parseSupplierOrderItemCard(
  value: unknown,
): AssistantSupplierOrderItemCard | null {
  if (!isRecord(value)) {
    return null;
  }

  const mediaDescriptor = parseMediaDescriptor(value.mediaDescriptor);

  if (
    typeof value.id !== "string" ||
    !uuidPattern.test(value.id) ||
    typeof value.displayCode !== "string" ||
    !value.displayCode.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    typeof value.typeLabel !== "string" ||
    !value.typeLabel.trim() ||
    !isNonnegativeInteger(value.orderedQuantity) ||
    !isNonnegativeInteger(value.pickedQuantity) ||
    !isNonnegativeInteger(value.waitingPickupQuantity) ||
    !isNonnegativeInteger(value.stockedQuantity) ||
    !isNonnegativeInteger(value.waitingStockQuantity) ||
    !isNonnegativeInteger(value.cancelledQuantity) ||
    value.pickedQuantity +
      value.waitingPickupQuantity +
      value.cancelledQuantity !==
      value.orderedQuantity ||
    value.stockedQuantity + value.waitingStockQuantity !==
      value.pickedQuantity ||
    mediaDescriptor === undefined
  ) {
    return null;
  }

  return {
    id: value.id,
    displayCode: value.displayCode,
    description: value.description,
    typeLabel: value.typeLabel,
    orderedQuantity: value.orderedQuantity,
    pickedQuantity: value.pickedQuantity,
    waitingPickupQuantity: value.waitingPickupQuantity,
    stockedQuantity: value.stockedQuantity,
    waitingStockQuantity: value.waitingStockQuantity,
    cancelledQuantity: value.cancelledQuantity,
    mediaDescriptor,
  };
}

function parseSupplierOrderCatalogLine(
  value: unknown,
): AssistantSupplierOrderCatalogLine | null {
  const item = parseSupplierOrderItemCard(value);

  if (
    !item ||
    !isRecord(value) ||
    typeof value.supplierOrderId !== "string" ||
    !uuidPattern.test(value.supplierOrderId)
  ) {
    return null;
  }

  return {
    ...item,
    supplierOrderId: value.supplierOrderId,
  };
}

function parseCompatibleKitOption(
  value: unknown,
): CompatibleKitImageOption | null {
  if (
    !isRecord(value) ||
    typeof value.configurationId !== "string" ||
    !uuidPattern.test(value.configurationId) ||
    !Array.isArray(value.commercialCodes) ||
    value.commercialCodes.length === 0 ||
    !value.commercialCodes.every(
      (code) => typeof code === "string" && Boolean(code.trim()),
    ) ||
    typeof value.servoCode !== "string" ||
    typeof value.servoDescription !== "string" ||
    (value.servoModel !== null && typeof value.servoModel !== "string") ||
    typeof value.installationKitCode !== "string" ||
    typeof value.description !== "string" ||
    !isSafeSignedImageUrl(value.imageUrl)
  ) {
    return null;
  }

  return value as CompatibleKitImageOption;
}

function parseMediaDescriptor(
  value: unknown,
): AssistantMediaDescriptor | null | undefined {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (
    value.kind === "commercial_configuration_image" &&
    Array.isArray(value.commercialCodes) &&
    value.commercialCodes.length > 0 &&
    value.commercialCodes.every(
      (code) => typeof code === "string" && Boolean(code.trim()),
    ) &&
    isSafeSignedImageUrl(value.imageUrl)
  ) {
    return value as AssistantCommercialConfigurationMedia;
  }

  if (
    value.kind === "compatible_kit_images" &&
    typeof value.kitCode === "string" &&
    Array.isArray(value.options)
  ) {
    const options = value.options.map(parseCompatibleKitOption);

    if (options.length > 0 && options.every(Boolean)) {
      return {
        kind: "compatible_kit_images",
        kitCode: value.kitCode,
        options: options as CompatibleKitImageOption[],
      };
    }
  }

  return undefined;
}

function parseInventoryAlertCard(
  value: unknown,
): AssistantInventoryAlertCard | null {
  if (!isRecord(value)) {
    return null;
  }

  const mediaDescriptor = parseMediaDescriptor(value.mediaDescriptor);

  if (
    (value.targetKind !== "item" &&
      value.targetKind !== "commercial_configuration") ||
    typeof value.targetId !== "string" ||
    !uuidPattern.test(value.targetId) ||
    typeof value.displayCode !== "string" ||
    !value.displayCode.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    !isNonnegativeInteger(value.currentStock) ||
    !isNonnegativeInteger(value.minimumStock) ||
    (value.status !== "ZERO" && value.status !== "LOW") ||
    !isSafeInventoryHref(value.href) ||
    !isExpectedTargetHref(
      value.href,
      value.targetKind,
      value.targetId,
      "attention",
    ) ||
    mediaDescriptor === undefined
  ) {
    return null;
  }

  return {
    targetKind: value.targetKind,
    targetId: value.targetId,
    displayCode: value.displayCode,
    description: value.description,
    currentStock: value.currentStock,
    minimumStock: value.minimumStock,
    status: value.status,
    href: value.href,
    mediaDescriptor,
  };
}

function parseCatalogMediaTarget(
  value: unknown,
): AssistantCatalogMediaTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const mediaDescriptor = parseMediaDescriptor(value.mediaDescriptor);

  if (
    (value.targetKind !== "item" &&
      value.targetKind !== "commercial_configuration") ||
    typeof value.targetId !== "string" ||
    !uuidPattern.test(value.targetId) ||
    typeof value.displayCode !== "string" ||
    !value.displayCode.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    typeof value.typeLabel !== "string" ||
    !value.typeLabel.trim() ||
    !isSafeInventoryHref(value.href) ||
    !isExpectedTargetHref(
      value.href,
      value.targetKind,
      value.targetId,
      null,
    ) ||
    mediaDescriptor === undefined
  ) {
    return null;
  }

  return {
    targetKind: value.targetKind,
    targetId: value.targetId,
    displayCode: value.displayCode,
    description: value.description,
    typeLabel: value.typeLabel,
    href: value.href,
    mediaDescriptor,
  };
}

function parseInventoryItemSummaryTarget(
  value: unknown,
): AssistantInventoryItemSummaryTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const mediaDescriptor = parseMediaDescriptor(value.mediaDescriptor);
  const minimumStock =
    value.minimumStock === null && value.status === "NO_MINIMUM"
      ? null
      : value.minimumStock;
  const shortfall =
    value.shortfall === null && minimumStock === null
      ? null
      : value.shortfall;
  const composition = value.composition;
  const itemType = String(
    value.itemType,
  ) as AssistantInventoryItemSummaryTarget["itemType"];
  const expectedTypeLabel = {
    SERVO: "Servoembreagem",
    INSTALLATION_KIT: "Kit de instalação",
    REPAIR_KIT: "Jogo de reparo",
    LOOSE_PART: "Peça avulsa",
    COMPLETE_BOX: "Caixa completa",
  }[itemType];
  const expectedStatusLabel = {
    ZERO: "Zerado",
    LOW: "Baixo",
    OK: "Em estoque",
    NO_MINIMUM: "Mínimo não definido",
  }[String(value.status)];
  const expectedStockUnitLabel =
    itemType === "COMPLETE_BOX"
      ? value.currentStock === 1
        ? "caixa montada"
        : "caixas montadas"
      : itemType === "SERVO"
        ? value.currentStock === 1
          ? "Servoembreagem"
          : "Servoembreagens"
        : itemType === "INSTALLATION_KIT"
          ? value.currentStock === 1
            ? "Kit de instalação"
            : "Kits de instalação"
          : itemType === "REPAIR_KIT"
            ? value.currentStock === 1
              ? "Jogo de reparo"
              : "Jogos de reparo"
            : itemType === "LOOSE_PART"
              ? value.currentStock === 1
                ? "unidade"
                : "unidades"
              : null;

  if (
    (value.targetKind !== "item" &&
      value.targetKind !== "commercial_configuration") ||
    typeof value.targetId !== "string" ||
    !uuidPattern.test(value.targetId) ||
    typeof value.displayCode !== "string" ||
    !value.displayCode.trim() ||
    ![
      "SERVO",
      "INSTALLATION_KIT",
      "REPAIR_KIT",
      "LOOSE_PART",
      "COMPLETE_BOX",
    ].includes(String(value.itemType)) ||
    typeof value.typeLabel !== "string" ||
    value.typeLabel !== expectedTypeLabel ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    !isNonnegativeInteger(value.currentStock) ||
    (minimumStock !== null && !isNonnegativeInteger(minimumStock)) ||
    typeof value.stockUnitLabel !== "string" ||
    value.stockUnitLabel !== expectedStockUnitLabel ||
    !["ZERO", "LOW", "OK", "NO_MINIMUM"].includes(
      String(value.status),
    ) ||
    typeof value.statusLabel !== "string" ||
    value.statusLabel !== expectedStatusLabel ||
    (shortfall !== null && !isNonnegativeInteger(shortfall)) ||
    (minimumStock === null
      ? value.status !== "NO_MINIMUM" || shortfall !== null
      : value.status === "NO_MINIMUM" ||
        shortfall !==
          Math.max(minimumStock - value.currentStock, 0)) ||
    (minimumStock !== null &&
      ((value.currentStock === 0 && value.status !== "ZERO") ||
        (value.currentStock > 0 &&
          value.currentStock <= minimumStock &&
          value.status !== "LOW") ||
        (value.currentStock > minimumStock &&
          value.status !== "OK"))) ||
    !isSafeInventoryHref(value.href) ||
    !isExpectedTargetHref(
      value.href,
      value.targetKind,
      value.targetId,
      null,
    ) ||
    mediaDescriptor === undefined ||
    (value.targetKind === "commercial_configuration") !==
      (itemType === "COMPLETE_BOX") ||
    (value.targetKind === "commercial_configuration" &&
      (!isRecord(composition) ||
        typeof composition.servoCode !== "string" ||
        !composition.servoCode.trim() ||
        typeof composition.servoDescription !== "string" ||
        !composition.servoDescription.trim() ||
        typeof composition.installationKitCode !== "string" ||
        !composition.installationKitCode.trim() ||
        typeof composition.installationKitDescription !== "string" ||
        !composition.installationKitDescription.trim())) ||
    (value.targetKind === "item" && composition !== undefined)
  ) {
    return null;
  }

  return {
    targetKind: value.targetKind,
    targetId: value.targetId,
    displayCode: value.displayCode,
    itemType:
      value.itemType as AssistantInventoryItemSummaryTarget["itemType"],
    typeLabel: value.typeLabel,
    description: value.description,
    currentStock: value.currentStock,
    minimumStock,
    stockUnitLabel: value.stockUnitLabel,
    status:
      value.status as AssistantInventoryItemSummaryTarget["status"],
    statusLabel: value.statusLabel,
    shortfall,
    href: value.href,
    mediaDescriptor,
    ...(value.targetKind === "commercial_configuration"
      ? {
          composition:
            composition as AssistantInventoryItemSummaryTarget["composition"],
        }
      : {}),
  };
}

function parsePurchaseRecommendationItem(
  value: unknown,
): PurchaseRecommendationItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const expectedTypeLabel = {
    SERVO: "Servoembreagem",
    INSTALLATION_KIT: "Kit de instalação",
    REPAIR_KIT: "Jogo de reparo",
    LOOSE_PART: "Peça avulsa",
    COMPLETE_BOX: "Caixa completa",
  }[String(value.itemType)];
  const aliases = Array.isArray(value.aliases) ? value.aliases : [];
  const relatedOrders = Array.isArray(value.relatedOrders)
    ? value.relatedOrders
    : [];
  const parsedOrders = relatedOrders.map((order) => {
    if (
      !isRecord(order) ||
      typeof order.orderId !== "string" ||
      !uuidPattern.test(order.orderId) ||
      typeof order.negotiationNumber !== "string" ||
      !order.negotiationNumber.trim() ||
      typeof order.orderDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(order.orderDate) ||
      !["PENDING", "PARTIAL", "COMPLETED", "CANCELLED"].includes(
        String(order.status),
      ) ||
      (order.closureKind !== null &&
        order.closureKind !== "FINALIZED" &&
        order.closureKind !== "CANCELLED") ||
      typeof order.codeSnapshot !== "string" ||
      !order.codeSnapshot.trim() ||
      !isNonnegativeInteger(order.pendingQuantity) ||
      order.pendingQuantity === 0 ||
      !isSafeSupplierOrdersHref(order.href, order.orderId)
    ) {
      return null;
    }

    return order;
  });
  const minimumStock = value.minimumStock;
  const projectedStock = value.projectedStock;
  const shortfall = value.shortfall;
  const recommendedQuantity = value.recommendedQuantity;
  const remainingGap = value.remainingGap;
  if (
    (value.targetKind !== "item" &&
      value.targetKind !== "commercial_configuration") ||
    typeof value.targetId !== "string" ||
    !uuidPattern.test(value.targetId) ||
    typeof value.primaryCode !== "string" ||
    !value.primaryCode.trim() ||
    !Array.isArray(value.aliases) ||
    aliases.length > 30 ||
    aliases.some(
      (alias) => typeof alias !== "string" || !alias.trim(),
    ) ||
    new Set(aliases).size !== aliases.length ||
    aliases.includes(value.primaryCode) ||
    ![
      "SERVO",
      "INSTALLATION_KIT",
      "REPAIR_KIT",
      "LOOSE_PART",
      "COMPLETE_BOX",
    ].includes(String(value.itemType)) ||
    typeof value.typeLabel !== "string" ||
    value.typeLabel !== expectedTypeLabel ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    !isNonnegativeInteger(value.currentStock) ||
    (minimumStock !== null && !isNonnegativeInteger(minimumStock)) ||
    !isNonnegativeInteger(value.pendingPurchaseQuantity) ||
    (projectedStock !== null && !isNonnegativeInteger(projectedStock)) ||
    (shortfall !== null && !isNonnegativeInteger(shortfall)) ||
    (recommendedQuantity !== null &&
      !isNonnegativeInteger(recommendedQuantity)) ||
    (remainingGap !== null && !isNonnegativeInteger(remainingGap)) ||
    !["BUY_NOW", "ALREADY_ORDERED", "MISSING_MINIMUM", "NO_ACTION"].includes(
      String(value.group),
    ) ||
    (value.coverage !== null &&
      value.coverage !== "SUFFICIENT" &&
      value.coverage !== "INSUFFICIENT") ||
    !isSafeInventoryHref(value.inventoryHref) ||
    !isExpectedTargetHref(
      value.inventoryHref,
      value.targetKind,
      value.targetId,
      null,
    ) ||
    !Array.isArray(value.relatedOrders) ||
    relatedOrders.length > 10 ||
    parsedOrders.some((order) => order === null) ||
    (value.targetKind === "commercial_configuration") !==
      (value.itemType === "COMPLETE_BOX") ||
    (minimumStock === null
      ? value.group !== "MISSING_MINIMUM" ||
        projectedStock !== null ||
        shortfall !== null ||
        recommendedQuantity !== null ||
        remainingGap !== null ||
        value.coverage !== null
      : projectedStock !==
          value.currentStock + value.pendingPurchaseQuantity ||
        shortfall !==
          Math.max(minimumStock - value.currentStock, 0) ||
        remainingGap !==
          Math.max(minimumStock - projectedStock, 0) ||
        (value.group === "BUY_NOW" &&
          (value.pendingPurchaseQuantity !== 0 ||
            shortfall === 0 ||
            recommendedQuantity !== shortfall ||
            value.coverage !== null)) ||
        (value.group === "ALREADY_ORDERED" &&
          (value.pendingPurchaseQuantity === 0 ||
            shortfall === 0 ||
            recommendedQuantity !== 0 ||
            value.coverage !==
              (remainingGap === 0 ? "SUFFICIENT" : "INSUFFICIENT"))) ||
        (value.group === "NO_ACTION" &&
          (shortfall !== 0 ||
            recommendedQuantity !== 0 ||
            value.coverage !== null)) ||
        value.group === "MISSING_MINIMUM")
  ) {
    return null;
  }

  return value as PurchaseRecommendationItem;
}

export function parseAssistantStructuredBlock(
  value: unknown,
): AssistantStructuredBlock | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "purchase_recommendation_list") {
    const summary = value.summary;
    const items = Array.isArray(value.items)
      ? value.items.map(parsePurchaseRecommendationItem)
      : [];
    const queryCode =
      typeof value.queryCode === "string"
        ? value.queryCode.trim()
        : value.queryCode === null
          ? null
          : undefined;
    const queryStatus =
      value.queryStatus === null ||
      ["FOUND", "AMBIGUOUS", "NOT_FOUND"].includes(
        String(value.queryStatus),
      )
        ? value.queryStatus
        : undefined;

    if (
      typeof value.title !== "string" ||
      !value.title.trim() ||
      typeof value.subtitle !== "string" ||
      !value.subtitle.trim() ||
      !["buy_now", "already_ordered", "missing_minimum", "all"].includes(
        String(value.mode),
      ) ||
      queryCode === undefined ||
      queryStatus === undefined ||
      (queryCode === null) !== (queryStatus === null) ||
      !isRecord(summary) ||
      !isNonnegativeInteger(summary.buyNowCount) ||
      !isNonnegativeInteger(summary.alreadyOrderedCount) ||
      !isNonnegativeInteger(summary.missingMinimumCount) ||
      typeof value.primaryText !== "string" ||
      !value.primaryText.trim() ||
      !Array.isArray(value.items) ||
      items.length > 10 ||
      items.some((item) => item === null) ||
      !isNonnegativeInteger(value.totalCount) ||
      !isNonnegativeInteger(value.remainingCount) ||
      value.totalCount !== items.length + value.remainingCount ||
      !isSafePurchaseRecommendationHref(value.listHref) ||
      typeof value.fallbackText !== "string" ||
      !value.fallbackText.trim() ||
      (queryStatus === "NOT_FOUND" && items.length !== 0) ||
      (queryStatus === "FOUND" && items.length !== 1) ||
      (queryStatus === "AMBIGUOUS" && items.length < 2) ||
      (value.mode === "buy_now" &&
        items.some((item) => item?.group !== "BUY_NOW")) ||
      (value.mode === "already_ordered" &&
        items.some((item) => item?.group !== "ALREADY_ORDERED")) ||
      (value.mode === "missing_minimum" &&
        items.some((item) => item?.group !== "MISSING_MINIMUM"))
    ) {
      return null;
    }

    return {
      kind: "purchase_recommendation_list",
      title: value.title.trim(),
      subtitle: value.subtitle.trim(),
      mode:
        value.mode as AssistantPurchaseRecommendationBlock["mode"],
      queryCode,
      queryStatus:
        queryStatus as AssistantPurchaseRecommendationBlock["queryStatus"],
      primaryText: value.primaryText.trim(),
      summary: {
        buyNowCount: summary.buyNowCount,
        alreadyOrderedCount: summary.alreadyOrderedCount,
        missingMinimumCount: summary.missingMinimumCount,
      },
      items: items as PurchaseRecommendationItem[],
      totalCount: value.totalCount,
      remainingCount: value.remainingCount,
      listHref: "/estoque?view=purchase-recommendations",
      fallbackText: value.fallbackText.trim(),
    };
  }

  if (value.kind === "assistant_clarification") {
    const options = Array.isArray(value.options) ? value.options : [];
    const parsedOptions = options.map((option) => {
      if (
        !isRecord(option) ||
        typeof option.id !== "string" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(option.id) ||
        typeof option.label !== "string" ||
        !option.label.trim() ||
        option.label.length > 60 ||
        typeof option.prompt !== "string" ||
        !option.prompt.trim() ||
        option.prompt.length > 200 ||
        ![
          "inventory",
          "supplier_orders",
          "replenishment",
          "media",
        ].includes(String(option.category))
      ) {
        return null;
      }

      return {
        id: option.id,
        label: option.label.trim(),
        prompt: option.prompt.trim(),
        category:
          option.category as AssistantClarificationCategory,
      };
    });
    const ids = parsedOptions.map((option) => option?.id);
    const prompts = parsedOptions.map((option) => option?.prompt);

    if (
      typeof value.title !== "string" ||
      !value.title.trim() ||
      value.title.length > 120 ||
      (value.message !== undefined &&
        (typeof value.message !== "string" ||
          !value.message.trim() ||
          value.message.length > 240)) ||
      options.length === 0 ||
      options.length > 6 ||
      parsedOptions.some((option) => option === null) ||
      new Set(ids).size !== ids.length ||
      new Set(prompts).size !== prompts.length ||
      typeof value.fallbackText !== "string" ||
      !value.fallbackText.trim() ||
      value.fallbackText.length > 1000
    ) {
      return null;
    }

    return {
      kind: "assistant_clarification",
      title: value.title.trim(),
      ...(typeof value.message === "string"
        ? { message: value.message.trim() }
        : {}),
      options: parsedOptions as AssistantClarificationOption[],
      fallbackText: value.fallbackText.trim(),
    };
  }

  if (value.kind === "inventory_alerts") {
    const summary = value.summary;
    const zeroItems = Array.isArray(value.zeroItems)
      ? value.zeroItems.map(parseInventoryAlertCard)
      : [];
    const lowItems = Array.isArray(value.lowItems)
      ? value.lowItems.map(parseInventoryAlertCard)
      : [];

    if (
      !isRecord(summary) ||
      !isNonnegativeInteger(summary.zeroCount) ||
      !isNonnegativeInteger(summary.lowCount) ||
      !isNonnegativeInteger(summary.totalCount) ||
      summary.totalCount !== summary.zeroCount + summary.lowCount ||
      !Array.isArray(value.zeroItems) ||
      !Array.isArray(value.lowItems) ||
      zeroItems.some((item) => item === null) ||
      lowItems.some((item) => item === null) ||
      zeroItems.some((item) => item?.status !== "ZERO") ||
      lowItems.some((item) => item?.status !== "LOW") ||
      zeroItems.length !== Math.min(summary.zeroCount, 10) ||
      lowItems.length !==
        Math.min(summary.lowCount, 10 - zeroItems.length) ||
      !isNonnegativeInteger(value.remainingCount) ||
      value.remainingCount !==
        summary.totalCount - zeroItems.length - lowItems.length ||
      value.inventoryHref !== "/estoque?status=attention" ||
      typeof value.fallbackText !== "string"
    ) {
      return null;
    }

    return {
      kind: "inventory_alerts",
      title: "Itens para repor",
      summary: {
        zeroCount: summary.zeroCount,
        lowCount: summary.lowCount,
        totalCount: summary.totalCount,
      },
      zeroItems: zeroItems as AssistantInventoryAlertCard[],
      lowItems: lowItems as AssistantInventoryAlertCard[],
      remainingCount: value.remainingCount,
      inventoryHref: "/estoque?status=attention",
      fallbackText: value.fallbackText,
    };
  }

  if (value.kind === "catalog_media") {
    const results = Array.isArray(value.results)
      ? value.results.map(parseCatalogMediaTarget)
      : [];

    if (
      typeof value.queryCode !== "string" ||
      !value.queryCode.trim() ||
      !["FOUND", "AMBIGUOUS", "NOT_FOUND"].includes(
        String(value.status),
      ) ||
      !Array.isArray(value.results) ||
      results.some((result) => result === null) ||
      (value.status === "NOT_FOUND" && results.length !== 0) ||
      (value.status === "FOUND" && results.length !== 1) ||
      (value.status === "AMBIGUOUS" && results.length < 2) ||
      !isSafeInventoryHref(value.inventoryHref) ||
      typeof value.fallbackText !== "string"
    ) {
      return null;
    }

    return {
      kind: "catalog_media",
      queryCode: value.queryCode,
      status: value.status as AssistantCatalogMediaBlock["status"],
      results: results as AssistantCatalogMediaTarget[],
      inventoryHref: value.inventoryHref,
      fallbackText: value.fallbackText,
    };
  }

  if (value.kind === "inventory_item_summary") {
    const results = Array.isArray(value.results)
      ? value.results.map(parseInventoryItemSummaryTarget)
      : [];

    if (
      typeof value.queryCode !== "string" ||
      !value.queryCode.trim() ||
      !["FOUND", "AMBIGUOUS", "NOT_FOUND"].includes(
        String(value.status),
      ) ||
      ![
        "STOCK",
        "MINIMUM",
        "STATUS",
        "SHORTFALL",
        "DESCRIPTION",
        "COMPOSITION",
      ].includes(String(value.metric)) ||
      !Array.isArray(value.results) ||
      results.some((result) => result === null) ||
      (value.status === "NOT_FOUND" && results.length !== 0) ||
      (value.status === "FOUND" && results.length !== 1) ||
      (value.status === "AMBIGUOUS" && results.length < 2) ||
      !isSafeInventoryHref(value.inventoryHref) ||
      typeof value.primaryText !== "string" ||
      !value.primaryText.trim() ||
      typeof value.fallbackText !== "string" ||
      !value.fallbackText.trim()
    ) {
      return null;
    }

    return {
      kind: "inventory_item_summary",
      queryCode: value.queryCode,
      status:
        value.status as AssistantInventoryItemSummaryBlock["status"],
      metric:
        value.metric as AssistantInventoryItemSummaryBlock["metric"],
      results:
        results as AssistantInventoryItemSummaryTarget[],
      inventoryHref: value.inventoryHref,
      primaryText: value.primaryText,
      fallbackText: value.fallbackText,
    };
  }

  if (
    value.kind === "supplier_order_list" ||
    value.kind === "supplier_order_ambiguity"
  ) {
    const orders = Array.isArray(value.orders)
      ? value.orders.map(parseSupplierOrderCard)
      : [];
    const catalogLines =
      value.kind === "supplier_order_list" &&
      Array.isArray(value.catalogLines)
        ? value.catalogLines.map(parseSupplierOrderCatalogLine)
        : [];
    const catalogCode =
      typeof value.catalogCode === "string"
        ? value.catalogCode
        : value.catalogCode === null
          ? null
          : undefined;

    if (
      typeof value.title !== "string" ||
      !value.title.trim() ||
      !Array.isArray(value.orders) ||
      orders.some((order) => order === null) ||
      orders.length > 10 ||
      !isSafeSupplierOrdersHref(value.ordersHref) ||
      typeof value.fallbackText !== "string"
    ) {
      return null;
    }

    if (value.kind === "supplier_order_ambiguity") {
      if (
        typeof value.description !== "string" ||
        !value.description.trim() ||
        orders.length < 2
      ) {
        return null;
      }

      return {
        kind: "supplier_order_ambiguity",
        title: value.title,
        description: value.description,
        orders: orders as AssistantSupplierOrderCard[],
        ordersHref: value.ordersHref,
        fallbackText: value.fallbackText,
      };
    }

    if (
      typeof value.filtersSummary !== "string" ||
      !isNonnegativeInteger(value.totalCount) ||
      !isNonnegativeInteger(value.remainingCount) ||
      value.totalCount !== orders.length + value.remainingCount ||
      catalogCode === undefined ||
      (typeof catalogCode === "string" && !catalogCode.trim()) ||
      !Array.isArray(value.catalogLines) ||
      catalogLines.some((line) => line === null) ||
      catalogLines.length > 30 ||
      (catalogCode === null && catalogLines.length !== 0) ||
      (typeof catalogCode === "string" &&
        (catalogLines.some(
          (line) =>
            line?.displayCode
              .trim()
              .replace(/\s+/g, " ")
              .toLocaleUpperCase("pt-BR") !==
            catalogCode
              .trim()
              .replace(/\s+/g, " ")
              .toLocaleUpperCase("pt-BR"),
        ) ||
          orders.some(
            (order) =>
              !catalogLines.some(
                (line) => line?.supplierOrderId === order?.id,
              ),
          ) ||
          catalogLines.some(
            (line) =>
              !orders.some(
                (order) => order?.id === line?.supplierOrderId,
              ),
          )))
    ) {
      return null;
    }

    return {
      kind: "supplier_order_list",
      title: value.title,
      filtersSummary: value.filtersSummary,
      totalCount: value.totalCount,
      remainingCount: value.remainingCount,
      orders: orders as AssistantSupplierOrderCard[],
      catalogCode,
      catalogLines:
        catalogLines as AssistantSupplierOrderCatalogLine[],
      ordersHref: value.ordersHref,
      fallbackText: value.fallbackText,
    };
  }

  if (value.kind === "supplier_order_detail") {
    const order = parseSupplierOrderCard(value.order);
    const items = Array.isArray(value.items)
      ? value.items.map(parseSupplierOrderItemCard)
      : [];

    if (
      typeof value.title !== "string" ||
      !value.title.trim() ||
      !order ||
      !Array.isArray(value.items) ||
      items.some((item) => item === null) ||
      items.length > 20 ||
      (value.catalogCode !== null &&
        (typeof value.catalogCode !== "string" ||
          !value.catalogCode.trim())) ||
      !isNonnegativeInteger(value.hiddenItemCount) ||
      typeof value.fallbackText !== "string"
    ) {
      return null;
    }

    return {
      kind: "supplier_order_detail",
      title: value.title,
      order,
      items: items as AssistantSupplierOrderItemCard[],
      catalogCode: value.catalogCode,
      hiddenItemCount: value.hiddenItemCount,
      fallbackText: value.fallbackText,
    };
  }

  if (value.kind === "supplier_order_aggregate") {
    if (
      typeof value.title !== "string" ||
      !value.title.trim() ||
      typeof value.filtersSummary !== "string" ||
      !isNonnegativeInteger(value.orderCount) ||
      !isNonnegativeInteger(value.orderedQuantity) ||
      !isNonnegativeInteger(value.pickedQuantity) ||
      !isNonnegativeInteger(value.waitingPickupQuantity) ||
      !isNonnegativeInteger(value.stockedQuantity) ||
      !isNonnegativeInteger(value.waitingStockQuantity) ||
      (value.catalogCode !== null &&
        (typeof value.catalogCode !== "string" ||
          !value.catalogCode.trim())) ||
      ![
        "ORDER_COUNT",
        "ORDERED_UNITS",
        "PICKED_UNITS",
        "WAITING_PICKUP_UNITS",
        "WAITING_STOCK_UNITS",
      ].includes(String(value.primaryMetric)) ||
      !isSafeSupplierOrdersHref(value.ordersHref) ||
      typeof value.fallbackText !== "string"
    ) {
      return null;
    }

    return {
      kind: "supplier_order_aggregate",
      title: value.title,
      filtersSummary: value.filtersSummary,
      orderCount: value.orderCount,
      orderedQuantity: value.orderedQuantity,
      pickedQuantity: value.pickedQuantity,
      waitingPickupQuantity: value.waitingPickupQuantity,
      stockedQuantity: value.stockedQuantity,
      waitingStockQuantity: value.waitingStockQuantity,
      catalogCode: value.catalogCode,
      primaryMetric:
        value.primaryMetric as AssistantSupplierOrderAggregateBlock["primaryMetric"],
      ordersHref: value.ordersHref,
      fallbackText: value.fallbackText,
    };
  }

  return null;
}
