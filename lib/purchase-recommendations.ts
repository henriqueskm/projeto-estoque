import "server-only";

import {
  buildPurchaseRecommendations,
  findPurchaseRecommendationItemsByCode,
} from "@/lib/purchase-recommendation-domain";
import type {
  PurchaseRecommendationCatalogTarget,
  PurchaseRecommendationPendingLine,
  PurchaseRecommendationsResult,
} from "@/lib/purchase-recommendation-types";
import {
  mapSupplierOrderItem,
  mapSupplierOrderSummary,
  supplierOrderItemSelect,
  supplierOrderSummarySelect,
  type SupplierOrderItemRow,
  type SupplierOrderSummaryRow,
} from "@/lib/supplier-orders-data";
import { createClient } from "@/lib/supabase/server";

type ItemRow = {
  id: string;
  code: string;
  description: string;
  item_type:
    | "SERVO"
    | "INSTALLATION_KIT"
    | "REPAIR_KIT"
    | "LOOSE_PART";
  minimum_stock: number;
  is_active: boolean;
};

type StockBalanceRow = {
  item_id: string;
  quantity: number;
};

type ConfigurationRow = {
  id: string;
  description: string | null;
  servo_id: string;
  installation_kit_id: string;
  minimum_stock: number;
  is_active: boolean;
};

type ConfigurationCodeRow = {
  code: string;
  configuration_id: string;
  is_active: boolean;
};

type ConfigurationBalanceRow = {
  configuration_id: string;
  quantity: number;
};

const physicalTypeLabels = {
  SERVO: "Servoembreagem",
  INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Jogo de reparo",
  LOOSE_PART: "Peça avulsa",
} as const;

