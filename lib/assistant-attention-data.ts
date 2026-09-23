import "server-only";

import {
  buildAssistantAttentionSummary,
  type AssistantAttentionPendingStockSnapshot,
  type AssistantAttentionSummary,
} from "@/lib/assistant-attention";
import { loadPurchaseRecommendations } from "@/lib/purchase-recommendations";
import { loadCurrentSafisaPickupAlerts } from "@/lib/safisa-pickup-alerts";
import { createClient } from "@/lib/supabase/server";
import { fetchAllSupabaseRows } from "@/lib/supabase-read-pagination";

type PendingStockRow = {
  id: string;
  negotiation_number: string;
  order_date: string;
  waiting_stock_quantity: number;
  is_active_order: boolean;
};

export function isAssistantPendingStockOrderEligible(
  row: Pick<PendingStockRow, "waiting_stock_quantity" | "is_active_order">,
) {
  return (
    row.is_active_order === true &&
    Number.isSafeInteger(row.waiting_stock_quantity) &&
    row.waiting_stock_quantity > 0
  );
}

export type AssistantAttentionResult =
  | { data: AssistantAttentionSummary; error: null }
  | { data: null; error: string };

export type AssistantAttentionDataDependencies = {
  loadPurchaseRecommendations: typeof loadPurchaseRecommendations;
  loadSafisaPickupAlerts: typeof loadCurrentSafisaPickupAlerts;
  loadPendingStockOrders: () => Promise<
    AssistantAttentionPendingStockSnapshot[] | null
  >;
  now: () => Date;
};

async function loadPendingStockOrders(): Promise<
  AssistantAttentionPendingStockSnapshot[] | null
> {
  const supabase = await createClient();
  const result = await fetchAllSupabaseRows<PendingStockRow>(
    (from, to) => supabase
      .from("supplier_order_summaries")
      .select("id, negotiation_number, order_date, waiting_stock_quantity, is_active_order")
      .gt("waiting_stock_quantity", 0)
      .eq("is_active_order", true)
      .order("waiting_stock_quantity", { ascending: false })
      .order("order_date", { ascending: false })
      .order("id")
      .range(from, to),
    (row) => row.id,
  );

  if (result.error) return null;

  const rows = (result.data ?? []) as PendingStockRow[];
  if (
    rows.some(
      (row) =>
        typeof row.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id) ||
        typeof row.negotiation_number !== "string" ||
        !/^\d{1,120}$/.test(row.negotiation_number) ||
        typeof row.order_date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.order_date) ||
        !isAssistantPendingStockOrderEligible(row),
    )
  ) {
    return null;
  }

  return rows.map((row) => ({
    supplierOrderId: row.id,
    negotiationNumber: row.negotiation_number,
    orderDate: row.order_date,
    waitingStockQuantity: row.waiting_stock_quantity,
  }));
}
const defaultDependencies: AssistantAttentionDataDependencies = {
  loadPurchaseRecommendations,
  loadSafisaPickupAlerts: loadCurrentSafisaPickupAlerts,
  loadPendingStockOrders,
  now: () => new Date(),
};

export async function loadAssistantAttention(
  dependencies: AssistantAttentionDataDependencies = defaultDependencies,
): Promise<AssistantAttentionResult> {
  try {
    const [purchaseResult, pickupResult, pendingStockOrders] =
      await Promise.all([
        dependencies.loadPurchaseRecommendations(),
        dependencies.loadSafisaPickupAlerts(),
        dependencies.loadPendingStockOrders(),
      ]);

    if (
      !purchaseResult.data ||
      pickupResult.error ||
      !pendingStockOrders
    ) {
      return {
        data: null,
        error: "Não foi possível conferir as pendências agora.",
      };
    }

    return {
      data: buildAssistantAttentionSummary(
        {
          purchaseRecommendations:
            purchaseResult.data.allItems.map((item) => ({
              targetKind: item.targetKind,
              targetId: item.targetId,
              primaryCode: item.primaryCode,
              description: item.description,
              currentStock: item.currentStock,
              minimumStock: item.minimumStock,
              pendingPurchaseQuantity: item.pendingPurchaseQuantity,
              remainingGap: item.remainingGap,
            })),
          readyPickupOrders: pickupResult.data.alerts.map((alert) => ({
            supplierOrderId: alert.supplierOrderId,
            negotiationNumber: alert.negotiationNumber,
            readyWaitingPickupQuantity:
              alert.readyWaitingPickupQuantity,
            isActiveOrder: alert.isActiveOrder,
            isInHistory: alert.isInHistory,
          })),
          pendingStockOrders,
        },
        dependencies.now(),
      ),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível conferir as pendências agora.",
    };
  }
}
