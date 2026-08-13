import type { PhysicalStockItemType } from "@/lib/stock-calculations";
import type { CompatibleKitImageOption } from "@/lib/compatible-kit-images";
import type { PurchaseRecommendationItem } from "@/lib/purchase-recommendation-types";
import { customerFacingInventoryLabels } from "@/lib/customer-facing-inventory-labels";
import { normalizeServoModel } from "@/lib/servo-model-search";
import {
  parseAssistantSupplierOrderPhotoPreviewBlock,
  type AssistantSupplierOrderPhotoPreviewBlock,
} from "@/lib/assistant-supplier-order-photo-contract";
import {
  parseAssistantSupplierOrderPhotoCreateResultBlock,
  type AssistantSupplierOrderPhotoCreateResultBlock,
} from "@/lib/assistant-supplier-order-photo-create-contract";

export type { AssistantSupplierOrderPhotoPreviewBlock } from "@/lib/assistant-supplier-order-photo-contract";
export type { AssistantSupplierOrderPhotoCreateResultBlock } from "@/lib/assistant-supplier-order-photo-create-contract";

export const assistantMessageMaxLength = 2000;
export const assistantQueryMaxLength = 120;
export const assistantRequestMaxCharacters = 4096;

export type AssistantServoModelInventoryAction =
  | {
      action: "show_servo_model_inventory_breakdown";
      normalizedModel: string;
    }
  | {
      action: "show_servo_model_inventory_target";
      normalizedModel: string;
      targetKind: "item" | "commercial_configuration";
      targetId: string;
    };

export type AssistantStockEntrySelection =
  | {
      action: "manual_stock_entry_identity";
      targetQuery: string;
      quantity: number;
      targetKind: "ITEM" | "COMMERCIAL_CODE";
    }
  | {
      action: "supplier_order_stock_entry_flow";
      targetQuery: string;
      quantity: number;
    }
  | {
      action: "manual_stock_entry_target";
      targetId: string;
      quantity: number;
      targetKind: "ITEM" | "COMMERCIAL_CODE";
    };

export type AssistantStockOutputSelection =
  | {
      action: "manual_stock_output_identity";
      targetQuery: string;
      quantity: number;
      targetKind: "ITEM" | "COMMERCIAL_CODE";
    }
  | {
      action: "manual_stock_output_target";
      targetId: string;
      quantity: number;
      targetKind: "ITEM" | "COMMERCIAL_CODE";
    };

export type AssistantConfigurationAssemblySelection = {
  action: "configuration_assembly_target";
  commercialCodeId: string;
  quantity: number;
};

export type AssistantConfigurationDisassemblySelection = {
  action: "configuration_disassembly_target";
  commercialCodeId: string;
  quantity: number;
};

export type AssistantChatRequest = {
  message: string;
  lastItemQuery?: string;
  lastSupplierOrderId?: string;
  lastSupplierOrderCatalogCode?: string;
  selectedSupplierOrderItemId?: string;
  inventoryAction?: AssistantServoModelInventoryAction;
  stockEntrySelection?: AssistantStockEntrySelection;
  stockOutputSelection?: AssistantStockOutputSelection;
  configurationAssemblySelection?: AssistantConfigurationAssemblySelection;
  configurationDisassemblySelection?: AssistantConfigurationDisassemblySelection;
};

export type AssistantStockEntryTarget = {
  kind: "ITEM" | "COMMERCIAL_CODE";
  targetId: string;
  configurationId: string | null;
  displayCode: string;
  aliases: string[];
  typeLabel: string;
  description: string;
  detail: string | null;
  currentStock: number;
};

export type AssistantSupplierOrderStockEntryPreviewLine = {
  supplierOrderItemId: string;
  target: AssistantStockEntryTarget;
  orderedQuantity: number;
  pickedQuantity: number;
  stockedQuantity: number;
  availableQuantity: number;
  entryQuantity: number;
  remainingQuantity: number;
  estimatedStockAfter: number;
};

export type AssistantSupplierOrderStockEntryPreviewBlock = {
  kind: "supplier_order_stock_entry_preview";
  action: "supplier_order_stock_entry";
  state: "pending" | "expired" | "cancelled";
  title: string;
  message: string;
  proposalToken: string | null;
  expiresAt: string | null;
  order: AssistantSupplierOrderCard;
  lines: AssistantSupplierOrderStockEntryPreviewLine[];
  totalQuantity: number;
  confirmLabel: "Confirmar entrada";
  cancelLabel: "Cancelar";
  regeneratePrompt: string;
};

export type AssistantSupplierOrderStockEntryResultLine = {
  supplierOrderItemId: string;
  target: AssistantStockEntryTarget;
  entryQuantity: number;
  totalStockedQuantity: number;
  remainingQuantity: number;
  previousStock: number;
  currentStock: number;
};

export type AssistantSupplierOrderStockEntryResultBlock = {
  kind: "supplier_order_stock_entry_result";
  action: "supplier_order_stock_entry";
  outcome: "success" | "conflict" | "error" | "cancelled" | "expired";
  title: string;
  message: string;
  order: AssistantSupplierOrderCard | null;
  lines: AssistantSupplierOrderStockEntryResultLine[];
  linesProcessed: number;
  totalQuantity: number;
  occurredAt: string | null;
  reference: string | null;
  idempotentReplay: boolean;
  refreshWarning?: boolean;
  actions: Array<AssistantActionResultLink | AssistantActionResultPrompt>;
};

export type AssistantManualStockEntryPreviewLine = {
  target: AssistantStockEntryTarget;
  entryQuantity: number;
  estimatedStockAfter: number;
};

export type AssistantManualStockEntryPreviewBlock = {
  kind: "manual_stock_entry_preview";
  action: "manual_stock_entry";
  state: "pending" | "expired" | "cancelled";
  title: "Confirmar entrada manual" | "Prévia expirada";
  message: string;
  proposalToken: string | null;
  expiresAt: string | null;
  lines: AssistantManualStockEntryPreviewLine[];
  totalQuantity: number;
  confirmLabel: "Confirmar entrada";
  cancelLabel: "Cancelar";
  regeneratePrompt: string;
};

export type AssistantManualStockEntryResultLine = {
  target: AssistantStockEntryTarget;
  entryQuantity: number;
  previousStock: number;
  currentStock: number;
};

export type AssistantManualStockEntryResultBlock = {
  kind: "manual_stock_entry_result";
  action: "manual_stock_entry";
  outcome: "success" | "error" | "cancelled" | "expired";
  title: string;
  message: string;
  lines: AssistantManualStockEntryResultLine[];
  linesProcessed: number;
  totalQuantity: number;
  occurredAt: string | null;
  reference: string | null;
  idempotentReplay: boolean;
  refreshWarning?: boolean;
  actions: Array<AssistantActionResultLink | AssistantActionResultPrompt>;
};

export type AssistantSupplierOrderStockEntryConfirmationResult = {
  block: AssistantSupplierOrderStockEntryResultBlock;
  contextSupplierOrderId: string | null;
  contextSupplierOrderCatalogCode: string | null;
};

export type AssistantManualStockEntryConfirmationResult = {
  block: AssistantManualStockEntryResultBlock;
  contextSupplierOrderId: null;
  contextSupplierOrderCatalogCode: null;
};

export type AssistantStockOutputComponent = {
  id: string;
  code: string;
  description: string;
  currentStock: number;
};

export type AssistantStockOutputTarget = AssistantStockEntryTarget & {
  availableStock: number;
  autoAssemblyCapacity: number;
  servo: AssistantStockOutputComponent | null;
  installationKit: AssistantStockOutputComponent | null;
};

export type AssistantManualStockOutputPreviewLine = {
  target: AssistantStockOutputTarget;
  outputQuantity: number;
  estimatedStockAfter: number;
  autoAssembledQuantity: number;
};

export type AssistantManualStockOutputPreviewBlock = {
  kind: "manual_stock_output_preview";
  action: "manual_stock_output";
  state: "pending" | "expired" | "cancelled";
  title: "Confirmar saída manual" | "Prévia expirada";
  message: string;
  proposalToken: string | null;
  expiresAt: string | null;
  lines: AssistantManualStockOutputPreviewLine[];
  totalQuantity: number;
  totalAutoAssemblyQuantity: number;
  confirmLabel: "Confirmar saída";
  cancelLabel: "Cancelar";
  regeneratePrompt: string;
};

export type AssistantManualStockOutputResultLine = {
  target: AssistantStockOutputTarget;
  outputQuantity: number;
  previousStock: number;
  currentStock: number;
  autoAssembledQuantity: number;
};

export type AssistantManualStockOutputResultBlock = {
  kind: "manual_stock_output_result";
  action: "manual_stock_output";
  outcome: "success" | "error" | "cancelled" | "expired";
  title: string;
  message: string;
  lines: AssistantManualStockOutputResultLine[];
  linesProcessed: number;
  totalQuantity: number;
  totalAutoAssemblyQuantity: number;
  occurredAt: string | null;
  reference: string | null;
  idempotentReplay: boolean;
  refreshWarning?: boolean;
  actions: Array<AssistantActionResultLink | AssistantActionResultPrompt>;
};