function compareCodes(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

export { findPurchaseRecommendationItemsByCode };

export async function loadPurchaseRecommendations(): Promise<PurchaseRecommendationsResult> {
  try {
    const supabase = await createClient();
    const [
      itemsResult,
      stockBalancesResult,
      configurationsResult,
      configurationCodesResult,
      configurationBalancesResult,
      orderSummariesResult,
      orderItemsResult,
    ] = await Promise.all([
      supabase
        .from("items")
        .select("id, code, description, item_type, minimum_stock, is_active"),
      supabase.from("stock_balances").select("item_id, quantity"),
      supabase
        .from("commercial_configurations")
        .select(
          "id, description, servo_id, installation_kit_id, minimum_stock, is_active",
        ),
      supabase
        .from("commercial_configuration_codes")
        .select("code, configuration_id, is_active"),
      supabase
        .from("configuration_stock_balances")
        .select("configuration_id, quantity"),
      supabase
        .from("supplier_order_summaries")
        .select(supplierOrderSummarySelect),
      supabase
        .from("supplier_order_item_details")
        .select(supplierOrderItemSelect)
        .or(
          "waiting_pickup_quantity.gt.0,waiting_stock_quantity.gt.0",
        ),
    ]);
    const readError = [
      itemsResult.error,
      stockBalancesResult.error,
      configurationsResult.error,
      configurationCodesResult.error,
      configurationBalancesResult.error,
      orderSummariesResult.error,
      orderItemsResult.error,
    ].find(Boolean);

    if (readError) {
      return {
        data: null,
        error: "Não foi possível calcular a lista recomendada agora.",
      };
    }

    const items = (itemsResult.data ?? []) as ItemRow[];
    const stockBalances = (stockBalancesResult.data ??
      []) as StockBalanceRow[];
    const configurations = (configurationsResult.data ??
      []) as ConfigurationRow[];
    const configurationCodes = (configurationCodesResult.data ??
      []) as ConfigurationCodeRow[];
    const configurationBalances = (configurationBalancesResult.data ??
      []) as ConfigurationBalanceRow[];
    const summaryRows = (orderSummariesResult.data ??
      []) as SupplierOrderSummaryRow[];
    const itemRows = (orderItemsResult.data ?? []) as SupplierOrderItemRow[];
    const orderSummaries = summaryRows
      .map(mapSupplierOrderSummary)
      .filter((summary) => summary !== null);
    const orderItems = itemRows
      .map(mapSupplierOrderItem)
      .filter((item) => item !== null);

    if (
      orderSummaries.length !== summaryRows.length ||
      orderItems.length !== itemRows.length
    ) {
      return {
        data: null,
        error: "Não foi possível validar os dados de Pedidos agora.",
      };
    }

    const itemById = new Map(items.map((item) => [item.id, item]));
    const activeItems = items.filter((item) => item.is_active);
    // stock_balances is the official separated balance. Mounted boxes remain
    // their own recommendation target and are never dismantled virtually.
    const looseStockByItemId = new Map(
      stockBalances.map((balance) => [
        balance.item_id,
        balance.quantity,
      ]),
    );
    const activeCodesByConfigurationId = new Map<string, string[]>();

    configurationCodes
      .filter((code) => code.is_active)
      .forEach((code) => {
        const aliases =
          activeCodesByConfigurationId.get(code.configuration_id) ?? [];
        aliases.push(code.code);
        activeCodesByConfigurationId.set(code.configuration_id, aliases);
      });

    const catalog: PurchaseRecommendationCatalogTarget[] = activeItems.map(
      (item) => ({
        targetKind: "item",
        targetId: item.id,
        primaryCode: item.code,
        aliases: [],
        itemType: item.item_type,
        typeLabel: physicalTypeLabels[item.item_type],
        description: item.description,
        currentStock: looseStockByItemId.get(item.id) ?? 0,
        minimumStock: item.minimum_stock,
        inventoryHref: `/estoque?item=${item.id}`,
      }),
    );
    const assembledByConfigurationId = new Map(
      configurationBalances.map((balance) => [
        balance.configuration_id,
        balance.quantity,
      ]),
    );

    configurations.forEach((configuration) => {
      const servo = itemById.get(configuration.servo_id);
      const installationKit = itemById.get(
        configuration.installation_kit_id,
      );
      const aliases = (
        activeCodesByConfigurationId.get(configuration.id) ?? []
      ).sort(compareCodes);

      if (
        !configuration.is_active ||
        servo?.is_active !== true ||
        servo.item_type !== "SERVO" ||
        installationKit?.is_active !== true ||
        installationKit.item_type !== "INSTALLATION_KIT" ||
        aliases.length === 0
      ) {
        return;
      }

      catalog.push({
        targetKind: "commercial_configuration",
        targetId: configuration.id,
        primaryCode: aliases[0],
        aliases: aliases.slice(1),
        itemType: "COMPLETE_BOX",
        typeLabel: "Caixa completa",
        description:
          configuration.description?.trim() ||
          `${servo.description} + ${installationKit.code}`,
        currentStock:
          assembledByConfigurationId.get(configuration.id) ?? 0,
        minimumStock: configuration.minimum_stock,
        inventoryHref: `/estoque?configuration=${configuration.id}`,
      });
    });

    const summaryById = new Map(
      orderSummaries.map((summary) => [summary.id, summary]),
    );
    const pendingLines: PurchaseRecommendationPendingLine[] = [];

    for (const item of orderItems) {
      const pendingQuantity =
        item.waitingPickupQuantity + item.waitingStockQuantity;

      if (pendingQuantity === 0) {
        continue;
      }

      const summary = summaryById.get(item.supplierOrderId);

      if (!summary) {
        return {
          data: null,
          error: "Não foi possível validar os Pedidos relacionados agora.",
        };
      }

      if (item.itemId) {
        pendingLines.push({
          targetKind: "item",
          targetId: item.itemId,
          orderId: summary.id,
          negotiationNumber: summary.negotiationNumber,
          orderDate: summary.orderDate,
          status: summary.status,
          closureKind: summary.closureKind,
          isInHistory: summary.isInHistory,
          codeSnapshot: item.codeSnapshot,
          waitingPickupQuantity: item.waitingPickupQuantity,
          waitingStockQuantity: item.waitingStockQuantity,
        });
      } else if (item.commercialConfigurationId) {
        pendingLines.push({
          targetKind: "commercial_configuration",
          targetId: item.commercialConfigurationId,
          orderId: summary.id,
          negotiationNumber: summary.negotiationNumber,
          orderDate: summary.orderDate,
          status: summary.status,
          closureKind: summary.closureKind,
          isInHistory: summary.isInHistory,
          codeSnapshot:
            item.commercialCodeSnapshot ?? item.codeSnapshot,
          waitingPickupQuantity: item.waitingPickupQuantity,
          waitingStockQuantity: item.waitingStockQuantity,
        });
      }
    }

    return {
      data: buildPurchaseRecommendations(catalog, pendingLines),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível calcular a lista recomendada agora.",
    };
  }
}
