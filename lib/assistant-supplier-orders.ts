import "server-only";

import { AssistantDataError } from "@/lib/assistant-data";
import {
  type AssistantMediaDescriptor,
  type AssistantSupplierOrderAggregateBlock,
  type AssistantSupplierOrderAmbiguityBlock,
  type AssistantSupplierOrderCard,
  type AssistantSupplierOrderCatalogLine,
  type AssistantSupplierOrderDetailBlock,
  type AssistantSupplierOrderItemCard,
  type AssistantSupplierOrderListBlock,
  type AssistantStructuredBlock,
} from "@/lib/assistant-types";
import type { SupplierOrderAssistantQuery } from "@/lib/ai/supplier-order-routing";
import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import { createCompatibleKitImageMap } from "@/lib/compatible-kit-images";
import {
  mapSupplierOrderItem,
  mapSupplierOrderSummary,
  supplierOrderItemSelect,
  supplierOrderSummarySelect,
  type SupplierOrderItemRow,
  type SupplierOrderSummaryRow,
} from "@/lib/supplier-orders-data";
import type {
  SupplierOrderItem,
  SupplierOrderSummary,
} from "@/lib/supplier-orders-types";
import { createClient } from "@/lib/supabase/server";

const listLimit = 10;
const detailItemLimit = 20;
const aggregateSafetyLimit = 1000;

type ConfigurationRow = {
  id: string;
  description: string | null;
  image_path: string | null;
  servo_id: string;
  installation_kit_id: string;
  is_active: boolean;
};

type ItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: string;
  is_active: boolean;
};

type CodeRow = {
  configuration_id: string;
  code: string;
  is_active: boolean;
};