export type AssistantManualStockOutputConfirmationResult = {
  block: AssistantManualStockOutputResultBlock;
  contextSupplierOrderId: null;
  contextSupplierOrderCatalogCode: null;
};

export type AssistantConfigurationAssemblyComponent = {
  id: string;
  code: string;
  description: string;
  currentStock: number;
};

export type AssistantConfigurationAssemblyTarget = {
  commercialCodeId: string;
  configurationId: string;
  displayCode: string;
  aliases: string[];
  description: string;
  currentStock: number;
  capacity: number;
  servo: AssistantConfigurationAssemblyComponent;
  installationKit: AssistantConfigurationAssemblyComponent;
};

export type AssistantConfigurationAssemblyPreviewBlock = {
  kind: "configuration_assembly_preview";
  action: "configuration_assembly";
  state: "pending" | "expired" | "cancelled";
  title: "Confirmar montagem" | "Prévia expirada";
  message: string;
  proposalToken: string | null;
  expiresAt: string | null;
  target: AssistantConfigurationAssemblyTarget;
  quantity: number;
  mountedStockAfter: number;
  servoStockAfter: number;
  installationKitStockAfter: number;
  totalQuantity: number;
  confirmLabel: "Confirmar montagem";
  cancelLabel: "Cancelar";
  regeneratePrompt: string;
};

export type AssistantConfigurationAssemblyResultBlock = {
  kind: "configuration_assembly_result";
  action: "configuration_assembly";
  outcome: "success" | "error" | "cancelled" | "expired";
  title: string;
  message: string;
  target: AssistantConfigurationAssemblyTarget | null;
  quantity: number;
  mountedStockBefore: number | null;
  mountedStockAfter: number | null;
  servoStockBefore: number | null;
  servoStockAfter: number | null;
  installationKitStockBefore: number | null;
  installationKitStockAfter: number | null;
  occurredAt: string | null;
  reference: string | null;
  idempotentReplay: boolean;
  refreshWarning?: boolean;
  actions: Array<AssistantActionResultLink | AssistantActionResultPrompt>;
};

export type AssistantConfigurationAssemblyConfirmationResult = {
  block: AssistantConfigurationAssemblyResultBlock;
  contextSupplierOrderId: null;
  contextSupplierOrderCatalogCode: null;
};

export type AssistantConfigurationDisassemblyTarget = AssistantConfigurationAssemblyTarget;

export type AssistantConfigurationDisassemblyPreviewBlock = {
  kind: "configuration_disassembly_preview";
  action: "configuration_disassembly";
  state: "pending" | "expired" | "cancelled";
  title: "Confirmar desmontagem" | "PrÃ©via expirada";
  message: string;
  proposalToken: string | null;
  expiresAt: string | null;
  target: AssistantConfigurationDisassemblyTarget;
  quantity: number;
  mountedStockAfter: number;
  servoStockAfter: number;
  installationKitStockAfter: number;
  totalQuantity: number;
  confirmLabel: "Confirmar desmontagem";
  cancelLabel: "Cancelar";
  regeneratePrompt: string;
};

export type AssistantConfigurationDisassemblyResultBlock = {
  kind: "configuration_disassembly_result";
  action: "configuration_disassembly";
  outcome: "success" | "error" | "cancelled" | "expired";
  title: string;
  message: string;
  target: AssistantConfigurationDisassemblyTarget | null;
  quantity: number;
  mountedStockBefore: number | null;
  mountedStockAfter: number | null;
  servoStockBefore: number | null;
  servoStockAfter: number | null;
  installationKitStockBefore: number | null;
  installationKitStockAfter: number | null;
  occurredAt: string | null;
  reference: string | null;
  idempotentReplay: boolean;
  refreshWarning?: boolean;
  actions: Array<AssistantActionResultLink | AssistantActionResultPrompt>;
};

export type AssistantConfigurationDisassemblyConfirmationResult = {
  block: AssistantConfigurationDisassemblyResultBlock;
  contextSupplierOrderId: null;
  contextSupplierOrderCatalogCode: null;
};

export type AssistantSupplierOrderFinalizationPreviewBlock = {
  kind: "supplier_order_finalization_preview";
  action: "supplier_order_finalization";
  state: "pending" | "expired" | "cancelled";
  title: string;
  message: string;
  proposalToken: string | null;
  expiresAt: string | null;
  order: AssistantSupplierOrderCard;
  confirmLabel: "Confirmar finalização";
  cancelLabel: "Cancelar";
  regeneratePrompt: string;
};

export type AssistantSupplierOrderFinalizationResultBlock = {
  kind: "supplier_order_finalization_result";
  action: "supplier_order_finalization";
  outcome: "success" | "conflict" | "error" | "cancelled" | "expired";
  title: string;
  message: string;
  order: AssistantSupplierOrderCard | null;
  occurredAt: string | null;
  idempotentReplay: boolean;
  refreshWarning?: boolean;
  actions: Array<AssistantActionResultLink | AssistantActionResultPrompt>;
};

