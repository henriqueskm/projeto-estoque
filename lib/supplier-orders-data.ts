import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import { createCompatibleKitImageMap } from "@/lib/compatible-kit-images";
import { toSafeWaitingStockQuantity } from "@/lib/ai/supplier-order-stock-entry-plan";
import {
  physicalItemTypes,
  type PhysicalItemType,
} from "@/lib/inbound-types";
import { createClient } from "@/lib/supabase/server";
import {
  supplierOrderClosureKinds,
  supplierOrderEventTypes,
  supplierOrderStatuses,
  type SupplierOrderCatalog,
  type SupplierOrderCatalogConfiguration,
  type SupplierOrderCatalogPhysicalItem,
  type SupplierOrderDetailData,
  type SupplierOrderEvent,
  type SupplierOrderEventType,
  type SupplierOrderClosureKind,
  type SupplierOrderItem,
  type SupplierOrderMediaData,
  type SupplierOrderMediaItem,
  type SupplierOrderSearchData,
  type SupplierOrderStatus,
  type SupplierOrderSummariesData,
  type SupplierOrderSummary,
  type SupplierOrderView,
} from "@/lib/supplier-orders-types";

export type SupplierOrderSummaryRow = {
  id: string;
  negotiation_number: string;
  order_date: string;
  notes: string | null;
  created_by_name_snapshot: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_by_name_snapshot: string | null;
  cancellation_note: string | null;
  finalized_at: string | null;
  finalized_by_name_snapshot: string | null;
  finalization_note: string | null;
  is_finalized: boolean;
  is_active_order: boolean;
  is_in_history: boolean;
  closure_kind: string | null;
  closed_at: string | null;
  closed_by_name_snapshot: string | null;
  line_count: number;
  ordered_quantity: number;
  ready_quantity: number;
  picked_quantity: number;
  cancelled_quantity: number;
  waiting_pickup_quantity: number;
  waiting_ready_quantity: number;
  ready_waiting_pickup_quantity: number;
  stocked_quantity: number;
  waiting_stock_quantity: number;
  pickup_percentage: number | string;
  status: string;
};

export type SupplierOrderItemRow = {
  id: string;
  supplier_order_id: string;
  item_id: string | null;
  commercial_configuration_id: string | null;
  commercial_configuration_code_id: string | null;
  code_snapshot: string;
  description_snapshot: string;
  model_snapshot: string | null;
  item_type_snapshot: string;
  commercial_code_snapshot: string | null;
  ordered_quantity: number;
  ready_quantity: number;
  picked_quantity: number;
  stocked_quantity: number;
  cancelled_quantity: number;
  waiting_pickup_quantity: number;
  waiting_ready_quantity: number;
  ready_waiting_pickup_quantity: number;
  waiting_stock_quantity: number;
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  supplier_order_id: string;
  supplier_order_item_id: string | null;
  event_type: string;
  user_name_snapshot: string;
  previous_quantity: number | null;
  new_quantity: number | null;
  quantity_delta: number | null;
  description: string | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: PhysicalItemType;
  is_active: boolean;
};

type ServoModelRow = { item_id: string; model: string | null };

type ConfigurationRow = {
  id: string;
  description: string | null;
  image_path: string | null;
  servo_id: string;
  installation_kit_id: string;
  is_active: boolean;
};

type CommercialCodeRow = {
  id: string;
  code: string;
  configuration_id: string;
  is_active: boolean;
};

type SupplierOrdersClient = Awaited<ReturnType<typeof createClient>>;

export type SupplierOrdersDataResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

type PerformanceMetric = {
  loader: "summaries" | "detail_core" | "detail_media" | "catalog" | "search";
  durationMs: number;
  queryCount: number;
  waveCount: number;
  rowCount: number;
  payloadBytes: number;
  detail_core_ms?: number;
  enrichment_ms?: number;
  signed_urls_ms?: number;
};

const eventSelect =
  "id, supplier_order_id, supplier_order_item_id, event_type, user_name_snapshot, previous_quantity, new_quantity, quantity_delta, description, created_at";