type ServoModelRow = {
  item_id: string;
  model: string | null;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type SupabaseTableQuery = ReturnType<SupabaseServerClient["from"]>;
type SupabaseFilterQuery = ReturnType<SupabaseTableQuery["select"]>;

export type SupplierOrderAssistantResult = {
  block: AssistantStructuredBlock;
  contextSupplierOrderId: string | null;
};

function ordersHref(view: "active" | "history") {
  return `/pedidos?view=${view}` as const;
}

function orderHref(order: SupplierOrderSummary) {
  const view = order.isInHistory ? "history" : "active";
  return `/pedidos?view=${view}&order=${encodeURIComponent(order.id)}`;
}

function toOrderCard(order: SupplierOrderSummary): AssistantSupplierOrderCard {
  return {
    id: order.id,
    negotiationNumber: order.negotiationNumber,
    orderDate: order.orderDate,
    status: order.status,
    closureKind: order.closureKind,
    lineCount: order.lineCount,
    orderedQuantity: order.orderedQuantity,
    pickedQuantity: order.pickedQuantity,
    waitingPickupQuantity: order.waitingPickupQuantity,
    stockedQuantity: order.stockedQuantity,
    waitingStockQuantity: order.waitingStockQuantity,
    href: orderHref(order),
  };
}

function fallbackListText(
  title: string,
  totalCount: number,
  orders: SupplierOrderSummary[],
) {
  if (totalCount === 0) {
    return `${title}: nenhum pedido encontrado.`;
  }

  return [
    `${title}: ${totalCount} pedido${totalCount === 1 ? "" : "s"}.`,
    ...orders.map(
      (order) =>
        `- ${order.negotiationNumber}: ${order.status}, ${order.waitingPickupQuantity} para retirar e ${order.waitingStockQuantity} para entrada.`,
    ),
  ].join("\n");
}

function fallbackCatalogListText(
  catalogCode: string,
  totalCount: number,
  orders: SupplierOrderSummary[],
  catalogLines: AssistantSupplierOrderCatalogLine[],
) {
  if (totalCount === 0) {
    return `Nenhum pedido contém o Cód. ${catalogCode}.`;
  }

  return [
    `Pedidos com Cód. ${catalogCode}: ${totalCount} pedido${totalCount === 1 ? "" : "s"} encontrado${totalCount === 1 ? "" : "s"}.`,
    ...orders.flatMap((order) =>
      catalogLines
        .filter((line) => line.supplierOrderId === order.id)
        .map(
          (line) =>
            `- Pedido ${order.negotiationNumber}: solicitado ${line.orderedQuantity}, retirado ${line.pickedQuantity}, para retirar ${line.waitingPickupQuantity} e aguardando entrada ${line.waitingStockQuantity}.`,
        ),
    ),
  ].join("\n");
}

function nextIsoDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function applySummaryFilters(
  baseQuery: SupabaseFilterQuery,
  query: SupplierOrderAssistantQuery,
  catalogOrderIds: string[] | null,
) {
  let result = baseQuery;

  if (query.view === "active") result = result.eq("is_active_order", true);
  if (query.view === "history") result = result.eq("is_in_history", true);
  if (query.supplierOrderId) result = result.eq("id", query.supplierOrderId);
  if (query.negotiationNumber) {
    result = result.ilike(
      "negotiation_number",
      query.negotiationNumber,
    );
  }
  if (query.statuses.length === 1) {
    result = result.eq("status", query.statuses[0]);
  } else if (query.statuses.length > 1) {
    result = result.in("status", query.statuses);
  }
  if (
    query.statuses.includes("PENDING") ||
    query.statuses.includes("PARTIAL")
  ) {
    result = result.eq("is_finalized", false);
  }
  if (query.closureKinds.length > 0) {
    result = result.in("closure_kind", query.closureKinds);
  }
  if (query.hasWaitingPickup) {
    result = result.gt("waiting_pickup_quantity", 0);
  }
  if (query.hasWaitingStock) {
    result = result.gt("waiting_stock_quantity", 0);
  }
  if (query.fullyStockedAfterPickup) {
    result = result
      .gt("picked_quantity", 0)
      .eq("waiting_stock_quantity", 0);
  }
  if (query.dateFrom) {
    result = result.gte(
      query.dateField,
      query.dateField === "closed_at"
        ? `${query.dateFrom}T00:00:00-03:00`
        : query.dateFrom,
    );
  }
  if (query.dateTo) {
    result =
      query.dateField === "closed_at"
        ? result.lt(
            "closed_at",
            `${nextIsoDate(query.dateTo)}T00:00:00-03:00`,
          )
        : result.lte("order_date", query.dateTo);
  }
  if (catalogOrderIds) result = result.in("id", catalogOrderIds);

  switch (query.sort) {
    case "ORDER_DATE_ASC":
      return result
        .order("order_date", { ascending: true })
        .order("created_at", { ascending: true });
    case "WAITING_PICKUP_DESC":
      return result
        .order("waiting_pickup_quantity", { ascending: false })
        .order("order_date", { ascending: false });
    case "WAITING_STOCK_DESC":
      return result
        .order("waiting_stock_quantity", { ascending: false })
        .order("order_date", { ascending: false });
    default:
      return result
        .order("order_date", { ascending: false })
        .order("created_at", { ascending: false });
  }
}

async function findOrderIdsByCatalogCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  catalogCode: string | null,
) {
  if (!catalogCode) {
    return null;
  }

  const [codeResult, commercialCodeResult] = await Promise.all([
    supabase
      .from("supplier_order_item_details")
      .select("supplier_order_id")
      .ilike("code_snapshot", catalogCode),
    supabase
      .from("supplier_order_item_details")
      .select("supplier_order_id")
      .ilike("commercial_code_snapshot", catalogCode),
  ]);

  if (codeResult.error || commercialCodeResult.error) {
    throw new AssistantDataError();
  }

  return Array.from(
    new Set(
      [...(codeResult.data ?? []), ...(commercialCodeResult.data ?? [])].map(
        (row) => row.supplier_order_id as string,
      ),
    ),
  );
}

async function loadSummaries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: SupplierOrderAssistantQuery,
) {
  const catalogOrderIds = await findOrderIdsByCatalogCode(
    supabase,
    query.catalogCode,
  );

  if (catalogOrderIds?.length === 0) {
    return { summaries: [], totalCount: 0 };
  }

  const requestedLimit =
    query.mode === "AGGREGATE"
      ? aggregateSafetyLimit + 1
      : query.negotiationNumber
        ? listLimit
        : query.resultLimit;
  const summariesQuery = applySummaryFilters(
    supabase
      .from("supplier_order_summaries")
      .select(supplierOrderSummarySelect, { count: "exact" }),
    query,
    catalogOrderIds,
  ).limit(requestedLimit);
  const result = await summariesQuery;

  if (result.error) {
    throw new AssistantDataError();
  }

  const totalCount = result.count ?? 0;
  if (query.mode === "AGGREGATE" && totalCount > aggregateSafetyLimit) {
    throw new AssistantDataError();
  }

  const summaries = (
    (result.data ?? []) as SupplierOrderSummaryRow[]
  )
    .map(mapSupplierOrderSummary)
    .filter((summary): summary is SupplierOrderSummary => Boolean(summary));

  return { summaries, totalCount };
}