export type AssistantSupplierOrderFinalizationConfirmationResult = {
  block: AssistantSupplierOrderFinalizationResultBlock;
  contextSupplierOrderId: string | null;
  contextSupplierOrderCatalogCode: null;
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

export type AssistantServoModelConfigurationTarget = {
  target: AssistantInventoryItemSummaryTarget & {
    targetKind: "commercial_configuration";
    itemType: "COMPLETE_BOX";
  };
  aliases: string[];
};

export type AssistantServoModelInventoryBreakdownBlock = {
  kind: "servo_model_inventory_breakdown";
  model: {
    official: string;
    normalized: string;
  };
  bareServo: (AssistantInventoryItemSummaryTarget & {
    targetKind: "item";
    itemType: "SERVO";
  }) | null;
  configurations: AssistantServoModelConfigurationTarget[];
  totalConfigurations: number;
  remainingConfigurations: number;
  inventoryHref: string;
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
  description?: string;
  contextSupplierOrderId?: string;
  contextSupplierOrderItemId?: string;
  action?: AssistantServoModelInventoryAction;
  stockEntrySelection?: AssistantStockEntrySelection;
  stockOutputSelection?: AssistantStockOutputSelection;
  configurationAssemblySelection?: AssistantConfigurationAssemblySelection;
  configurationDisassemblySelection?: AssistantConfigurationDisassemblySelection;
};

const stockEntryUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAssistantStockEntrySelection(value: unknown): AssistantStockEntrySelection | null {
  if (!isRecord(value)) return null;
  if (!isNonnegativeInteger(value.quantity) || value.quantity === 0) return null;
  if (value.action === "manual_stock_entry_target" && Object.keys(value).length === 4 &&
    typeof value.targetId === "string" && stockEntryUuidPattern.test(value.targetId) &&
    (value.targetKind === "ITEM" || value.targetKind === "COMMERCIAL_CODE")) {
    return { action: value.action, targetId: value.targetId.toLowerCase(), quantity: value.quantity, targetKind: value.targetKind };
  }
  const targetQuery = typeof value.targetQuery === "string" ? value.targetQuery.trim() : "";
  if (!targetQuery || targetQuery.length > assistantQueryMaxLength) return null;
  if (value.action === "manual_stock_entry_identity" && Object.keys(value).length === 4 &&
    (value.targetKind === "ITEM" || value.targetKind === "COMMERCIAL_CODE")) {
    return { action: value.action, targetQuery, quantity: value.quantity, targetKind: value.targetKind };
  }
  if (value.action === "supplier_order_stock_entry_flow" && Object.keys(value).length === 3) {
    return { action: value.action, targetQuery, quantity: value.quantity };
  }
  return null;
}

export function parseAssistantStockOutputSelection(value: unknown): AssistantStockOutputSelection | null {
  if (!isRecord(value) || !isNonnegativeInteger(value.quantity) || value.quantity === 0) return null;
  if (value.action === "manual_stock_output_target" && Object.keys(value).length === 4 &&
    typeof value.targetId === "string" && stockEntryUuidPattern.test(value.targetId) &&
    (value.targetKind === "ITEM" || value.targetKind === "COMMERCIAL_CODE")) {
    return { action: value.action, targetId: value.targetId.toLowerCase(), quantity: value.quantity, targetKind: value.targetKind };
  }
  const targetQuery = typeof value.targetQuery === "string" ? value.targetQuery.trim() : "";
  if (!targetQuery || targetQuery.length > assistantQueryMaxLength) return null;
  if (value.action === "manual_stock_output_identity" && Object.keys(value).length === 4 &&
    (value.targetKind === "ITEM" || value.targetKind === "COMMERCIAL_CODE")) {
    return { action: value.action, targetQuery, quantity: value.quantity, targetKind: value.targetKind };
  }
  return null;
}

export function parseAssistantConfigurationAssemblySelection(
  value: unknown,
): AssistantConfigurationAssemblySelection | null {
  if (!isRecord(value) || Object.keys(value).length !== 3 ||
    value.action !== "configuration_assembly_target" ||
    typeof value.commercialCodeId !== "string" || !stockEntryUuidPattern.test(value.commercialCodeId) ||
    !isNonnegativeInteger(value.quantity) || value.quantity === 0) return null;
  return { action: value.action, commercialCodeId: value.commercialCodeId.toLowerCase(), quantity: value.quantity };
}

export function parseAssistantConfigurationDisassemblySelection(
  value: unknown,
): AssistantConfigurationDisassemblySelection | null {
  if (!isRecord(value) || Object.keys(value).length !== 3 ||
    value.action !== "configuration_disassembly_target" ||
    typeof value.commercialCodeId !== "string" || !stockEntryUuidPattern.test(value.commercialCodeId) ||
    !isNonnegativeInteger(value.quantity) || value.quantity === 0) return null;
  return { action: value.action, commercialCodeId: value.commercialCodeId.toLowerCase(), quantity: value.quantity };
}

export type AssistantClarificationBlock = {
  kind: "assistant_clarification";
  title: string;
  message?: string;
  options: AssistantClarificationOption[];
  fallbackText: string;
};

export type AssistantSupplierOrderPickupMode =
  | "increment"
  | "set_total"
  | "mark_all";

export type AssistantSupplierOrderPickupPreviewItem = {
  id: string;
  displayCode: string;
  description: string;
  orderedQuantity: number;
  readyQuantity: number;
  cancelledQuantity: number;
  stockedQuantity: number;
  waitingStockQuantity: number;
  currentPickedQuantity: number;
  availableQuantity: number;
  requestedQuantity: number;
  addedQuantity: number;
  automaticStockEntryQuantity: number;
  targetPickedQuantity: number;
  remainingAfter: number;
};

export type AssistantSupplierOrderPickupPreviewLine = {
  id: string;
  displayCode: string;
  description: string;
  readyQuantity: number;
  currentPickedQuantity: number;
  availableQuantity: number;
  targetPickedQuantity: number;
  addedQuantity: number;
  automaticStockEntryQuantity: number;
  alreadyComplete: boolean;
};

export type AssistantSupplierOrderPickupPreviewBlock = {
  kind: "assistant_action_preview";
  action: "supplier_order_pickup";
  mode: AssistantSupplierOrderPickupMode;
  state: "pending" | "expired" | "cancelled";
  title: string;
  message: string;
  proposalToken: string | null;
  expiresAt: string | null;
  order: AssistantSupplierOrderCard;
  item?: AssistantSupplierOrderPickupPreviewItem;
  markAll?: {
    changedLines: number;
    addedPickedQuantity: number;
    items: AssistantSupplierOrderPickupPreviewLine[];
    hiddenItemCount: number;
  };
  warnings: string[];
  confirmLabel: "Confirmar retirada + entrada";
  cancelLabel: "Cancelar";
  regeneratePrompt: string;
};

export type AssistantActionResultLink = {
  kind: "link";
  label: string;
  href: string;
};

export type AssistantActionResultPrompt = {
  kind: "prompt";
  label: string;
  prompt: string;
};

export type AssistantSupplierOrderPickupResultBlock = {
  kind: "assistant_action_result";
  action: "supplier_order_pickup";
  outcome:
    | "success"
    | "no_change"
    | "conflict"
    | "error"
    | "cancelled"
    | "expired";
  title: string;
  message: string;
  order: AssistantSupplierOrderCard | null;
  item?: {
    id: string;
    displayCode: string;
    description: string;
    previousPickedQuantity: number;
    addedPickedQuantity: number;
    currentPickedQuantity: number;
    remainingPickupQuantity: number;
    automaticStockEntryQuantity: number | null;
  };
  markAll?: {
    changedLines: number;
    addedPickedQuantity: number;
    automaticStockEntryQuantity: number | null;
  };
  idempotentReplay: boolean;
  refreshWarning?: boolean;
  warnings?: string[];
  actions: Array<AssistantActionResultLink | AssistantActionResultPrompt>;
};

export type AssistantSupplierOrderPickupConfirmationResult = {
  block: AssistantSupplierOrderPickupResultBlock;
  contextSupplierOrderId: string | null;
  contextSupplierOrderCatalogCode: string | null;
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
  | AssistantSupplierOrderPhotoPreviewBlock
  | AssistantSupplierOrderPhotoCreateResultBlock
  | AssistantInventoryAlertsBlock
  | AssistantCatalogMediaBlock
  | AssistantInventoryItemSummaryBlock
  | AssistantServoModelInventoryBreakdownBlock
  | AssistantSupplierOrderListBlock
  | AssistantSupplierOrderDetailBlock
  | AssistantSupplierOrderAggregateBlock
  | AssistantSupplierOrderAmbiguityBlock
  | AssistantPurchaseRecommendationBlock
  | AssistantClarificationBlock
  | AssistantSupplierOrderPickupPreviewBlock
  | AssistantSupplierOrderPickupResultBlock
  | AssistantSupplierOrderStockEntryPreviewBlock
  | AssistantSupplierOrderStockEntryResultBlock
  | AssistantManualStockEntryPreviewBlock
  | AssistantManualStockEntryResultBlock
  | AssistantManualStockOutputPreviewBlock
  | AssistantManualStockOutputResultBlock
  | AssistantConfigurationAssemblyPreviewBlock
  | AssistantConfigurationAssemblyResultBlock
  | AssistantConfigurationDisassemblyPreviewBlock
  | AssistantConfigurationDisassemblyResultBlock
  | AssistantSupplierOrderFinalizationPreviewBlock
  | AssistantSupplierOrderFinalizationResultBlock;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parseAssistantServoModelInventoryAction(
  value: unknown,
): AssistantServoModelInventoryAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalizedModel =
    typeof value.normalizedModel === "string"
      ? value.normalizedModel.trim()
      : "";

  if (
    !normalizedModel ||
    normalizedModel.length > assistantQueryMaxLength ||
    normalizeServoModel(normalizedModel) !== normalizedModel
  ) {
    return null;
  }

  if (
    value.action === "show_servo_model_inventory_breakdown" &&
    Object.keys(value).length === 2
  ) {
    return {
      action: value.action,
      normalizedModel,
    };
  }

  if (
    value.action === "show_servo_model_inventory_target" &&
    Object.keys(value).length === 4 &&
    (value.targetKind === "item" ||
      value.targetKind === "commercial_configuration") &&
    typeof value.targetId === "string" &&
    uuidPattern.test(value.targetId)
  ) {
    return {
      action: value.action,
      normalizedModel,
      targetKind: value.targetKind,
      targetId: value.targetId.toLowerCase(),
    };
  }

  return null;
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

function isSafeSupplierOrderActionHref(value: unknown): value is string {
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
      Boolean(orderId && uuidPattern.test(orderId))
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
    SERVO: customerFacingInventoryLabels.looseServo,
    INSTALLATION_KIT: "Kit de instalação",
    REPAIR_KIT: "Jogo de reparo",
    LOOSE_PART: "Peça avulsa",
    COMPLETE_BOX: customerFacingInventoryLabels.completeServoKit,
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
        ? "Servo com kit montado"
        : "Servos com kit montados"
      : itemType === "SERVO"
        ? value.currentStock === 1
          ? customerFacingInventoryLabels.looseServo
          : customerFacingInventoryLabels.looseServos
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

function parseServoModelInventoryBreakdown(
  value: Record<string, unknown>,
): AssistantServoModelInventoryBreakdownBlock | null {
  const model = value.model;
  const bareServo =
    value.bareServo === null
      ? null
      : parseInventoryItemSummaryTarget(value.bareServo);
  const configurationEntries = Array.isArray(value.configurations)
    ? value.configurations.map((entry) => {
        if (!isRecord(entry) || !Array.isArray(entry.aliases)) {
          return null;
        }

        const target = parseInventoryItemSummaryTarget(entry.target);
        const aliases = entry.aliases.filter(
          (alias): alias is string =>
            typeof alias === "string" && Boolean(alias.trim()),
        );
        const normalizedAliases = aliases.map((alias) =>
          alias.trim().toLocaleUpperCase("pt-BR"),
        );

        if (
          !target ||
          target.targetKind !== "commercial_configuration" ||
          target.itemType !== "COMPLETE_BOX" ||
          aliases.length === 0 ||
          aliases.length > 8 ||
          aliases.length !== entry.aliases.length ||
          new Set(normalizedAliases).size !== aliases.length ||
          !normalizedAliases.includes(
            target.displayCode.toLocaleUpperCase("pt-BR"),
          )
        ) {
          return null;
        }

        return {
          target: target as AssistantServoModelConfigurationTarget["target"],
          aliases: aliases.map((alias) => alias.trim()),
        };
      })
    : [];
  const officialModel =
    isRecord(model) && typeof model.official === "string"
      ? model.official.trim()
      : "";
  const normalizedModel =
    isRecord(model) && typeof model.normalized === "string"
      ? model.normalized.trim()
      : "";

  if (
    !officialModel ||
    officialModel.length > assistantQueryMaxLength ||
    !normalizedModel ||
    normalizeServoModel(officialModel) !== normalizedModel ||
    normalizeServoModel(normalizedModel) !== normalizedModel ||
    (bareServo !== null &&
      (bareServo.targetKind !== "item" ||
        bareServo.itemType !== "SERVO")) ||
    !Array.isArray(value.configurations) ||
    configurationEntries.length > 6 ||
    configurationEntries.some((entry) => entry === null) ||
    new Set(
      configurationEntries.map((entry) => entry?.target.targetId),
    ).size !== configurationEntries.length ||
    !isNonnegativeInteger(value.totalConfigurations) ||
    !isNonnegativeInteger(value.remainingConfigurations) ||
    value.totalConfigurations !==
      configurationEntries.length + value.remainingConfigurations ||
    bareServo === null && value.totalConfigurations === 0 ||
    value.inventoryHref !== "/estoque" ||
    typeof value.fallbackText !== "string" ||
    !value.fallbackText.trim()
  ) {
    return null;
  }

  return {
    kind: "servo_model_inventory_breakdown",
    model: {
      official: officialModel,
      normalized: normalizedModel,
    },
    bareServo: bareServo as AssistantServoModelInventoryBreakdownBlock["bareServo"],
    configurations:
      configurationEntries as AssistantServoModelConfigurationTarget[],
    totalConfigurations: value.totalConfigurations,
    remainingConfigurations: value.remainingConfigurations,
    inventoryHref: "/estoque",
    fallbackText: value.fallbackText.trim(),
  };
}

function parsePurchaseRecommendationItem(
  value: unknown,
): PurchaseRecommendationItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const expectedTypeLabel = {
    SERVO: customerFacingInventoryLabels.looseServo,
    INSTALLATION_KIT: "Kit de instalação",
    REPAIR_KIT: "Jogo de reparo",
    LOOSE_PART: "Peça avulsa",
    COMPLETE_BOX: customerFacingInventoryLabels.completeServoKit,
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

function parseSupplierOrderPickupPreviewItem(
  value: unknown,
): AssistantSupplierOrderPickupPreviewItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !uuidPattern.test(value.id) ||
    typeof value.displayCode !== "string" ||
    !value.displayCode.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    !isNonnegativeInteger(value.orderedQuantity) ||
    !isNonnegativeInteger(value.readyQuantity) ||
    !isNonnegativeInteger(value.cancelledQuantity) ||
    !isNonnegativeInteger(value.stockedQuantity) ||
    !isNonnegativeInteger(value.waitingStockQuantity) ||
    !isNonnegativeInteger(value.currentPickedQuantity) ||
    !isNonnegativeInteger(value.availableQuantity) ||
    !isNonnegativeInteger(value.requestedQuantity) ||
    !isNonnegativeInteger(value.addedQuantity) ||
    !isNonnegativeInteger(value.automaticStockEntryQuantity) ||
    !isNonnegativeInteger(value.targetPickedQuantity) ||
    !isNonnegativeInteger(value.remainingAfter) ||
    value.requestedQuantity === 0 ||
    value.addedQuantity === 0 ||
    value.automaticStockEntryQuantity !== value.addedQuantity ||
    value.targetPickedQuantity !==
      value.currentPickedQuantity + value.addedQuantity ||
    value.readyQuantity + value.cancelledQuantity >
      value.orderedQuantity ||
    value.targetPickedQuantity > value.readyQuantity ||
    value.availableQuantity !==
      value.readyQuantity - value.currentPickedQuantity ||
    value.remainingAfter !==
      value.readyQuantity - value.targetPickedQuantity ||
    value.stockedQuantity > value.currentPickedQuantity
  ) {
    return null;
  }

  return value as AssistantSupplierOrderPickupPreviewItem;
}

function parseSupplierOrderPickupPreviewLine(
  value: unknown,
): AssistantSupplierOrderPickupPreviewLine | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !uuidPattern.test(value.id) ||
    typeof value.displayCode !== "string" ||
    !value.displayCode.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    !isNonnegativeInteger(value.readyQuantity) ||
    !isNonnegativeInteger(value.currentPickedQuantity) ||
    !isNonnegativeInteger(value.availableQuantity) ||
    !isNonnegativeInteger(value.targetPickedQuantity) ||
    !isNonnegativeInteger(value.addedQuantity) ||
    !isNonnegativeInteger(value.automaticStockEntryQuantity) ||
    typeof value.alreadyComplete !== "boolean" ||
    value.targetPickedQuantity !==
      value.currentPickedQuantity + value.addedQuantity ||
    value.targetPickedQuantity !== value.readyQuantity ||
    value.availableQuantity !==
      value.readyQuantity - value.currentPickedQuantity ||
    value.automaticStockEntryQuantity !== value.addedQuantity ||
    value.alreadyComplete !== (value.addedQuantity === 0)
  ) {
    return null;
  }

  return value as AssistantSupplierOrderPickupPreviewLine;
}