const configurationSelect =
  "id, description, image_path, servo_id, installation_kit_id, is_active";

function shouldLogPerformance() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview"
  );
}

function measurePayload(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function logPerformance(metric: PerformanceMetric) {
  if (!shouldLogPerformance()) return;
  console.info(
    JSON.stringify({ event: "supplier_orders_performance", ...metric }),
  );
}

function compareCodes(first: { code: string }, second: { code: string }) {
  return first.code.localeCompare(second.code, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function isSupplierOrderStatus(value: string): value is SupplierOrderStatus {
  return supplierOrderStatuses.some((status) => status === value);
}

function isSupplierOrderEventType(value: string): value is SupplierOrderEventType {
  return supplierOrderEventTypes.some((eventType) => eventType === value);
}

function isSupplierOrderClosureKind(
  value: string | null,
): value is SupplierOrderClosureKind {
  return (
    value !== null &&
    supplierOrderClosureKinds.some((closureKind) => closureKind === value)
  );
}

function asSafeInteger(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function isSupplierOrderView(value: unknown): value is SupplierOrderView {
  return value === "active" || value === "history";
}

export function isSupplierOrderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export const supplierOrderSummarySelect =
  "id, negotiation_number, order_date, notes, created_by_name_snapshot, created_at, updated_at, cancelled_at, cancelled_by_name_snapshot, cancellation_note, finalized_at, finalized_by_name_snapshot, finalization_note, is_finalized, is_active_order, is_in_history, closure_kind, closed_at, closed_by_name_snapshot, line_count, ordered_quantity, ready_quantity, picked_quantity, cancelled_quantity, waiting_pickup_quantity, waiting_ready_quantity, ready_waiting_pickup_quantity, stocked_quantity, waiting_stock_quantity, pickup_percentage, status";

export const supplierOrderListSummarySelect =
  "id, negotiation_number, order_date, created_at, updated_at, is_finalized, is_active_order, is_in_history, closure_kind, closed_at, line_count, ordered_quantity, ready_quantity, picked_quantity, cancelled_quantity, waiting_pickup_quantity, waiting_ready_quantity, ready_waiting_pickup_quantity, stocked_quantity, waiting_stock_quantity, pickup_percentage, status";

export const supplierOrderItemSelect =
  "id, supplier_order_id, item_id, commercial_configuration_id, commercial_configuration_code_id, code_snapshot, description_snapshot, model_snapshot, item_type_snapshot, commercial_code_snapshot, ordered_quantity, ready_quantity, picked_quantity, stocked_quantity, cancelled_quantity, waiting_pickup_quantity, waiting_ready_quantity, ready_waiting_pickup_quantity, waiting_stock_quantity, position, notes, created_at, updated_at";

export function mapSupplierOrderSummary(
  row: SupplierOrderSummaryRow,
): SupplierOrderSummary | null {
  if (!isSupplierOrderStatus(row.status)) return null;
  return {
    id: row.id,
    negotiationNumber: row.negotiation_number,
    orderDate: row.order_date,
    notes: row.notes,
    createdByName: row.created_by_name_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
    cancelledByName: row.cancelled_by_name_snapshot,
    cancellationNote: row.cancellation_note,
    finalizedAt: row.finalized_at,
    finalizedByName: row.finalized_by_name_snapshot,
    finalizationNote: row.finalization_note,
    isFinalized: row.is_finalized,
    isActiveOrder: row.is_active_order,
    isInHistory: row.is_in_history,
    closureKind: isSupplierOrderClosureKind(row.closure_kind)
      ? row.closure_kind
      : null,
    closedAt: row.closed_at,
    closedByName: row.closed_by_name_snapshot,
    lineCount: asSafeInteger(row.line_count),
    orderedQuantity: asSafeInteger(row.ordered_quantity),
    readyQuantity: asSafeInteger(row.ready_quantity),
    pickedQuantity: asSafeInteger(row.picked_quantity),
    cancelledQuantity: asSafeInteger(row.cancelled_quantity),
    waitingPickupQuantity: asSafeInteger(row.waiting_pickup_quantity),
    waitingReadyQuantity: asSafeInteger(row.waiting_ready_quantity),
    readyWaitingPickupQuantity: asSafeInteger(row.ready_waiting_pickup_quantity),
    stockedQuantity: asSafeInteger(row.stocked_quantity),
    waitingStockQuantity: toSafeWaitingStockQuantity(row.waiting_stock_quantity),
    pickupPercentage: Number(row.pickup_percentage) || 0,
    status: row.status,
  };
}

function mapSupplierOrderListSummary(
  row: Omit<
    SupplierOrderSummaryRow,
    | "notes"
    | "created_by_name_snapshot"
    | "cancelled_at"
    | "cancelled_by_name_snapshot"
    | "cancellation_note"
    | "finalized_at"
    | "finalized_by_name_snapshot"
    | "finalization_note"
    | "closed_by_name_snapshot"
  >,
) {
  return mapSupplierOrderSummary({
    ...row,
    notes: null,
    created_by_name_snapshot: "",
    cancelled_at: null,
    cancelled_by_name_snapshot: null,
    cancellation_note: null,
    finalized_at: null,
    finalized_by_name_snapshot: null,
    finalization_note: null,
    closed_by_name_snapshot: null,
  });
}

export function mapSupplierOrderItem(
  row: SupplierOrderItemRow,
): SupplierOrderItem | null {
  const physicalItemType = physicalItemTypes.find(
    (itemType) => itemType === row.item_type_snapshot,
  );
  if (
    row.item_type_snapshot !== "COMMERCIAL_CONFIGURATION" &&
    !physicalItemType
  ) {
    return null;
  }
  return {
    id: row.id,
    supplierOrderId: row.supplier_order_id,
    itemId: row.item_id,
    commercialConfigurationId: row.commercial_configuration_id,
    commercialConfigurationCodeId: row.commercial_configuration_code_id,
    codeSnapshot: row.code_snapshot,
    descriptionSnapshot: row.description_snapshot,
    modelSnapshot: row.model_snapshot,
    itemTypeSnapshot:
      row.item_type_snapshot === "COMMERCIAL_CONFIGURATION"
        ? row.item_type_snapshot
        : physicalItemType!,
    commercialCodeSnapshot: row.commercial_code_snapshot,
    imageUrl: null,
    compatibleKitImages: [],
    orderedQuantity: asSafeInteger(row.ordered_quantity),
    readyQuantity: asSafeInteger(row.ready_quantity),
    pickedQuantity: asSafeInteger(row.picked_quantity),
    stockedQuantity: asSafeInteger(row.stocked_quantity),
    cancelledQuantity: asSafeInteger(row.cancelled_quantity),
    waitingPickupQuantity: asSafeInteger(row.waiting_pickup_quantity),
    waitingReadyQuantity: asSafeInteger(row.waiting_ready_quantity),
    readyWaitingPickupQuantity: asSafeInteger(row.ready_waiting_pickup_quantity),
    waitingStockQuantity: toSafeWaitingStockQuantity(row.waiting_stock_quantity),
    position: asSafeInteger(row.position),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): SupplierOrderEvent | null {
  if (!isSupplierOrderEventType(row.event_type)) return null;
  return {
    id: row.id,
    supplierOrderId: row.supplier_order_id,
    supplierOrderItemId: row.supplier_order_item_id,
    eventType: row.event_type,
    userName: row.user_name_snapshot,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    quantityDelta: row.quantity_delta,
    description: row.description,
    createdAt: row.created_at,
  };
}

async function loadCatalogRows(client: SupplierOrdersClient) {
  const [itemsResult, modelsResult, configurationsResult, codesResult] =
    await Promise.all([
      client
        .from("items")
        .select("id, code, description, item_type, is_active")
        .in("item_type", [...physicalItemTypes]),
      client.from("servo_models").select("item_id, model"),
      client.from("commercial_configurations").select(configurationSelect),
      client
        .from("commercial_configuration_codes")
        .select("id, code, configuration_id, is_active"),
    ]);
  const error = [
    itemsResult.error,
    modelsResult.error,
    configurationsResult.error,
    codesResult.error,
  ].find(Boolean);
  if (error) return null;
  return {
    items: (itemsResult.data ?? []) as ItemRow[],
    models: (modelsResult.data ?? []) as ServoModelRow[],
    configurations: (configurationsResult.data ?? []) as ConfigurationRow[],
    codes: (codesResult.data ?? []) as CommercialCodeRow[],
  };
}

function buildCatalog(
  rows: NonNullable<Awaited<ReturnType<typeof loadCatalogRows>>>,
  imageUrlByPath: Map<string, string>,
  activeOnly = true,
): SupplierOrderCatalog {
  const itemById = new Map(rows.items.map((item) => [item.id, item]));
  const modelByServoId = new Map(
    rows.models.map((model) => [model.item_id, model.model]),
  );
  const codesByConfiguration = new Map<string, CommercialCodeRow[]>();
  rows.codes.forEach((code) => {
    const aliases = codesByConfiguration.get(code.configuration_id) ?? [];
    aliases.push(code);
    codesByConfiguration.set(code.configuration_id, aliases);
  });
  codesByConfiguration.forEach((aliases) => aliases.sort(compareCodes));
  const imageUrlByConfigurationId = new Map(
    rows.configurations.map((configuration) => [
      configuration.id,
      configuration.image_path
        ? (imageUrlByPath.get(configuration.image_path) ?? null)
        : null,
    ]),
  );
  const compatibleKitImagesByItemId = createCompatibleKitImageMap(
    rows.configurations.flatMap((configuration) => {
      const servo = itemById.get(configuration.servo_id);
      const kit = itemById.get(configuration.installation_kit_id);
      const aliases = (codesByConfiguration.get(configuration.id) ?? []).filter(
        (alias) => alias.is_active,
      );
      const imageUrl = imageUrlByConfigurationId.get(configuration.id) ?? null;
      if (
        (activeOnly && !configuration.is_active) ||
        servo?.item_type !== "SERVO" ||
        (activeOnly && !servo.is_active) ||
        kit?.item_type !== "INSTALLATION_KIT" ||
        (activeOnly && !kit.is_active) ||
        aliases.length === 0 ||
        !imageUrl
      ) {
        return [];
      }
      return [
        {
          installationKitId: kit.id,
          configurationId: configuration.id,
          commercialCodes: aliases.map((alias) => alias.code),
          servoCode: servo.code,
          servoDescription: servo.description,
          servoModel: modelByServoId.get(servo.id) ?? null,
          installationKitCode: kit.code,
          description:
            configuration.description?.trim() ||
            `${servo.description} + ${kit.code}`,
          imageUrl,
        },
      ];
    }),
  );
  const physicalItems: SupplierOrderCatalogPhysicalItem[] = rows.items
    .filter((item) => !activeOnly || item.is_active)
    .map((item) => ({
      kind: "ITEM" as const,
      itemId: item.id,
      code: item.code,
      description: item.description,
      model:
        item.item_type === "SERVO"
          ? (modelByServoId.get(item.id) ?? null)
          : null,
      itemType: item.item_type,
      imageUrl: null,
      compatibleKitImages:
        item.item_type === "INSTALLATION_KIT"
          ? (compatibleKitImagesByItemId.get(item.id) ?? [])
          : [],
    }))
    .sort(compareCodes);
  const configurations: SupplierOrderCatalogConfiguration[] =
    rows.configurations
      .flatMap((configuration) => {
        const servo = itemById.get(configuration.servo_id);
        const kit = itemById.get(configuration.installation_kit_id);
        if (
          (activeOnly && !configuration.is_active) ||
          servo?.item_type !== "SERVO" ||
          (activeOnly && !servo.is_active) ||
          kit?.item_type !== "INSTALLATION_KIT" ||
          (activeOnly && !kit.is_active)
        ) {
          return [];
        }
        return [
          {
            kind: "COMMERCIAL_CONFIGURATION" as const,
            configurationId: configuration.id,
            description:
              configuration.description?.trim() ||
              `${servo.description} + ${kit.code}`,
            servoCode: servo.code,
            servoDescription: servo.description,
            servoModel: modelByServoId.get(servo.id) ?? null,
            installationKitCode: kit.code,
            installationKitDescription: kit.description,
            imageUrl: imageUrlByConfigurationId.get(configuration.id) ?? null,
            aliases: (codesByConfiguration.get(configuration.id) ?? [])
              .filter((code) => !activeOnly || code.is_active)
              .map((code) => ({ id: code.id, code: code.code })),
          },
        ];
      })
      .sort((first, second) =>
        compareCodes(
          { code: first.aliases[0]?.code ?? first.servoCode },
          { code: second.aliases[0]?.code ?? second.servoCode },
        ),
      );
  return { physicalItems, configurations };
}

export async function loadSupplierOrderSummariesWithClient(
  view: SupplierOrderView,
  client: SupplierOrdersClient,
): Promise<SupplierOrdersDataResult<SupplierOrderSummariesData>> {
  const startedAt = performance.now();
  const classificationColumn =
    view === "history" ? "is_in_history" : "is_active_order";
  let query = client
    .from("supplier_order_summaries")
    .select(supplierOrderListSummarySelect)
    .eq(classificationColumn, true);
  query =
    view === "history"
      ? query
          .order("closed_at", { ascending: false })
          .order("order_date", { ascending: false })
          .order("created_at", { ascending: false })
      : query
          .order("order_date", { ascending: false })
          .order("created_at", { ascending: false });
  const result = await query;
  if (result.error) {
    return { data: null, error: "Não foi possível carregar os pedidos agora." };
  }
  const summaries = (
    (result.data ?? []) as Parameters<typeof mapSupplierOrderListSummary>[0][]
  )
    .map(mapSupplierOrderListSummary)
    .filter((summary): summary is SupplierOrderSummary => Boolean(summary));
  const data = { view, summaries };
  logPerformance({
    loader: "summaries",
    durationMs: Math.round(performance.now() - startedAt),
    queryCount: 1,
    waveCount: 1,
    rowCount: summaries.length,
    payloadBytes: measurePayload(data),
  });
  return { data, error: null };
}

export async function loadSupplierOrderSummaries(
  view: SupplierOrderView,
): Promise<SupplierOrdersDataResult<SupplierOrderSummariesData>> {
  try {
    return await loadSupplierOrderSummariesWithClient(view, await createClient());
  } catch {
    return { data: null, error: "Não foi possível carregar os pedidos agora." };
  }
}

type SupplierOrderMediaSourceRow = Pick<
  SupplierOrderItemRow,
  "id" | "item_id" | "commercial_configuration_id" | "item_type_snapshot"
>;

function createEmptyMediaItems(
  sources: SupplierOrderMediaSourceRow[],
): SupplierOrderMediaItem[] {
  return sources.map((source) => ({
    id: source.id,
    imageUrl: null,
    compatibleKitImages: [],
  }));
}

async function enrichDetailMedia(
  client: SupplierOrdersClient,
  sources: SupplierOrderMediaSourceRow[],
) {
  const enrichmentStartedAt = performance.now();
  const configurationIds = [
    ...new Set(
      sources.flatMap((item) =>
        item.commercial_configuration_id
          ? [item.commercial_configuration_id]
          : [],
      ),
    ),
  ];
  const installationKitIds = [
    ...new Set(
      sources.flatMap((item) =>
        item.item_type_snapshot === "INSTALLATION_KIT" && item.item_id
          ? [item.item_id]
          : [],
      ),
    ),
  ];
  if (configurationIds.length === 0 && installationKitIds.length === 0) {
    return {
      items: createEmptyMediaItems(sources),
      queryCount: 0,
      waveCount: 0,
      enrichmentMs: 0,
      signedUrlsMs: 0,
    };
  }
  const configurationQueryCount =
    Number(configurationIds.length > 0) + Number(installationKitIds.length > 0);
  const [directResult, compatibleResult] = await Promise.all([
    configurationIds.length
      ? client
          .from("commercial_configurations")
          .select(configurationSelect)
          .in("id", configurationIds)
      : Promise.resolve({ data: [], error: null }),
    installationKitIds.length
      ? client
          .from("commercial_configurations")
          .select(configurationSelect)
          .in("installation_kit_id", installationKitIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (directResult.error || compatibleResult.error) {
    return {
      items: createEmptyMediaItems(sources),
      queryCount: configurationQueryCount,
      waveCount: 1,
      enrichmentMs: Math.round(performance.now() - enrichmentStartedAt),
      signedUrlsMs: 0,
    };
  }
  const configurationMap = new Map<string, ConfigurationRow>();
  [
    ...((directResult.data ?? []) as ConfigurationRow[]),
    ...((compatibleResult.data ?? []) as ConfigurationRow[]),
  ].forEach((configuration) =>
    configurationMap.set(configuration.id, configuration),
  );
  const configurations = [...configurationMap.values()];
  const relatedItemIds = [
    ...new Set(
      configurations.flatMap((configuration) => [
        configuration.servo_id,
        configuration.installation_kit_id,
      ]),
    ),
  ];
  const relatedConfigurationIds = configurations.map(
    (configuration) => configuration.id,
  );
  const servoIds = [
    ...new Set(configurations.map((configuration) => configuration.servo_id)),
  ];
  const supportQueryCount =
    Number(relatedItemIds.length > 0) +
    Number(servoIds.length > 0) +
    Number(relatedConfigurationIds.length > 0);
  const [itemsResult, modelsResult, codesResult] = await Promise.all([
    relatedItemIds.length
      ? client
          .from("items")
          .select("id, code, description, item_type, is_active")
          .in("id", relatedItemIds)
      : Promise.resolve({ data: [], error: null }),
    servoIds.length
      ? client
          .from("servo_models")
          .select("item_id, model")
          .in("item_id", servoIds)
      : Promise.resolve({ data: [], error: null }),
    relatedConfigurationIds.length
      ? client
          .from("commercial_configuration_codes")
          .select("id, code, configuration_id, is_active")
          .in("configuration_id", relatedConfigurationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemsResult.error || modelsResult.error || codesResult.error) {
    return {
      items: createEmptyMediaItems(sources),
      queryCount: configurationQueryCount + supportQueryCount,
      waveCount: 2,
      enrichmentMs: Math.round(performance.now() - enrichmentStartedAt),
      signedUrlsMs: 0,
    };
  }
  const metadataCompletedAt = performance.now();
  const signedUrlsStartedAt = performance.now();
  const imageUrlByPath = await createCommercialImageUrlMap(
    client,
    configurations.map((configuration) => configuration.image_path),
  );
  const signedUrlsMs = Math.round(performance.now() - signedUrlsStartedAt);
  const catalog = buildCatalog(
    {
      items: (itemsResult.data ?? []) as ItemRow[],
      models: (modelsResult.data ?? []) as ServoModelRow[],
      configurations,
      codes: (codesResult.data ?? []) as CommercialCodeRow[],
    },
    imageUrlByPath,
    false,
  );
  const imageByConfiguration = new Map(
    catalog.configurations.map((configuration) => [
      configuration.configurationId,
      configuration.imageUrl,
    ]),
  );
  const compatibleByKit = new Map(
    catalog.physicalItems
      .filter((item) => item.itemType === "INSTALLATION_KIT")
      .map((item) => [item.itemId, item.compatibleKitImages]),
  );
  const signedUrlOperationCount = Number(
    configurations.some((configuration) => Boolean(configuration.image_path)),
  );
  return {
    items: sources.map((item) => ({
      id: item.id,
      imageUrl: item.commercial_configuration_id
        ? (imageByConfiguration.get(item.commercial_configuration_id) ?? null)
        : null,
      compatibleKitImages:
        item.item_type_snapshot === "INSTALLATION_KIT" && item.item_id
          ? (compatibleByKit.get(item.item_id) ?? [])
          : [],
    })),
    queryCount:
      configurationQueryCount + supportQueryCount + signedUrlOperationCount,
    waveCount: 2 + signedUrlOperationCount,
    enrichmentMs: Math.round(metadataCompletedAt - enrichmentStartedAt),
    signedUrlsMs,
  };
}

export async function loadSupplierOrderDetailWithClient(
  orderId: string,
  view: SupplierOrderView,
  client: SupplierOrdersClient,
): Promise<SupplierOrdersDataResult<SupplierOrderDetailData>> {
  if (!isSupplierOrderId(orderId)) {
    return { data: null, error: "Pedido inválido." };
  }
  const startedAt = performance.now();
  const classificationColumn =
    view === "history" ? "is_in_history" : "is_active_order";
  const [summaryResult, itemsResult, eventsResult] = await Promise.all([
    client
      .from("supplier_order_summaries")
      .select(supplierOrderSummarySelect)
      .eq("id", orderId)
      .eq(classificationColumn, true)
      .maybeSingle(),
    client
      .from("supplier_order_item_details")
      .select(supplierOrderItemSelect)
      .eq("supplier_order_id", orderId)
      .order("position"),
    view === "active"
      ? client
          .from("supplier_order_events")
          .select(eventSelect)
          .eq("supplier_order_id", orderId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (summaryResult.error || itemsResult.error || eventsResult.error) {
    return { data: null, error: "Não foi possível carregar este pedido agora." };
  }
  const order = summaryResult.data
    ? mapSupplierOrderSummary(summaryResult.data as SupplierOrderSummaryRow)
    : null;
  if (!order) return { data: null, error: "Pedido não encontrado." };
  const items = ((itemsResult.data ?? []) as SupplierOrderItemRow[])
    .map(mapSupplierOrderItem)
    .filter((item): item is SupplierOrderItem => Boolean(item));
  const events = ((eventsResult.data ?? []) as EventRow[])
    .map(mapEvent)
    .filter((event): event is SupplierOrderEvent => Boolean(event));
  const data = { view, order, items, events };
  const detailCoreMs = Math.round(performance.now() - startedAt);
  logPerformance({
    loader: "detail_core",
    durationMs: detailCoreMs,
    queryCount: view === "active" ? 3 : 2,
    waveCount: 1,
    rowCount: 1 + items.length + events.length,
    payloadBytes: measurePayload(data),
    detail_core_ms: detailCoreMs,
  });
  return { data, error: null };
}

export async function loadSupplierOrderMediaWithClient(
  orderId: string,
  view: SupplierOrderView,
  client: SupplierOrdersClient,
): Promise<SupplierOrdersDataResult<SupplierOrderMediaData>> {
  if (!isSupplierOrderId(orderId)) {
    return { data: null, error: "Pedido inválido." };
  }
  const startedAt = performance.now();
  const classificationColumn =
    view === "history" ? "is_in_history" : "is_active_order";
  const [summaryResult, itemsResult] = await Promise.all([
    client
      .from("supplier_order_summaries")
      .select("id")
      .eq("id", orderId)
      .eq(classificationColumn, true)
      .maybeSingle(),
    client
      .from("supplier_order_item_details")
      .select(
        "id, item_id, commercial_configuration_id, item_type_snapshot",
      )
      .eq("supplier_order_id", orderId),
  ]);
  if (summaryResult.error || itemsResult.error) {
    return {
      data: null,
      error: "Não foi possível carregar as imagens deste pedido agora.",
    };
  }
  if (!summaryResult.data) {
    return { data: null, error: "Pedido não encontrado." };
  }
  const sources = (itemsResult.data ?? []) as SupplierOrderMediaSourceRow[];
  const enriched = await enrichDetailMedia(client, sources);
  const data = { items: enriched.items };
  logPerformance({
    loader: "detail_media",
    durationMs: Math.round(performance.now() - startedAt),
    queryCount: 2 + enriched.queryCount,
    waveCount: 1 + enriched.waveCount,
    rowCount: enriched.items.length,
    payloadBytes: measurePayload(data),
    enrichment_ms: enriched.enrichmentMs,
    signed_urls_ms: enriched.signedUrlsMs,
  });
  return { data, error: null };
}

export async function loadSupplierOrderDetail(
  orderId: string,
  view: SupplierOrderView,
): Promise<SupplierOrdersDataResult<SupplierOrderDetailData>> {
  try {
    return await loadSupplierOrderDetailWithClient(
      orderId,
      view,
      await createClient(),
    );
  } catch {
    return { data: null, error: "Não foi possível carregar este pedido agora." };
  }
}

export async function loadSupplierOrderCatalogWithClient(
  client: SupplierOrdersClient,
): Promise<SupplierOrdersDataResult<SupplierOrderCatalog>> {
  const startedAt = performance.now();
  const rows = await loadCatalogRows(client);
  if (!rows) {
    return { data: null, error: "Não foi possível carregar o catálogo agora." };
  }
  const signedUrlsStartedAt = performance.now();
  const imageUrlByPath = await createCommercialImageUrlMap(
    client,
    rows.configurations.map((configuration) => configuration.image_path),
  );
  const signedUrlsMs = Math.round(performance.now() - signedUrlsStartedAt);
  const data = buildCatalog(rows, imageUrlByPath);
  const signedUrlOperationCount = Number(
    rows.configurations.some((configuration) => Boolean(configuration.image_path)),
  );
  logPerformance({
    loader: "catalog",
    durationMs: Math.round(performance.now() - startedAt),
    queryCount: 4 + signedUrlOperationCount,
    waveCount: 1 + signedUrlOperationCount,
    rowCount: data.physicalItems.length + data.configurations.length,
    payloadBytes: measurePayload(data),
    signed_urls_ms: signedUrlsMs,
  });
  return { data, error: null };
}

export async function loadSupplierOrderCatalog() {
  try {
    return await loadSupplierOrderCatalogWithClient(await createClient());
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar o catálogo agora.",
    } as const;
  }
}

function sanitizeSearchTerm(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[,%()_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function searchSupplierOrderIdsWithClient(
  view: SupplierOrderView,
  search: string,
  client: SupplierOrdersClient,
): Promise<SupplierOrdersDataResult<SupplierOrderSearchData>> {
  const startedAt = performance.now();
  const term = sanitizeSearchTerm(search);
  if (term.length < 2) return { data: { orderIds: [] }, error: null };
  const itemResult = await client
    .from("supplier_order_item_details")
    .select("supplier_order_id")
    .or(
      `code_snapshot.ilike.%${term}%,description_snapshot.ilike.%${term}%,model_snapshot.ilike.%${term}%,commercial_code_snapshot.ilike.%${term}%`,
    )
    .limit(250);
  if (itemResult.error) {
    return { data: null, error: "Não foi possível pesquisar os pedidos agora." };
  }
  const candidateIds = [
    ...new Set(
      ((itemResult.data ?? []) as { supplier_order_id: string }[]).map(
        (row) => row.supplier_order_id,
      ),
    ),
  ];
  if (candidateIds.length === 0) {
    return { data: { orderIds: [] }, error: null };
  }
  const classificationColumn =
    view === "history" ? "is_in_history" : "is_active_order";
  const summaryResult = await client
    .from("supplier_order_summaries")
    .select("id")
    .in("id", candidateIds)
    .eq(classificationColumn, true);
  if (summaryResult.error) {
    return { data: null, error: "Não foi possível pesquisar os pedidos agora." };
  }
  const data = {
    orderIds: ((summaryResult.data ?? []) as { id: string }[]).map(
      (row) => row.id,
    ),
  };
  logPerformance({
    loader: "search",
    durationMs: Math.round(performance.now() - startedAt),
    queryCount: 2,
    waveCount: 2,
    rowCount: data.orderIds.length,
    payloadBytes: measurePayload(data),
  });
  return { data, error: null };
}

export async function searchSupplierOrderIds(
  view: SupplierOrderView,
  search: string,
) {
  try {
    return await searchSupplierOrderIdsWithClient(
      view,
      search,
      await createClient(),
    );
  } catch {
    return {
      data: null,
      error: "Não foi possível pesquisar os pedidos agora.",
    } as const;
  }
}