function resolvePrimaryView(
  query: SupplierOrderAssistantQuery,
  summaries: SupplierOrderSummary[],
) {
  if (query.view === "history") return "history" as const;
  if (query.view === "active") return "active" as const;
  return summaries.length > 0 &&
    summaries.every((order) => order.isInHistory)
    ? ("history" as const)
    : ("active" as const);
}

function buildListBlock(
  query: SupplierOrderAssistantQuery,
  summaries: SupplierOrderSummary[],
  totalCount: number,
  catalogLines: AssistantSupplierOrderCatalogLine[],
): AssistantSupplierOrderListBlock {
  const view = resolvePrimaryView(query, summaries);
  const title = getListTitle(query);
  const resultSummary =
    totalCount === 0
      ? "Nenhum pedido encontrado"
      : totalCount === 1
        ? "1 pedido encontrado"
        : `${totalCount} pedidos encontrados`;

  return {
    kind: "supplier_order_list",
    title,
    filtersSummary: resultSummary,
    totalCount,
    remainingCount: Math.max(0, totalCount - summaries.length),
    orders: summaries.map(toOrderCard),
    catalogCode: query.catalogCode,
    catalogLines,
    ordersHref: ordersHref(view),
    fallbackText:
      totalCount === 0 && query.negotiationNumber
        ? `Não encontrei um pedido com a negociação “${query.negotiationNumber}”.`
        : query.catalogCode
          ? fallbackCatalogListText(
              query.catalogCode,
              totalCount,
              summaries,
              catalogLines,
            )
          : fallbackListText(title, totalCount, summaries),
  };
}

function getListTitle(query: SupplierOrderAssistantQuery) {
  if (query.negotiationNumber) {
    return "Pedido não encontrado";
  }

  if (query.catalogCode) {
    return `Pedidos com Cód. ${query.catalogCode}`;
  }

  const statusTitle =
    query.statuses.length === 1
      ? {
          PENDING: "Pedidos pendentes",
          PARTIAL: "Pedidos parciais",
          COMPLETED: "Pedidos concluídos",
          CANCELLED: "Pedidos cancelados",
        }[query.statuses[0]]
      : null;
  const closureTitle =
    query.closureKinds.length === 1
      ? query.closureKinds[0] === "FINALIZED"
        ? "Pedidos finalizados"
        : "Pedidos cancelados"
      : null;
  const baseTitle =
    closureTitle ??
    statusTitle ??
    (query.view === "active"
      ? "Pedidos ativos"
      : query.view === "history"
        ? "Pedidos no Histórico"
        : query.dateFrom || query.dateTo
            ? "Pedidos do período"
            : "Pedidos encontrados");

  if (query.hasWaitingStock && !baseTitle.includes("entrada pendente")) {
    return statusTitle
      ? `${baseTitle} com entrada pendente`
      : "Pedidos com entrada pendente";
  }

  if (
    query.hasWaitingPickup &&
    !baseTitle.includes("retirada pendente")
  ) {
    return statusTitle
      ? `${baseTitle} com retirada pendente`
      : "Pedidos com retirada pendente";
  }

  return baseTitle;
}

function buildAmbiguityBlock(
  summaries: SupplierOrderSummary[],
): AssistantSupplierOrderAmbiguityBlock {
  const view = resolvePrimaryView(
    {
      view: "all",
    } as SupplierOrderAssistantQuery,
    summaries,
  );

  return {
    kind: "supplier_order_ambiguity",
    title: "Encontrei mais de um pedido",
    description:
      "A mesma negociação aparece em mais de um pedido. Escolha o registro correto pela data e situação.",
    orders: summaries.slice(0, listLimit).map(toOrderCard),
    ordersHref: ordersHref(view),
    fallbackText: `Encontrei ${summaries.length} pedidos com essa negociação. Escolha o correto pela data e situação.`,
  };
}