function parseAssistantActionResultAction(
  value: unknown,
): AssistantActionResultLink | AssistantActionResultPrompt | null {
  if (
    !isRecord(value) ||
    typeof value.label !== "string" ||
    !value.label.trim() ||
    value.label.length > 80
  ) {
    return null;
  }

  if (
    value.kind === "link" &&
    (isSafeSupplierOrderActionHref(value.href) ||
      isSafeInventoryHref(value.href) ||
      value.href === "/historico")
  ) {
    return {
      kind: "link",
      label: value.label.trim(),
      href: value.href,
    };
  }

  if (
    value.kind === "prompt" &&
    typeof value.prompt === "string" &&
    value.prompt.trim() &&
    value.prompt.length <= 240
  ) {
    return {
      kind: "prompt",
      label: value.label.trim(),
      prompt: value.prompt.trim(),
    };
  }

  return null;
}

function parseStockEntryTarget(value: unknown): AssistantStockEntryTarget | null {
  if (!isRecord(value)) return null;
  const configurationId = value.configurationId;
  if (
    (value.kind !== "ITEM" && value.kind !== "COMMERCIAL_CODE") ||
    typeof value.targetId !== "string" || !uuidPattern.test(value.targetId) ||
    (configurationId !== null && (typeof configurationId !== "string" || !uuidPattern.test(configurationId))) ||
    typeof value.displayCode !== "string" || !value.displayCode.trim() || value.displayCode.length > 120 ||
    !Array.isArray(value.aliases) || value.aliases.length > 20 ||
    value.aliases.some((alias) => typeof alias !== "string" || !alias.trim() || alias.length > 120) ||
    typeof value.typeLabel !== "string" || !value.typeLabel.trim() || value.typeLabel.length > 80 ||
    typeof value.description !== "string" || !value.description.trim() || value.description.length > 500 ||
    (value.detail !== null && (typeof value.detail !== "string" || value.detail.length > 500)) ||
    !isNonnegativeInteger(value.currentStock) ||
    (value.kind === "ITEM" && configurationId !== null) ||
    (value.kind === "COMMERCIAL_CODE" && configurationId === null)
  ) return null;
  return {
    kind: value.kind,
    targetId: value.targetId.toLowerCase(),
    configurationId: typeof configurationId === "string" ? configurationId.toLowerCase() : null,
    displayCode: value.displayCode.trim(),
    aliases: Array.from(new Set(value.aliases.map((alias) => String(alias).trim()))),
    typeLabel: value.typeLabel.trim(),
    description: value.description.trim(),
    detail: typeof value.detail === "string" && value.detail.trim() ? value.detail.trim() : null,
    currentStock: value.currentStock,
  };
}

function parseStockOutputComponent(value: unknown): AssistantStockOutputComponent | null {
  if (!isRecord(value) || typeof value.id !== "string" || !uuidPattern.test(value.id) ||
    typeof value.code !== "string" || !value.code.trim() || value.code.length > 120 ||
    typeof value.description !== "string" || !value.description.trim() || value.description.length > 500 ||
    !isNonnegativeInteger(value.currentStock)) return null;
  return { id: value.id.toLowerCase(), code: value.code.trim(), description: value.description.trim(), currentStock: value.currentStock };
}

function parseStockOutputTarget(value: unknown): AssistantStockOutputTarget | null {
  const base = parseStockEntryTarget(value);
  if (!base || !isRecord(value) || !isNonnegativeInteger(value.availableStock) ||
    !isNonnegativeInteger(value.autoAssemblyCapacity)) return null;
  const servo = value.servo === null ? null : parseStockOutputComponent(value.servo);
  const installationKit = value.installationKit === null ? null : parseStockOutputComponent(value.installationKit);
  if ((value.servo !== null && !servo) || (value.installationKit !== null && !installationKit) ||
    (base.kind === "ITEM" && (servo || installationKit || value.autoAssemblyCapacity !== 0 || value.availableStock !== base.currentStock)) ||
    (base.kind === "COMMERCIAL_CODE" && (!servo || !installationKit ||
      value.availableStock !== base.currentStock + value.autoAssemblyCapacity ||
      value.autoAssemblyCapacity !== Math.min(servo.currentStock, installationKit.currentStock)))) return null;
  return { ...base, availableStock: value.availableStock, autoAssemblyCapacity: value.autoAssemblyCapacity, servo, installationKit };
}

