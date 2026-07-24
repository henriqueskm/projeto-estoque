import { createClient } from "@/lib/supabase/server";
import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import { createCompatibleKitImageMap } from "@/lib/compatible-kit-images";
import {
  physicalItemTypes,
  type PhysicalItemType,
} from "@/lib/inbound-types";
import {
  supplierOrderEventTypes,
  supplierOrderStatuses,
  type SupplierOrderCatalogConfiguration,
  type SupplierOrderCatalogPhysicalItem,
  type SupplierOrderEvent,
  type SupplierOrderEventType,
  type SupplierOrderItem,
  type SupplierOrdersData,
  type SupplierOrderStatus,
  type SupplierOrderSummary,
} from "@/lib/supplier-orders-types";

type SummaryRow = {
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
  line_count: number;
  ordered_quantity: number;
  picked_quantity: number;
  cancelled_quantity: number;
  waiting_pickup_quantity: number;
  stocked_quantity: number;
  waiting_stock_quantity: number;
  pickup_percentage: number | string;
  status: string;
};

type OrderItemRow = {
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
  picked_quantity: number;
  stocked_quantity: number;
  cancelled_quantity: number;
  waiting_pickup_quantity: number;
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

type ServoModelRow = {
  item_id: string;
  model: string | null;
};

type ConfigurationRow = {
  id: string;
  description: string | null;
  image_path: string | null;
  servo_id: string;
  installation_kit_id: string;
};

type CommercialCodeRow = {
  id: string;
  code: string;
  configuration_id: string;
};

export type SupplierOrdersDataResult =
  | {
      data: SupplierOrdersData;
      error: null;
    }
  | {
      data: null;
      error: string;
    };

function compareCodes(first: { code: string }, second: { code: string }) {
  return first.code.localeCompare(second.code, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function isSupplierOrderStatus(value: string): value is SupplierOrderStatus {
  return supplierOrderStatuses.some((status) => status === value);
}

function isSupplierOrderEventType(
  value: string,
): value is SupplierOrderEventType {
  return supplierOrderEventTypes.some((eventType) => eventType === value);
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

function mapSummary(row: SummaryRow): SupplierOrderSummary | null {
  if (!isSupplierOrderStatus(row.status)) {
    return null;
  }

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
    lineCount: asSafeInteger(row.line_count),
    orderedQuantity: asSafeInteger(row.ordered_quantity),
    pickedQuantity: asSafeInteger(row.picked_quantity),
    cancelledQuantity: asSafeInteger(row.cancelled_quantity),
    waitingPickupQuantity: asSafeInteger(row.waiting_pickup_quantity),
    stockedQuantity: asSafeInteger(row.stocked_quantity),
    waitingStockQuantity: asSafeInteger(row.waiting_stock_quantity),
    pickupPercentage: Number(row.pickup_percentage) || 0,
    status: row.status,
  };
}

function mapOrderItem(row: OrderItemRow): SupplierOrderItem | null {
  const itemType = row.item_type_snapshot;
  const physicalItemType = physicalItemTypes.find(
    (physicalType) => physicalType === itemType,
  );

  if (itemType !== "COMMERCIAL_CONFIGURATION" && !physicalItemType) {
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
      itemType === "COMMERCIAL_CONFIGURATION"
        ? itemType
        : physicalItemType!,
    commercialCodeSnapshot: row.commercial_code_snapshot,
    imageUrl: null,
    compatibleKitImages: [],
    orderedQuantity: asSafeInteger(row.ordered_quantity),
    pickedQuantity: asSafeInteger(row.picked_quantity),
    stockedQuantity: asSafeInteger(row.stocked_quantity),
    cancelledQuantity: asSafeInteger(row.cancelled_quantity),
    waitingPickupQuantity: asSafeInteger(row.waiting_pickup_quantity),
    waitingStockQuantity: asSafeInteger(row.waiting_stock_quantity),
    position: asSafeInteger(row.position),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): SupplierOrderEvent | null {
  if (!isSupplierOrderEventType(row.event_type)) {
    return null;
  }

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

export async function loadSupplierOrdersData(): Promise<SupplierOrdersDataResult> {
  try {
    const supabase = await createClient();
    const [
      summariesResult,
      orderItemsResult,
      eventsResult,
      itemsResult,
      servoModelsResult,
      configurationsResult,
      commercialCodesResult,
    ] = await Promise.all([
      supabase
        .from("supplier_order_summaries")
        .select(
          "id, negotiation_number, order_date, notes, created_by_name_snapshot, created_at, updated_at, cancelled_at, cancelled_by_name_snapshot, cancellation_note, line_count, ordered_quantity, picked_quantity, cancelled_quantity, waiting_pickup_quantity, stocked_quantity, waiting_stock_quantity, pickup_percentage, status",
        )
        .order("order_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("supplier_order_item_details")
        .select(
          "id, supplier_order_id, item_id, commercial_configuration_id, commercial_configuration_code_id, code_snapshot, description_snapshot, model_snapshot, item_type_snapshot, commercial_code_snapshot, ordered_quantity, picked_quantity, stocked_quantity, cancelled_quantity, waiting_pickup_quantity, waiting_stock_quantity, position, notes, created_at, updated_at",
        )
        .order("supplier_order_id")
        .order("position"),
      supabase
        .from("supplier_order_events")
        .select(
          "id, supplier_order_id, supplier_order_item_id, event_type, user_name_snapshot, previous_quantity, new_quantity, quantity_delta, description, created_at",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("items")
        .select("id, code, description, item_type, is_active")
        .in("item_type", [...physicalItemTypes]),
      supabase.from("servo_models").select("item_id, model"),
      supabase
        .from("commercial_configurations")
        .select(
          "id, description, image_path, servo_id, installation_kit_id",
        )
        .eq("is_active", true),
      supabase
        .from("commercial_configuration_codes")
        .select("id, code, configuration_id")
        .eq("is_active", true),
    ]);

    const readError = [
      summariesResult.error,
      orderItemsResult.error,
      eventsResult.error,
      itemsResult.error,
      servoModelsResult.error,
      configurationsResult.error,
      commercialCodesResult.error,
    ].find(Boolean);

    if (readError) {
      return {
        data: null,
        error: "Não foi possível carregar os pedidos agora.",
      };
    }

    const summaries = ((summariesResult.data ?? []) as SummaryRow[])
      .map(mapSummary)
      .filter((summary): summary is SupplierOrderSummary => Boolean(summary));
    const orderItemDrafts = ((orderItemsResult.data ?? []) as OrderItemRow[])
      .map(mapOrderItem)
      .filter((item): item is SupplierOrderItem => Boolean(item));
    const events = ((eventsResult.data ?? []) as EventRow[])
      .map(mapEvent)
      .filter((event): event is SupplierOrderEvent => Boolean(event));
    const items = (itemsResult.data ?? []) as ItemRow[];
    const servoModels = (servoModelsResult.data ?? []) as ServoModelRow[];
    const configurations = (configurationsResult.data ??
      []) as ConfigurationRow[];
    const commercialCodes = (commercialCodesResult.data ??
      []) as CommercialCodeRow[];
    const imageUrlByPath = await createCommercialImageUrlMap(
      supabase,
      configurations.map((configuration) => configuration.image_path),
    );
    const imageUrlByConfigurationId = new Map(
      configurations.map((configuration) => [
        configuration.id,
        configuration.image_path
          ? (imageUrlByPath.get(configuration.image_path) ?? null)
          : null,
      ]),
    );
    const modelByServoId = new Map(
      servoModels.map((servo) => [servo.item_id, servo.model]),
    );
    const itemById = new Map(items.map((item) => [item.id, item]));
    const codesByConfiguration = new Map<string, CommercialCodeRow[]>();

    commercialCodes.forEach((code) => {
      const aliases = codesByConfiguration.get(code.configuration_id) ?? [];
      aliases.push(code);
      codesByConfiguration.set(code.configuration_id, aliases);
    });
    codesByConfiguration.forEach((aliases) => aliases.sort(compareCodes));
    const compatibleKitImagesByItemId = createCompatibleKitImageMap(
      configurations.flatMap((configuration) => {
        const servo = itemById.get(configuration.servo_id);
        const installationKit = itemById.get(
          configuration.installation_kit_id,
        );
        const aliases = codesByConfiguration.get(configuration.id) ?? [];
        const imageUrl = configuration.image_path
          ? (imageUrlByConfigurationId.get(configuration.id) ?? null)
          : null;

        if (
          servo?.item_type !== "SERVO" ||
          !servo.is_active ||
          installationKit?.item_type !== "INSTALLATION_KIT" ||
          !installationKit.is_active ||
          aliases.length === 0 ||
          !configuration.image_path ||
          !imageUrl
        ) {
          return [];
        }

        return [
          {
            installationKitId: installationKit.id,
            configurationId: configuration.id,
            commercialCodes: aliases.map((alias) => alias.code),
            servoCode: servo.code,
            servoDescription: servo.description,
            servoModel: modelByServoId.get(servo.id) ?? null,
            installationKitCode: installationKit.code,
            description:
              configuration.description?.trim() ||
              `${servo.description} + ${installationKit.code}`,
            imageUrl,
          },
        ];
      }),
    );
    const orderItems = orderItemDrafts.map((item) => ({
      ...item,
      imageUrl: item.commercialConfigurationId
        ? (imageUrlByConfigurationId.get(
            item.commercialConfigurationId,
          ) ?? null)
        : null,
      compatibleKitImages:
        item.itemTypeSnapshot === "INSTALLATION_KIT" && item.itemId
          ? (compatibleKitImagesByItemId.get(item.itemId) ?? [])
          : [],
    }));

    const physicalItems: SupplierOrderCatalogPhysicalItem[] = items
      .filter((item) => item.is_active)
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

    const catalogConfigurations: SupplierOrderCatalogConfiguration[] =
      configurations
        .flatMap((configuration) => {
          const servo = itemById.get(configuration.servo_id);
          const installationKit = itemById.get(
            configuration.installation_kit_id,
          );

          if (
            servo?.item_type !== "SERVO" ||
            !servo.is_active ||
            installationKit?.item_type !== "INSTALLATION_KIT" ||
            !installationKit.is_active
          ) {
            return [];
          }

          return [
            {
              kind: "COMMERCIAL_CONFIGURATION" as const,
              configurationId: configuration.id,
              description:
                configuration.description?.trim() ||
                `${servo.description} + ${installationKit.code}`,
              servoCode: servo.code,
              servoDescription: servo.description,
              servoModel: modelByServoId.get(servo.id) ?? null,
              installationKitCode: installationKit.code,
              installationKitDescription: installationKit.description,
              imageUrl:
                imageUrlByConfigurationId.get(configuration.id) ?? null,
              aliases: (codesByConfiguration.get(configuration.id) ?? []).map(
                (code) => ({
                  id: code.id,
                  code: code.code,
                }),
              ),
            },
          ];
        })
        .sort((first, second) => {
          const firstCode =
            first.aliases[0]?.code ??
            `${first.servoCode}-${first.installationKitCode}`;
          const secondCode =
            second.aliases[0]?.code ??
            `${second.servoCode}-${second.installationKitCode}`;

          return compareCodes({ code: firstCode }, { code: secondCode });
        });

    return {
      data: {
        summaries,
        items: orderItems,
        events,
        catalog: {
          physicalItems,
          configurations: catalogConfigurations,
        },
      },
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar os pedidos agora.",
    };
  }
}