function typeLabel(item: SupplierOrderItem) {
  switch (item.itemTypeSnapshot) {
    case "SERVO":
      return "Servo";
    case "INSTALLATION_KIT":
      return "Kit de instalação";
    case "REPAIR_KIT":
      return "Jogo de reparo";
    case "LOOSE_PART":
      return "Peça avulsa";
    default:
      return "Caixa completa";
  }
}

async function attachItemMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: SupplierOrderItem[],
) {
  const configurationIds = Array.from(
    new Set(
      items.flatMap((item) =>
        item.commercialConfigurationId
          ? [item.commercialConfigurationId]
          : [],
      ),
    ),
  );
  const installationKitIds = Array.from(
    new Set(
      items.flatMap((item) =>
        item.itemTypeSnapshot === "INSTALLATION_KIT" && item.itemId
          ? [item.itemId]
          : [],
      ),
    ),
  );

  if (configurationIds.length === 0 && installationKitIds.length === 0) {
    return new Map<string, AssistantMediaDescriptor>();
  }

  const filters = [
    configurationIds.length > 0
      ? `id.in.(${configurationIds.join(",")})`
      : null,
    installationKitIds.length > 0
      ? `installation_kit_id.in.(${installationKitIds.join(",")})`
      : null,
  ].filter(Boolean);
  const configurationsResult = await supabase
    .from("commercial_configurations")
    .select(
      "id, description, image_path, servo_id, installation_kit_id, is_active",
    )
    .or(filters.join(","));

  if (configurationsResult.error) {
    throw new AssistantDataError();
  }

  const configurations = (configurationsResult.data ?? []) as ConfigurationRow[];
  const relatedItemIds = Array.from(
    new Set(
      configurations.flatMap((configuration) => [
        configuration.servo_id,
        configuration.installation_kit_id,
      ]),
    ),
  );
  const relatedConfigurationIds = configurations.map(
    (configuration) => configuration.id,
  );
  const [itemsResult, modelsResult, codesResult, imageUrls] =
    await Promise.all([
      relatedItemIds.length > 0
        ? supabase
            .from("items")
            .select("id, code, description, item_type, is_active")
            .in("id", relatedItemIds)
        : Promise.resolve({ data: [], error: null }),
      relatedItemIds.length > 0
        ? supabase
            .from("servo_models")
            .select("item_id, model")
            .in("item_id", relatedItemIds)
        : Promise.resolve({ data: [], error: null }),
      relatedConfigurationIds.length > 0
        ? supabase
            .from("commercial_configuration_codes")
            .select("configuration_id, code, is_active")
            .in("configuration_id", relatedConfigurationIds)
        : Promise.resolve({ data: [], error: null }),
      createCommercialImageUrlMap(
        supabase,
        configurations.map((configuration) => configuration.image_path),
      ),
    ]);

  if (itemsResult.error || modelsResult.error || codesResult.error) {
    throw new AssistantDataError();
  }

  const relatedItems = (itemsResult.data ?? []) as ItemRow[];
  const models = (modelsResult.data ?? []) as ServoModelRow[];
  const codes = (codesResult.data ?? []) as CodeRow[];
  const itemById = new Map(relatedItems.map((item) => [item.id, item]));
  const modelById = new Map(models.map((model) => [model.item_id, model.model]));
  const codesByConfiguration = new Map<string, string[]>();
  const activeCodesByConfiguration = new Map<string, string[]>();
  codes.forEach((code) => {
    const current = codesByConfiguration.get(code.configuration_id) ?? [];
    current.push(code.code);
    codesByConfiguration.set(code.configuration_id, current);
    if (code.is_active) {
      const active =
        activeCodesByConfiguration.get(code.configuration_id) ?? [];
      active.push(code.code);
      activeCodesByConfiguration.set(code.configuration_id, active);
    }
  });
  codesByConfiguration.forEach((values) =>
    values.sort((first, second) =>
      first.localeCompare(second, "pt-BR", {
        numeric: true,
        sensitivity: "base",
      }),
    ),
  );
  activeCodesByConfiguration.forEach((values) =>
    values.sort((first, second) =>
      first.localeCompare(second, "pt-BR", {
        numeric: true,
        sensitivity: "base",
      }),
    ),
  );
  const configurationImageDescriptors = new Map<
    string,
    AssistantMediaDescriptor
  >();
  const compatibleImageMap = createCompatibleKitImageMap(
    configurations.flatMap((configuration) => {
      const servo = itemById.get(configuration.servo_id);
      const kit = itemById.get(configuration.installation_kit_id);
      const imageUrl = configuration.image_path
        ? (imageUrls.get(configuration.image_path) ?? null)
        : null;
      const commercialCodes =
        codesByConfiguration.get(configuration.id) ?? [];

      if (!servo || !kit || !imageUrl || commercialCodes.length === 0) {
        return [];
      }

      configurationImageDescriptors.set(configuration.id, {
        kind: "commercial_configuration_image",
        commercialCodes,
        imageUrl,
      });

      if (
        !configuration.is_active ||
        !servo.is_active ||
        !kit.is_active ||
        (activeCodesByConfiguration.get(configuration.id) ?? []).length === 0
      ) {
        return [];
      }

      return [
        {
          installationKitId: kit.id,
          configurationId: configuration.id,
          commercialCodes:
            activeCodesByConfiguration.get(configuration.id) ?? [],
          servoCode: servo.code,
          servoDescription: servo.description,
          servoModel: modelById.get(servo.id) ?? null,
          installationKitCode: kit.code,
          description:
            configuration.description?.trim() ||
            `${servo.description} + ${kit.code}`,
          imageUrl,
        },
      ];
    }),
  );
  const mediaByItemId = new Map<string, AssistantMediaDescriptor>();
  installationKitIds.forEach((kitId) => {
    const options = compatibleImageMap.get(kitId) ?? [];
    const kit = itemById.get(kitId);
    if (kit && options.length > 0) {
      mediaByItemId.set(kitId, {
        kind: "compatible_kit_images",
        kitCode: kit.code,
        options,
      });
    }
  });

  const result = new Map<string, AssistantMediaDescriptor>();
  items.forEach((item) => {
    const descriptor = item.commercialConfigurationId
      ? configurationImageDescriptors.get(item.commercialConfigurationId)
      : item.itemId
        ? mediaByItemId.get(item.itemId)
        : null;
    if (descriptor) result.set(item.id, descriptor);
  });
  return result;
}