function parseConfigurationAssemblyComponent(value: unknown): AssistantConfigurationAssemblyComponent | null {
  if (!isRecord(value) || typeof value.id !== "string" || !uuidPattern.test(value.id) ||
    typeof value.code !== "string" || !value.code.trim() || value.code.length > 120 ||
    typeof value.description !== "string" || !value.description.trim() || value.description.length > 500 ||
    !isNonnegativeInteger(value.currentStock)) return null;
  return { id: value.id.toLowerCase(), code: value.code.trim(), description: value.description.trim(), currentStock: value.currentStock };
}

function parseConfigurationAssemblyTarget(value: unknown): AssistantConfigurationAssemblyTarget | null {
  if (!isRecord(value) || typeof value.commercialCodeId !== "string" || !uuidPattern.test(value.commercialCodeId) ||
    typeof value.configurationId !== "string" || !uuidPattern.test(value.configurationId) ||
    typeof value.displayCode !== "string" || !value.displayCode.trim() || value.displayCode.length > 120 ||
    !Array.isArray(value.aliases) || value.aliases.length > 20 ||
    value.aliases.some((alias) => typeof alias !== "string" || !alias.trim() || alias.length > 120) ||
    typeof value.description !== "string" || !value.description.trim() || value.description.length > 500 ||
    !isNonnegativeInteger(value.currentStock) || !isNonnegativeInteger(value.capacity)) return null;
  const servo = parseConfigurationAssemblyComponent(value.servo);
  const installationKit = parseConfigurationAssemblyComponent(value.installationKit);
  if (!servo || !installationKit || value.capacity !== Math.min(servo.currentStock, installationKit.currentStock)) return null;
  return { commercialCodeId: value.commercialCodeId.toLowerCase(), configurationId: value.configurationId.toLowerCase(),
    displayCode: value.displayCode.trim(), aliases: Array.from(new Set(value.aliases.map((alias) => String(alias).trim()))),
    description: value.description.trim(), currentStock: value.currentStock, capacity: value.capacity, servo, installationKit };
}

function parseStockEntryResultActions(value: unknown) {
  if (!Array.isArray(value) || value.length > 4) return null;
  const actions = value.map(parseAssistantActionResultAction);
  return actions.every(Boolean)
    ? actions as Array<AssistantActionResultLink | AssistantActionResultPrompt>
    : null;
}

function parseOperationalPreviewBase(
  value: Record<string, unknown>,
  confirmLabel: "Confirmar entrada" | "Confirmar saída" | "Confirmar montagem" | "Confirmar desmontagem" = "Confirmar entrada",
) {
  const pending = value.state === "pending";
  if (
    !["pending", "expired", "cancelled"].includes(String(value.state)) ||
    typeof value.title !== "string" || !value.title.trim() || value.title.length > 120 ||
    typeof value.message !== "string" || !value.message.trim() || value.message.length > 500 ||
    (pending
      ? typeof value.proposalToken !== "string" || value.proposalToken.length > 4096 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.proposalToken) ||
        typeof value.expiresAt !== "string" || Number.isNaN(Date.parse(value.expiresAt))
      : value.proposalToken !== null || value.expiresAt !== null) ||
    value.confirmLabel !== confirmLabel || value.cancelLabel !== "Cancelar" ||
    typeof value.regeneratePrompt !== "string" || !value.regeneratePrompt.trim() || value.regeneratePrompt.length > 240 ||
    !isNonnegativeInteger(value.totalQuantity) || value.totalQuantity === 0
  ) return null;
  return {
    state: value.state as "pending" | "expired" | "cancelled",
    title: value.title.trim(), message: value.message.trim(),
    proposalToken: pending ? value.proposalToken as string : null,
    expiresAt: pending ? value.expiresAt as string : null,
    totalQuantity: value.totalQuantity,
    regeneratePrompt: value.regeneratePrompt.trim(),
  };
}

