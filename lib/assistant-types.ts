import type { PhysicalStockItemType } from "@/lib/stock-calculations";
import type { CompatibleKitImageOption } from "@/lib/compatible-kit-images";

export const assistantMessageMaxLength = 2000;
export const assistantQueryMaxLength = 120;
export const assistantRequestMaxCharacters = 4096;

export type AssistantChatRequest = {
  message: string;
  lastItemQuery?: string;
};

export type AssistantChatSuccess = {
  message: string;
  contextItemQuery?: string | null;
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

export type AssistantStructuredBlock =
  | AssistantInventoryAlertsBlock
  | AssistantCatalogMediaBlock;

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

export function parseAssistantStructuredBlock(
  value: unknown,
): AssistantStructuredBlock | null {
  if (!isRecord(value)) {
    return null;
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

  return null;
}