async function loadDetailItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  query: SupplierOrderAssistantQuery,
) {
  let itemsQuery = supabase
    .from("supplier_order_item_details")
    .select(supplierOrderItemSelect)
    .eq("supplier_order_id", orderId)
    .order("position", { ascending: true });

  if (query.catalogCode) {
    itemsQuery = itemsQuery.or(
      `code_snapshot.ilike.${query.catalogCode},commercial_code_snapshot.ilike.${query.catalogCode}`,
    );
  }
  if (query.lineFocus === "WAITING_PICKUP") {
    itemsQuery = itemsQuery.gt("waiting_pickup_quantity", 0);
  }
  if (query.lineFocus === "WAITING_STOCK") {
    itemsQuery = itemsQuery.gt("waiting_stock_quantity", 0);
  }

  const result = await itemsQuery.limit(detailItemLimit + 1);
  if (result.error) {
    throw new AssistantDataError();
  }

  const allItems = ((result.data ?? []) as SupplierOrderItemRow[])
    .map(mapSupplierOrderItem)
    .filter((item): item is SupplierOrderItem => Boolean(item));
  const visibleItems = allItems.slice(0, detailItemLimit);
  const mediaByItemId = await attachItemMedia(supabase, visibleItems);
  return {
    items: visibleItems,
    hiddenItemCount: Math.max(0, allItems.length - visibleItems.length),
    mediaByItemId,
  };
}

function toItemCard(
  item: SupplierOrderItem,
  mediaDescriptor: AssistantMediaDescriptor | null,
): AssistantSupplierOrderItemCard {
  return {
    id: item.id,
    displayCode: item.commercialCodeSnapshot ?? item.codeSnapshot,
    description: item.descriptionSnapshot,
    typeLabel: typeLabel(item),
    orderedQuantity: item.orderedQuantity,
    pickedQuantity: item.pickedQuantity,
    waitingPickupQuantity: item.waitingPickupQuantity,
    stockedQuantity: item.stockedQuantity,
    waitingStockQuantity: item.waitingStockQuantity,
    cancelledQuantity: item.cancelledQuantity,
    mediaDescriptor,
  };
}