export function parseAssistantStructuredBlock(
  value: unknown,
): AssistantStructuredBlock | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "supplier_order_photo_preview") {
    return parseAssistantSupplierOrderPhotoPreviewBlock(value);
  }

  if (value.kind === "supplier_order_photo_create_result") {
    return parseAssistantSupplierOrderPhotoCreateResultBlock(value);
  }

  if (value.kind === "supplier_order_stock_entry_preview") {
    const base = parseOperationalPreviewBase(value);
    const order = parseSupplierOrderCard(value.order);
    const lines = Array.isArray(value.lines) ? value.lines.map((raw) => {
      if (!isRecord(raw)) return null;
      const target = parseStockEntryTarget(raw.target);
      if (!target || typeof raw.supplierOrderItemId !== "string" || !uuidPattern.test(raw.supplierOrderItemId) ||
        !isNonnegativeInteger(raw.orderedQuantity) || !isNonnegativeInteger(raw.pickedQuantity) ||
        !isNonnegativeInteger(raw.stockedQuantity) || !isNonnegativeInteger(raw.availableQuantity) ||
        !isNonnegativeInteger(raw.entryQuantity) || raw.entryQuantity === 0 ||
        !isNonnegativeInteger(raw.remainingQuantity) || !isNonnegativeInteger(raw.estimatedStockAfter) ||
        raw.availableQuantity !== raw.pickedQuantity - raw.stockedQuantity ||
        raw.entryQuantity > raw.availableQuantity || raw.remainingQuantity !== raw.availableQuantity - raw.entryQuantity ||
        raw.estimatedStockAfter < target.currentStock + raw.entryQuantity) return null;
      return { supplierOrderItemId: raw.supplierOrderItemId.toLowerCase(), target,
        orderedQuantity: raw.orderedQuantity, pickedQuantity: raw.pickedQuantity,
        stockedQuantity: raw.stockedQuantity, availableQuantity: raw.availableQuantity,
        entryQuantity: raw.entryQuantity, remainingQuantity: raw.remainingQuantity,
        estimatedStockAfter: raw.estimatedStockAfter };
    }) : [];
    if (!base || value.action !== "supplier_order_stock_entry" || !order || lines.length < 1 || lines.length > 1000 ||
      lines.some((line) => line === null) || lines.reduce((sum, line) => sum + (line?.entryQuantity ?? 0), 0) !== base.totalQuantity) return null;
    return { kind: value.kind, action: value.action, ...base, order,
      lines: lines as AssistantSupplierOrderStockEntryPreviewLine[],
      confirmLabel: "Confirmar entrada", cancelLabel: "Cancelar" };
  }

  if (value.kind === "manual_stock_entry_preview") {
    const base = parseOperationalPreviewBase(value);
    const lines = Array.isArray(value.lines) ? value.lines.map((raw) => {
      if (!isRecord(raw)) return null;
      const target = parseStockEntryTarget(raw.target);
      if (!target || !isNonnegativeInteger(raw.entryQuantity) || raw.entryQuantity === 0 ||
        !isNonnegativeInteger(raw.estimatedStockAfter) || raw.estimatedStockAfter !== target.currentStock + raw.entryQuantity) return null;
      return { target, entryQuantity: raw.entryQuantity, estimatedStockAfter: raw.estimatedStockAfter };
    }) : [];
    if (!base || value.action !== "manual_stock_entry" || lines.length < 1 || lines.length > 500 ||
      lines.some((line) => line === null) || lines.reduce((sum, line) => sum + (line?.entryQuantity ?? 0), 0) !== base.totalQuantity) return null;
    return { kind: value.kind, action: value.action, ...base,
      title: base.title as AssistantManualStockEntryPreviewBlock["title"],
      lines: lines as AssistantManualStockEntryPreviewLine[],
      confirmLabel: "Confirmar entrada", cancelLabel: "Cancelar" };
  }

  if (value.kind === "supplier_order_stock_entry_result" || value.kind === "manual_stock_entry_result") {
    const isOrder = value.kind === "supplier_order_stock_entry_result";
    const expectedAction = isOrder ? "supplier_order_stock_entry" : "manual_stock_entry";
    const actions = parseStockEntryResultActions(value.actions);
    const order = isOrder && value.order !== null ? parseSupplierOrderCard(value.order) : null;
    const lines = Array.isArray(value.lines) ? value.lines.map((raw) => {
      if (!isRecord(raw)) return null;
      const target = parseStockEntryTarget(raw.target);
      if (!target || !isNonnegativeInteger(raw.entryQuantity) || raw.entryQuantity === 0 ||
        !isNonnegativeInteger(raw.previousStock) || !isNonnegativeInteger(raw.currentStock) ||
        (!isOrder && raw.currentStock !== raw.previousStock + raw.entryQuantity)) return null;
      if (isOrder && (typeof raw.supplierOrderItemId !== "string" || !uuidPattern.test(raw.supplierOrderItemId) ||
        !isNonnegativeInteger(raw.totalStockedQuantity) || !isNonnegativeInteger(raw.remainingQuantity))) return null;
      return isOrder
        ? { supplierOrderItemId: raw.supplierOrderItemId as string, target, entryQuantity: raw.entryQuantity,
            totalStockedQuantity: raw.totalStockedQuantity as number, remainingQuantity: raw.remainingQuantity as number,
            previousStock: raw.previousStock, currentStock: raw.currentStock }
        : { target, entryQuantity: raw.entryQuantity, previousStock: raw.previousStock, currentStock: raw.currentStock };
    }) : [];
    const allowedOutcomes = isOrder ? ["success", "conflict", "error", "cancelled", "expired"] : ["success", "error", "cancelled", "expired"];
    if (value.action !== expectedAction || !allowedOutcomes.includes(String(value.outcome)) ||
      typeof value.title !== "string" || !value.title.trim() || typeof value.message !== "string" || !value.message.trim() ||
      !isNonnegativeInteger(value.linesProcessed) || !isNonnegativeInteger(value.totalQuantity) ||
      (value.occurredAt !== null && (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt)))) ||
      (value.reference !== null && (typeof value.reference !== "string" || !uuidPattern.test(value.reference))) ||
      typeof value.idempotentReplay !== "boolean" || (value.refreshWarning !== undefined && typeof value.refreshWarning !== "boolean") ||
      !actions || lines.some((line) => line === null) || (isOrder && value.order !== null && !order)) return null;
    const common = { action: expectedAction as "supplier_order_stock_entry" | "manual_stock_entry", outcome: value.outcome as never,
      title: value.title.trim(), message: value.message.trim(), linesProcessed: value.linesProcessed,
      totalQuantity: value.totalQuantity, occurredAt: value.occurredAt as string | null,
      reference: value.reference as string | null, idempotentReplay: value.idempotentReplay,
      ...(value.refreshWarning ? { refreshWarning: true } : {}), actions };
    return isOrder
      ? { kind: "supplier_order_stock_entry_result", ...common, action: "supplier_order_stock_entry", order,
          lines: lines as AssistantSupplierOrderStockEntryResultLine[] } as AssistantSupplierOrderStockEntryResultBlock
      : { kind: "manual_stock_entry_result", ...common, action: "manual_stock_entry",
          lines: lines as AssistantManualStockEntryResultLine[] } as AssistantManualStockEntryResultBlock;
  }

  if (value.kind === "configuration_assembly_preview") {
    const base = parseOperationalPreviewBase(value, "Confirmar montagem");
    const target = parseConfigurationAssemblyTarget(value.target);
    if (!base || value.action !== "configuration_assembly" || !target ||
      !isNonnegativeInteger(value.quantity) || value.quantity === 0 || value.quantity !== base.totalQuantity ||
      value.quantity > target.capacity || !isNonnegativeInteger(value.mountedStockAfter) ||
      !isNonnegativeInteger(value.servoStockAfter) || !isNonnegativeInteger(value.installationKitStockAfter) ||
      value.mountedStockAfter !== target.currentStock + value.quantity ||
      value.servoStockAfter !== target.servo.currentStock - value.quantity ||
      value.installationKitStockAfter !== target.installationKit.currentStock - value.quantity) return null;
    return { kind: value.kind, action: value.action, ...base,
      title: base.title as AssistantConfigurationAssemblyPreviewBlock["title"], target, quantity: value.quantity,
      mountedStockAfter: value.mountedStockAfter, servoStockAfter: value.servoStockAfter,
      installationKitStockAfter: value.installationKitStockAfter,
      confirmLabel: "Confirmar montagem", cancelLabel: "Cancelar" };
  }

  if (value.kind === "configuration_assembly_result") {
    const actions = parseStockEntryResultActions(value.actions);
    const target = value.target === null ? null : parseConfigurationAssemblyTarget(value.target);
    const metrics = [value.mountedStockBefore, value.mountedStockAfter, value.servoStockBefore, value.servoStockAfter,
      value.installationKitStockBefore, value.installationKitStockAfter];
    if (value.action !== "configuration_assembly" || !["success", "error", "cancelled", "expired"].includes(String(value.outcome)) ||
      typeof value.title !== "string" || !value.title.trim() || typeof value.message !== "string" || !value.message.trim() ||
      !isNonnegativeInteger(value.quantity) || metrics.some((metric) => metric !== null && !isNonnegativeInteger(metric)) ||
      (value.occurredAt !== null && (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt)))) ||
      (value.reference !== null && (typeof value.reference !== "string" || !uuidPattern.test(value.reference))) ||
      typeof value.idempotentReplay !== "boolean" || (value.refreshWarning !== undefined && typeof value.refreshWarning !== "boolean") ||
      !actions || (value.target !== null && !target)) return null;
    if (value.outcome === "success" && target && (value.quantity === 0 || metrics.some((metric) => metric === null) ||
      value.mountedStockAfter !== Number(value.mountedStockBefore) + value.quantity ||
      value.servoStockAfter !== Number(value.servoStockBefore) - value.quantity ||
      value.installationKitStockAfter !== Number(value.installationKitStockBefore) - value.quantity)) return null;
    if (value.outcome === "success" && !target &&
      (value.refreshWarning !== true || value.quantity !== 0 || metrics.some((metric) => metric !== null))) return null;
    return { kind: value.kind, action: value.action,
      outcome: value.outcome as AssistantConfigurationAssemblyResultBlock["outcome"], title: value.title.trim(),
      message: value.message.trim(), target, quantity: value.quantity,
      mountedStockBefore: value.mountedStockBefore as number | null, mountedStockAfter: value.mountedStockAfter as number | null,
      servoStockBefore: value.servoStockBefore as number | null, servoStockAfter: value.servoStockAfter as number | null,
      installationKitStockBefore: value.installationKitStockBefore as number | null,
      installationKitStockAfter: value.installationKitStockAfter as number | null,
      occurredAt: value.occurredAt as string | null, reference: value.reference as string | null,
      idempotentReplay: value.idempotentReplay, ...(value.refreshWarning ? { refreshWarning: true } : {}), actions };
  }

  if (value.kind === "configuration_disassembly_preview") {
    const base = parseOperationalPreviewBase(value, "Confirmar desmontagem");
    const target = parseConfigurationAssemblyTarget(value.target);
    if (!base || value.action !== "configuration_disassembly" || !target ||
      !isNonnegativeInteger(value.quantity) || value.quantity === 0 || value.quantity !== base.totalQuantity ||
      value.quantity > target.currentStock || !isNonnegativeInteger(value.mountedStockAfter) ||
      !isNonnegativeInteger(value.servoStockAfter) || !isNonnegativeInteger(value.installationKitStockAfter) ||
      value.mountedStockAfter !== target.currentStock - value.quantity ||
      value.servoStockAfter !== target.servo.currentStock + value.quantity ||
      value.installationKitStockAfter !== target.installationKit.currentStock + value.quantity) return null;
    return { kind: value.kind, action: value.action, ...base,
      title: base.title as AssistantConfigurationDisassemblyPreviewBlock["title"], target, quantity: value.quantity,
      mountedStockAfter: value.mountedStockAfter, servoStockAfter: value.servoStockAfter,
      installationKitStockAfter: value.installationKitStockAfter,
      confirmLabel: "Confirmar desmontagem", cancelLabel: "Cancelar" };
  }

  if (value.kind === "configuration_disassembly_result") {
    const actions = parseStockEntryResultActions(value.actions);
    const target = value.target === null ? null : parseConfigurationAssemblyTarget(value.target);
    const metrics = [value.mountedStockBefore, value.mountedStockAfter, value.servoStockBefore, value.servoStockAfter,
      value.installationKitStockBefore, value.installationKitStockAfter];
    if (value.action !== "configuration_disassembly" || !["success", "error", "cancelled", "expired"].includes(String(value.outcome)) ||
      typeof value.title !== "string" || !value.title.trim() || typeof value.message !== "string" || !value.message.trim() ||
      !isNonnegativeInteger(value.quantity) || metrics.some((metric) => metric !== null && !isNonnegativeInteger(metric)) ||
      (value.occurredAt !== null && (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt)))) ||
      (value.reference !== null && (typeof value.reference !== "string" || !uuidPattern.test(value.reference))) ||
      typeof value.idempotentReplay !== "boolean" || (value.refreshWarning !== undefined && typeof value.refreshWarning !== "boolean") ||
      !actions || (value.target !== null && !target)) return null;
    if (value.outcome === "success" && target && (value.quantity === 0 || metrics.some((metric) => metric === null) ||
      value.mountedStockAfter !== Number(value.mountedStockBefore) - value.quantity ||
      value.servoStockAfter !== Number(value.servoStockBefore) + value.quantity ||
      value.installationKitStockAfter !== Number(value.installationKitStockBefore) + value.quantity)) return null;
    if (value.outcome === "success" && !target &&
      (value.refreshWarning !== true || value.quantity !== 0 || metrics.some((metric) => metric !== null))) return null;
    return { kind: value.kind, action: value.action,
      outcome: value.outcome as AssistantConfigurationDisassemblyResultBlock["outcome"], title: value.title.trim(),
      message: value.message.trim(), target, quantity: value.quantity,
      mountedStockBefore: value.mountedStockBefore as number | null, mountedStockAfter: value.mountedStockAfter as number | null,
      servoStockBefore: value.servoStockBefore as number | null, servoStockAfter: value.servoStockAfter as number | null,
      installationKitStockBefore: value.installationKitStockBefore as number | null,
      installationKitStockAfter: value.installationKitStockAfter as number | null,
      occurredAt: value.occurredAt as string | null, reference: value.reference as string | null,
      idempotentReplay: value.idempotentReplay, ...(value.refreshWarning ? { refreshWarning: true } : {}), actions };
  }

  if (value.kind === "supplier_order_finalization_preview") {
    const order = parseSupplierOrderCard(value.order);
    const pending = value.state === "pending";
    if (value.action !== "supplier_order_finalization" || !order ||
      !["pending", "expired", "cancelled"].includes(String(value.state)) ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 120 ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > 500 ||
      (pending ? typeof value.proposalToken !== "string" || value.proposalToken.length > 4096 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.proposalToken) ||
        typeof value.expiresAt !== "string" || Number.isNaN(Date.parse(value.expiresAt))
        : value.proposalToken !== null || value.expiresAt !== null) ||
      value.confirmLabel !== "Confirmar finalização" || value.cancelLabel !== "Cancelar" ||
      typeof value.regeneratePrompt !== "string" || !value.regeneratePrompt.trim() || value.regeneratePrompt.length > 240) return null;
    return { kind: value.kind, action: value.action,
      state: value.state as AssistantSupplierOrderFinalizationPreviewBlock["state"], title: value.title.trim(),
      message: value.message.trim(), proposalToken: pending ? value.proposalToken as string : null,
      expiresAt: pending ? value.expiresAt as string : null, order,
      confirmLabel: "Confirmar finalização", cancelLabel: "Cancelar", regeneratePrompt: value.regeneratePrompt.trim() };
  }

  if (value.kind === "supplier_order_finalization_result") {
    const order = value.order === null ? null : parseSupplierOrderCard(value.order);
    const actions = parseStockEntryResultActions(value.actions);
    if (value.action !== "supplier_order_finalization" ||
      !["success", "conflict", "error", "cancelled", "expired"].includes(String(value.outcome)) ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 120 ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > 500 ||
      (value.order !== null && !order) ||
      (value.occurredAt !== null && (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt)))) ||
      typeof value.idempotentReplay !== "boolean" ||
      (value.refreshWarning !== undefined && typeof value.refreshWarning !== "boolean") || !actions) return null;
    return { kind: value.kind, action: value.action,
      outcome: value.outcome as AssistantSupplierOrderFinalizationResultBlock["outcome"], title: value.title.trim(),
      message: value.message.trim(), order, occurredAt: value.occurredAt as string | null,
      idempotentReplay: value.idempotentReplay, ...(value.refreshWarning ? { refreshWarning: true } : {}), actions };
  }

  if (value.kind === "manual_stock_output_preview") {
    const base = parseOperationalPreviewBase(value, "Confirmar saída");
    const lines = Array.isArray(value.lines) ? value.lines.map((raw) => {
      if (!isRecord(raw)) return null;
      const target = parseStockOutputTarget(raw.target);
      if (!target || !isNonnegativeInteger(raw.outputQuantity) || raw.outputQuantity === 0 ||
        !isNonnegativeInteger(raw.estimatedStockAfter) || !isNonnegativeInteger(raw.autoAssembledQuantity) ||
        raw.outputQuantity > target.availableStock ||
        raw.estimatedStockAfter !== target.currentStock + raw.autoAssembledQuantity - raw.outputQuantity ||
        raw.autoAssembledQuantity !== Math.max(0, raw.outputQuantity - target.currentStock)) return null;
      return { target, outputQuantity: raw.outputQuantity, estimatedStockAfter: raw.estimatedStockAfter,
        autoAssembledQuantity: raw.autoAssembledQuantity };
    }) : [];
    const autoAssemblyTotal = lines.reduce((sum, line) => sum + (line?.autoAssembledQuantity ?? 0), 0);
    if (!base || value.action !== "manual_stock_output" || lines.length < 1 || lines.length > 500 ||
      lines.some((line) => line === null) || lines.reduce((sum, line) => sum + (line?.outputQuantity ?? 0), 0) !== base.totalQuantity ||
      !isNonnegativeInteger(value.totalAutoAssemblyQuantity) || value.totalAutoAssemblyQuantity !== autoAssemblyTotal) return null;
    return { kind: value.kind, action: value.action, ...base,
      title: base.title as AssistantManualStockOutputPreviewBlock["title"],
      lines: lines as AssistantManualStockOutputPreviewLine[], totalAutoAssemblyQuantity: autoAssemblyTotal,
      confirmLabel: "Confirmar saída", cancelLabel: "Cancelar" };
  }

  if (value.kind === "manual_stock_output_result") {
    const actions = parseStockEntryResultActions(value.actions);
    const lines = Array.isArray(value.lines) ? value.lines.map((raw) => {
      if (!isRecord(raw)) return null;
      const target = parseStockOutputTarget(raw.target);
      if (!target || !isNonnegativeInteger(raw.outputQuantity) || raw.outputQuantity === 0 ||
        !isNonnegativeInteger(raw.previousStock) || !isNonnegativeInteger(raw.currentStock) ||
        !isNonnegativeInteger(raw.autoAssembledQuantity) ||
        raw.currentStock !== raw.previousStock + raw.autoAssembledQuantity - raw.outputQuantity) return null;
      return { target, outputQuantity: raw.outputQuantity, previousStock: raw.previousStock,
        currentStock: raw.currentStock, autoAssembledQuantity: raw.autoAssembledQuantity };
    }) : [];
    if (value.action !== "manual_stock_output" || !["success", "error", "cancelled", "expired"].includes(String(value.outcome)) ||
      typeof value.title !== "string" || !value.title.trim() || typeof value.message !== "string" || !value.message.trim() ||
      !isNonnegativeInteger(value.linesProcessed) || !isNonnegativeInteger(value.totalQuantity) ||
      !isNonnegativeInteger(value.totalAutoAssemblyQuantity) ||
      (value.occurredAt !== null && (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt)))) ||
      (value.reference !== null && (typeof value.reference !== "string" || !uuidPattern.test(value.reference))) ||
      typeof value.idempotentReplay !== "boolean" || (value.refreshWarning !== undefined && typeof value.refreshWarning !== "boolean") ||
      !actions || lines.some((line) => line === null)) return null;
    return { kind: value.kind, action: value.action, outcome: value.outcome as AssistantManualStockOutputResultBlock["outcome"],
      title: value.title.trim(), message: value.message.trim(), lines: lines as AssistantManualStockOutputResultLine[],
      linesProcessed: value.linesProcessed, totalQuantity: value.totalQuantity,
      totalAutoAssemblyQuantity: value.totalAutoAssemblyQuantity, occurredAt: value.occurredAt as string | null,
      reference: value.reference as string | null, idempotentReplay: value.idempotentReplay,
      ...(value.refreshWarning ? { refreshWarning: true } : {}), actions };
  }

  if (value.kind === "assistant_action_preview") {
    const order = parseSupplierOrderCard(value.order);
    const item =
      value.item === undefined
        ? undefined
        : parseSupplierOrderPickupPreviewItem(value.item);
    const markAll = value.markAll;
    const markAllItems =
      isRecord(markAll) && Array.isArray(markAll.items)
        ? markAll.items.map(parseSupplierOrderPickupPreviewLine)
        : [];
    const warnings = Array.isArray(value.warnings)
      ? value.warnings
      : [];
    const isPending = value.state === "pending";

    if (
      value.action !== "supplier_order_pickup" ||
      !["increment", "set_total", "mark_all"].includes(
        String(value.mode),
      ) ||
      !["pending", "expired", "cancelled"].includes(
        String(value.state),
      ) ||
      typeof value.title !== "string" ||
      !value.title.trim() ||
      value.title.length > 120 ||
      typeof value.message !== "string" ||
      !value.message.trim() ||
      value.message.length > 500 ||
      (isPending
        ? typeof value.proposalToken !== "string" ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
            value.proposalToken,
          ) ||
          value.proposalToken.length > 4096 ||
          typeof value.expiresAt !== "string" ||
          Number.isNaN(Date.parse(value.expiresAt))
        : value.proposalToken !== null || value.expiresAt !== null) ||
      !order ||
      !Array.isArray(value.warnings) ||
      warnings.length > 10 ||
      warnings.some(
        (warning) =>
          typeof warning !== "string" ||
          !warning.trim() ||
          warning.length > 240,
      ) ||
      value.confirmLabel !== "Confirmar retirada + entrada" ||
      value.cancelLabel !== "Cancelar" ||
      typeof value.regeneratePrompt !== "string" ||
      !value.regeneratePrompt.trim() ||
      value.regeneratePrompt.length > 240 ||
      (value.mode === "mark_all"
        ? item !== undefined ||
          !isRecord(markAll) ||
          !isNonnegativeInteger(markAll.changedLines) ||
          markAll.changedLines === 0 ||
          !isNonnegativeInteger(markAll.addedPickedQuantity) ||
          markAll.addedPickedQuantity === 0 ||
          !Array.isArray(markAll.items) ||
          markAllItems.length > 20 ||
          markAllItems.some((line) => line === null) ||
          !isNonnegativeInteger(markAll.hiddenItemCount)
        : !item || value.markAll !== undefined)
    ) {
      return null;
    }

    return {
      kind: "assistant_action_preview",
      action: "supplier_order_pickup",
      mode:
        value.mode as AssistantSupplierOrderPickupMode,
      state:
        value.state as AssistantSupplierOrderPickupPreviewBlock["state"],
      title: value.title.trim(),
      message: value.message.trim(),
      proposalToken: isPending
        ? (value.proposalToken as string)
        : null,
      expiresAt: isPending ? (value.expiresAt as string) : null,
      order,
      ...(item ? { item } : {}),
      ...(value.mode === "mark_all" && isRecord(markAll)
        ? {
            markAll: {
              changedLines: markAll.changedLines as number,
              addedPickedQuantity:
                markAll.addedPickedQuantity as number,
              items:
                markAllItems as AssistantSupplierOrderPickupPreviewLine[],
              hiddenItemCount: markAll.hiddenItemCount as number,
            },
          }
        : {}),
      warnings: warnings.map((warning) => String(warning).trim()),
      confirmLabel: "Confirmar retirada + entrada",
      cancelLabel: "Cancelar",
      regeneratePrompt: value.regeneratePrompt.trim(),
    };
  }

  if (value.kind === "assistant_action_result") {
    const order =
      value.order === null ? null : parseSupplierOrderCard(value.order);
    const item = value.item;
    const markAll = value.markAll;
    const actions = Array.isArray(value.actions)
      ? value.actions.map(parseAssistantActionResultAction)
      : [];
    const warnings = Array.isArray(value.warnings)
      ? value.warnings
      : [];

    if (
      value.action !== "supplier_order_pickup" ||
      ![
        "success",
        "no_change",
        "conflict",
        "error",
        "cancelled",
        "expired",
      ].includes(String(value.outcome)) ||
      typeof value.title !== "string" ||
      !value.title.trim() ||
      value.title.length > 120 ||
      typeof value.message !== "string" ||
      !value.message.trim() ||
      value.message.length > 500 ||
      (value.order !== null && !order) ||
      typeof value.idempotentReplay !== "boolean" ||
      (value.refreshWarning !== undefined &&
        typeof value.refreshWarning !== "boolean") ||
      (value.warnings !== undefined &&
        (!Array.isArray(value.warnings) ||
          warnings.length > 4 ||
          warnings.some(
            (warning) =>
              typeof warning !== "string" ||
              !warning.trim() ||
              warning.length > 300,
          ))) ||
      !Array.isArray(value.actions) ||
      actions.length > 4 ||
      actions.some((action) => action === null) ||
      (item !== undefined &&
        (!isRecord(item) ||
          typeof item.id !== "string" ||
          !uuidPattern.test(item.id) ||
          typeof item.displayCode !== "string" ||
          !item.displayCode.trim() ||
          typeof item.description !== "string" ||
          !item.description.trim() ||
          !isNonnegativeInteger(item.previousPickedQuantity) ||
          !isNonnegativeInteger(item.addedPickedQuantity) ||
          !isNonnegativeInteger(item.currentPickedQuantity) ||
          !isNonnegativeInteger(item.remainingPickupQuantity) ||
          (item.automaticStockEntryQuantity !== null &&
            !isNonnegativeInteger(item.automaticStockEntryQuantity)) ||
          (item.automaticStockEntryQuantity !== null &&
            item.automaticStockEntryQuantity !== item.addedPickedQuantity) ||
          item.currentPickedQuantity !==
            item.previousPickedQuantity +
              item.addedPickedQuantity)) ||
      (markAll !== undefined &&
        (!isRecord(markAll) ||
          !isNonnegativeInteger(markAll.changedLines) ||
          !isNonnegativeInteger(markAll.addedPickedQuantity) ||
          (markAll.automaticStockEntryQuantity !== null &&
            !isNonnegativeInteger(markAll.automaticStockEntryQuantity)) ||
          (markAll.automaticStockEntryQuantity !== null &&
            markAll.automaticStockEntryQuantity !==
              markAll.addedPickedQuantity))) ||
      (item !== undefined && markAll !== undefined)
    ) {
      return null;
    }

    return {
      kind: "assistant_action_result",
      action: "supplier_order_pickup",
      outcome:
        value.outcome as AssistantSupplierOrderPickupResultBlock["outcome"],
      title: value.title.trim(),
      message: value.message.trim(),
      order,
      ...(isRecord(item)
        ? {
            item:
              item as AssistantSupplierOrderPickupResultBlock["item"],
          }
        : {}),
      ...(isRecord(markAll)
        ? {
            markAll:
              markAll as AssistantSupplierOrderPickupResultBlock["markAll"],
          }
        : {}),
      idempotentReplay: value.idempotentReplay,
      ...(value.refreshWarning === true
        ? { refreshWarning: true }
        : {}),
      ...(warnings.length > 0
        ? {
            warnings: warnings.map((warning) =>
              String(warning).trim(),
            ),
          }
        : {}),
      actions: actions as Array<
        AssistantActionResultLink | AssistantActionResultPrompt
      >,
    };
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
      const action =
        isRecord(option) && option.action !== undefined
          ? parseAssistantServoModelInventoryAction(option.action)
          : undefined;
      const stockEntrySelection =
        isRecord(option) && option.stockEntrySelection !== undefined
          ? parseAssistantStockEntrySelection(option.stockEntrySelection)
          : undefined;
      const stockOutputSelection =
        isRecord(option) && option.stockOutputSelection !== undefined
          ? parseAssistantStockOutputSelection(option.stockOutputSelection)
          : undefined;
      const configurationAssemblySelection =
        isRecord(option) && option.configurationAssemblySelection !== undefined
          ? parseAssistantConfigurationAssemblySelection(option.configurationAssemblySelection)
          : undefined;
      const configurationDisassemblySelection =
        isRecord(option) && option.configurationDisassemblySelection !== undefined
          ? parseAssistantConfigurationDisassemblySelection(option.configurationDisassemblySelection)
          : undefined;

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
        (option.description !== undefined &&
          (typeof option.description !== "string" ||
            !option.description.trim() ||
            option.description.length > 180)) ||
        (option.contextSupplierOrderId !== undefined &&
          (typeof option.contextSupplierOrderId !== "string" ||
            !uuidPattern.test(option.contextSupplierOrderId))) ||
        (option.contextSupplierOrderItemId !== undefined &&
          (typeof option.contextSupplierOrderItemId !== "string" ||
            !uuidPattern.test(option.contextSupplierOrderItemId))) ||
        (option.contextSupplierOrderItemId !== undefined &&
          option.contextSupplierOrderId === undefined) ||
        (option.action !== undefined && action === null) ||
        (option.stockEntrySelection !== undefined && stockEntrySelection === null) ||
        (option.stockOutputSelection !== undefined && stockOutputSelection === null) ||
        (option.configurationAssemblySelection !== undefined && configurationAssemblySelection === null) ||
        (option.configurationDisassemblySelection !== undefined && configurationDisassemblySelection === null) ||
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
        ...(typeof option.description === "string"
          ? { description: option.description.trim() }
          : {}),
        ...(typeof option.contextSupplierOrderId === "string"
          ? {
              contextSupplierOrderId:
                option.contextSupplierOrderId.toLowerCase(),
            }
          : {}),
        ...(typeof option.contextSupplierOrderItemId === "string"
          ? {
              contextSupplierOrderItemId:
                option.contextSupplierOrderItemId.toLowerCase(),
            }
          : {}),
        ...(action ? { action } : {}),
        ...(stockEntrySelection ? { stockEntrySelection } : {}),
        ...(stockOutputSelection ? { stockOutputSelection } : {}),
        ...(configurationAssemblySelection ? { configurationAssemblySelection } : {}),
        ...(configurationDisassemblySelection ? { configurationDisassemblySelection } : {}),
      };
    });
    const ids = parsedOptions.map((option) => option?.id);
    const selections = parsedOptions.map((option) =>
      option
        ? [
            option.prompt,
            option.contextSupplierOrderId ?? "",
            option.contextSupplierOrderItemId ?? "",
            option.action
              ? JSON.stringify(option.action)
              : "",
            option.stockEntrySelection
              ? JSON.stringify(option.stockEntrySelection)
              : "",
            option.stockOutputSelection
              ? JSON.stringify(option.stockOutputSelection)
              : "",
            option.configurationAssemblySelection
              ? JSON.stringify(option.configurationAssemblySelection)
              : "",
            option.configurationDisassemblySelection
              ? JSON.stringify(option.configurationDisassemblySelection)
              : "",
          ].join(":")
        : null,
    );

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
      new Set(selections).size !== selections.length ||
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

  if (value.kind === "servo_model_inventory_breakdown") {
    return parseServoModelInventoryBreakdown(value);
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
