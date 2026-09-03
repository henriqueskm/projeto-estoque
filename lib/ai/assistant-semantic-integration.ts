import type { AssistantConversationContext } from "@/lib/assistant-types";
import type { AssistantSemanticQuery } from "@/lib/ai/assistant-semantic-router";
import {
  routeInventoryItemSummaryQuestion,
} from "@/lib/ai/assistant-routing";
import {
  routePurchaseRecommendationQuestion,
  type PurchaseRecommendationRoute,
} from "@/lib/ai/purchase-recommendation-routing";
import {
  routeSupplierOrderQuestion,
  type SupplierOrderRoutingResult,
} from "@/lib/ai/supplier-order-routing";
import { routeSupplierOrderPickupAction } from "@/lib/ai/supplier-order-pickup-routing";
import { routeSupplierOrderStockEntryAction } from "@/lib/ai/supplier-order-stock-entry-routing";

export type AssistantSemanticQueryPlan =
  | {
      kind: "INVENTORY_ITEM";
      queryCode: string;
      metric: Extract<AssistantSemanticQuery, { kind: "INVENTORY_ITEM" }>["metric"];
      source: "DETERMINISTIC" | "SEMANTIC";
    }
  | {
      kind: "PURCHASE_RECOMMENDATION";
      route: PurchaseRecommendationRoute;
      source: "DETERMINISTIC" | "SEMANTIC";
    }
  | {
      kind: "SUPPLIER_ORDERS";
      route: Exclude<SupplierOrderRoutingResult, { kind: "NOT_ORDER_QUERY" }>;
      source: "DETERMINISTIC" | "SEMANTIC";
    }
  | {
      kind: "SEMANTIC";
      query: Exclude<AssistantSemanticQuery, {
        kind: "INVENTORY_ITEM" | "PURCHASE_RECOMMENDATION" | "SUPPLIER_ORDERS";
      }>;
    };

function semanticSupplierOrderFallbackQuestion(
  focus: Extract<AssistantSemanticQuery, { kind: "SUPPLIER_ORDERS" }>["focus"],
) {
  if (focus === "WAITING_PICKUP") return "Quais Pedidos têm retirada pendente?";
  if (focus === "WAITING_STOCK") return "Quais Pedidos têm entrada pendente no estoque?";
  return "Mostre os Pedidos em andamento.";
}

export function resolveAssistantSemanticQueryPlan(input: {
  message: string;
  semanticQuery: AssistantSemanticQuery;
  lastItemQuery: string | null;
  lastSupplierOrderId: string | null;
  lastSupplierOrderCatalogCode: string | null;
  now?: Date;
}): AssistantSemanticQueryPlan {
  const {
    message,
    semanticQuery,
    lastItemQuery,
    lastSupplierOrderId,
    lastSupplierOrderCatalogCode,
  } = input;

  if (semanticQuery.kind === "INVENTORY_ITEM") {
    const deterministic = routeInventoryItemSummaryQuestion(message, lastItemQuery);
    return deterministic
      ? { kind: "INVENTORY_ITEM", ...deterministic, source: "DETERMINISTIC" }
      : {
          kind: "INVENTORY_ITEM",
          queryCode: semanticQuery.targetQuery,
          metric: semanticQuery.metric,
          source: "SEMANTIC",
        };
  }

  if (semanticQuery.kind === "PURCHASE_RECOMMENDATION") {
    const deterministic = routePurchaseRecommendationQuestion(message);
    return {
      kind: "PURCHASE_RECOMMENDATION",
      route: deterministic ?? {
        kind: "QUERY",
        mode: "buy_now",
        queryCode: null,
        codeIntent: null,
      },
      source: deterministic ? "DETERMINISTIC" : "SEMANTIC",
    };
  }

  if (semanticQuery.kind === "SUPPLIER_ORDERS") {
    const now = input.now ?? new Date();
    const deterministic = routeSupplierOrderQuestion(
      message,
      lastSupplierOrderId,
      now,
      lastSupplierOrderCatalogCode,
    );
    if (
      deterministic.kind === "ORDER_QUERY" ||
      (deterministic.kind === "NEEDS_ORDER_CONTEXT" && semanticQuery.focus === "ALL")
    ) {
      return { kind: "SUPPLIER_ORDERS", route: deterministic, source: "DETERMINISTIC" };
    }

    const semanticFallback = routeSupplierOrderQuestion(
      semanticSupplierOrderFallbackQuestion(semanticQuery.focus),
      lastSupplierOrderId,
      now,
      lastSupplierOrderCatalogCode,
    );
    if (semanticFallback.kind === "NOT_ORDER_QUERY") {
      return {
        kind: "SUPPLIER_ORDERS",
        route: {
          kind: "NEEDS_ORDER_CONTEXT",
          message: "Não consegui identificar com segurança quais Pedidos você deseja consultar.",
        },
        source: "SEMANTIC",
      };
    }
    return { kind: "SUPPLIER_ORDERS", route: semanticFallback, source: "SEMANTIC" };
  }

  return { kind: "SEMANTIC", query: semanticQuery };
}

export type AssistantSemanticManualActionDisposition =
  | "ALLOW_MANUAL_PREVIEW"
  | "DEFER_TO_SUPPLIER_ORDER_PIPELINE"
  | "CLARIFY_SUPPLIER_ORDER_SCOPE";

function hasExplicitSupplierOrderScope(
  message: string,
  conversationContext: AssistantConversationContext,
) {
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  return conversationContext.topic === "SUPPLIER_ORDER" ||
    /\bpedidos?\b|\bnegociac(?:ao|oes)\b/.test(normalized);
}

export function resolveAssistantSemanticManualActionDisposition(input: {
  message: string;
  conversationContext: AssistantConversationContext;
}): AssistantSemanticManualActionDisposition {
  if (!hasExplicitSupplierOrderScope(input.message, input.conversationContext)) {
    return "ALLOW_MANUAL_PREVIEW";
  }

  const pickupRoute = routeSupplierOrderPickupAction(input.message);
  const stockEntryRoute = routeSupplierOrderStockEntryAction(input.message);
  if (
    pickupRoute.kind !== "NOT_PICKUP_ACTION" ||
    stockEntryRoute.kind !== "NOT_SUPPLIER_ORDER_STOCK_ENTRY"
  ) {
    return "DEFER_TO_SUPPLIER_ORDER_PIPELINE";
  }

  return "CLARIFY_SUPPLIER_ORDER_SCOPE";
}