async function loadCatalogLinesForOrders(
  supabase: Awaited<ReturnType<typeof createClient>>,
  summaries: SupplierOrderSummary[],
  catalogCode: string | null,
): Promise<AssistantSupplierOrderCatalogLine[]> {
  if (!catalogCode || summaries.length === 0) {
    return [];
  }

  const result = await supabase
    .from("supplier_order_item_details")
    .select(supplierOrderItemSelect)
    .in(
      "supplier_order_id",
      summaries.map((summary) => summary.id),
    )
    .or(
      `code_snapshot.ilike.${catalogCode},commercial_code_snapshot.ilike.${catalogCode}`,
    )
    .order("supplier_order_id", { ascending: true })
    .order("position", { ascending: true })
    .limit(31);

  if (result.error || (result.data?.length ?? 0) > 30) {
    throw new AssistantDataError();
  }

  const lines = ((result.data ?? []) as SupplierOrderItemRow[])
    .map(mapSupplierOrderItem)
    .filter((item): item is SupplierOrderItem => Boolean(item))
    .map((item) => {
      const card = toItemCard(item, null);

      return {
        ...card,
        displayCode: catalogCode,
        supplierOrderId: item.supplierOrderId,
      };
    });

  if (
    summaries.some(
      (summary) =>
        !lines.some((line) => line.supplierOrderId === summary.id),
    )
  ) {
    throw new AssistantDataError();
  }

  return lines;
}

async function buildDetailBlock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  order: SupplierOrderSummary,
  query: SupplierOrderAssistantQuery,
): Promise<AssistantSupplierOrderDetailBlock> {
  const { items, hiddenItemCount, mediaByItemId } = await loadDetailItems(
    supabase,
    order.id,
    query,
  );

  return {
    kind: "supplier_order_detail",
    title: `Pedido ${order.negotiationNumber}`,
    order: toOrderCard(order),
    items: items.map((item) =>
      toItemCard(item, mediaByItemId.get(item.id) ?? null),
    ),
    catalogCode: query.catalogCode,
    hiddenItemCount,
    fallbackText:
      query.catalogCode && items.length > 0
        ? `Pedido ${order.negotiationNumber}, Cód. ${query.catalogCode}: ${items
            .map(
              (item) =>
                `${item.orderedQuantity} solicitadas, ${item.pickedQuantity} retiradas, ${item.waitingPickupQuantity} para retirar e ${item.waitingStockQuantity} aguardando entrada`,
            )
            .join("; ")}.`
        : `Pedido ${order.negotiationNumber}: ${order.orderedQuantity} unidades pedidas, ${order.pickedQuantity} retiradas, ${order.waitingPickupQuantity} para retirar e ${order.waitingStockQuantity} para entrada.`,
  };
}

function buildAggregateBlock(
  query: SupplierOrderAssistantQuery,
  summaries: SupplierOrderSummary[],
  lineTotals?: {
    orderedQuantity: number;
    pickedQuantity: number;
    waitingPickupQuantity: number;
    stockedQuantity: number;
    waitingStockQuantity: number;
  },
): AssistantSupplierOrderAggregateBlock {
  const totals =
    lineTotals ??
    summaries.reduce(
      (result, order) => ({
        orderedQuantity: result.orderedQuantity + order.orderedQuantity,
        pickedQuantity: result.pickedQuantity + order.pickedQuantity,
        waitingPickupQuantity:
          result.waitingPickupQuantity + order.waitingPickupQuantity,
        stockedQuantity: result.stockedQuantity + order.stockedQuantity,
        waitingStockQuantity:
          result.waitingStockQuantity + order.waitingStockQuantity,
      }),
      {
        orderedQuantity: 0,
        pickedQuantity: 0,
        waitingPickupQuantity: 0,
        stockedQuantity: 0,
        waitingStockQuantity: 0,
      },
    );
  const view = resolvePrimaryView(query, summaries);

  return {
    kind: "supplier_order_aggregate",
    title: query.catalogCode
      ? `Cód. ${query.catalogCode} nos Pedidos`
      : "Resumo dos pedidos",
    filtersSummary: query.catalogCode
      ? `${summaries.length} pedido${summaries.length === 1 ? " encontrado" : "s encontrados"}`
      : query.description,
    orderCount: summaries.length,
    ...totals,
    catalogCode: query.catalogCode,
    primaryMetric: query.aggregateMetric ?? "ORDER_COUNT",
    ordersHref: ordersHref(view),
    fallbackText: query.catalogCode
      ? `Cód. ${query.catalogCode} em ${summaries.length} pedido${summaries.length === 1 ? "" : "s"}: solicitado ${totals.orderedQuantity}, retirado ${totals.pickedQuantity}, para retirar ${totals.waitingPickupQuantity} e aguardando entrada ${totals.waitingStockQuantity}.`
      : `${summaries.length} pedido${summaries.length === 1 ? "" : "s"}: ${totals.orderedQuantity} unidades pedidas, ${totals.pickedQuantity} retiradas, ${totals.waitingPickupQuantity} para retirar e ${totals.waitingStockQuantity} para entrada.`,
  };
}

async function loadCatalogAggregateTotals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  summaries: SupplierOrderSummary[],
  catalogCode: string,
) {
  if (summaries.length === 0) {
    return {
      orderedQuantity: 0,
      pickedQuantity: 0,
      waitingPickupQuantity: 0,
      stockedQuantity: 0,
      waitingStockQuantity: 0,
    };
  }

  const result = await supabase
    .from("supplier_order_item_details")
    .select(
      "ordered_quantity, picked_quantity, waiting_pickup_quantity, stocked_quantity, waiting_stock_quantity",
    )
    .in(
      "supplier_order_id",
      summaries.map((summary) => summary.id),
    )
    .or(
      `code_snapshot.ilike.${catalogCode},commercial_code_snapshot.ilike.${catalogCode}`,
    )
    .limit(aggregateSafetyLimit + 1);

  if (result.error || (result.data?.length ?? 0) > aggregateSafetyLimit) {
    throw new AssistantDataError();
  }

  return (result.data ?? []).reduce(
    (totals, row) => ({
      orderedQuantity:
        totals.orderedQuantity + Number(row.ordered_quantity ?? 0),
      pickedQuantity:
        totals.pickedQuantity + Number(row.picked_quantity ?? 0),
      waitingPickupQuantity:
        totals.waitingPickupQuantity +
        Number(row.waiting_pickup_quantity ?? 0),
      stockedQuantity:
        totals.stockedQuantity + Number(row.stocked_quantity ?? 0),
      waitingStockQuantity:
        totals.waitingStockQuantity +
        Number(row.waiting_stock_quantity ?? 0),
    }),
    {
      orderedQuantity: 0,
      pickedQuantity: 0,
      waitingPickupQuantity: 0,
      stockedQuantity: 0,
      waitingStockQuantity: 0,
    },
  );
}

export async function consultAssistantSupplierOrders(
  query: SupplierOrderAssistantQuery,
): Promise<SupplierOrderAssistantResult> {
  const supabase = await createClient();
  const { summaries, totalCount } = await loadSummaries(supabase, query);

  if (
    query.negotiationNumber &&
    query.mode === "DETAIL" &&
    summaries.length > 1
  ) {
    return {
      block: buildAmbiguityBlock(summaries),
      contextSupplierOrderId: null,
    };
  }

  if (query.mode === "DETAIL" && summaries.length === 1) {
    const order = summaries[0];
    return {
      block: await buildDetailBlock(supabase, order, query),
      contextSupplierOrderId: order.id,
    };
  }

  if (query.mode === "AGGREGATE") {
    const lineTotals = query.catalogCode
      ? await loadCatalogAggregateTotals(
          supabase,
          summaries,
          query.catalogCode,
        )
      : undefined;

    return {
      block: buildAggregateBlock(query, summaries, lineTotals),
      contextSupplierOrderId: null,
    };
  }

  const catalogLines = await loadCatalogLinesForOrders(
    supabase,
    summaries,
    query.catalogCode,
  );

  return {
    block: buildListBlock(
      query,
      summaries,
      totalCount,
      catalogLines,
    ),
    contextSupplierOrderId:
      totalCount === 1 && summaries.length === 1 ? summaries[0].id : null,
  };
}
