import "server-only";

import { AssistantDataError } from "@/lib/assistant-data";
import type {
  AssistantClarificationBlock,
  AssistantPurchaseRecommendationBlock,
} from "@/lib/assistant-types";
import type { PurchaseRecommendationRoute } from "@/lib/ai/purchase-recommendation-routing";
import {
  findPurchaseRecommendationItemsByCode,
  loadPurchaseRecommendations,
} from "@/lib/purchase-recommendations";

const assistantItemLimit = 10;

export function createPurchaseRecommendationClarificationBlock(
  queryCode: string,
): AssistantClarificationBlock {
  return {
    kind: "assistant_clarification",
    title: `O que você deseja consultar sobre o Cód. ${queryCode}?`,
    message: "Escolha uma consulta somente leitura.",
    options: [
      {
        id: "purchase-recommendation",
        label: "Ver recomendação de compra",
        prompt: `Quanto preciso comprar do ${queryCode}?`,
        category: "replenishment",
      },
      {
        id: "purchase-orders",
        label: "Ver nos Pedidos",
        prompt: `O ${queryCode} já está em algum Pedido?`,
        category: "supplier_orders",
      },
      {
        id: "purchase-inventory",
        label: "Ver saldo no Estoque",
        prompt: `Quantos ${queryCode} tenho?`,
        category: "inventory",
      },
    ],
    fallbackText: `Posso mostrar a recomendação de compra do Cód. ${queryCode}, procurar o código nos Pedidos ou consultar seu saldo no Estoque.`,
  };
}

function titleForMode(
  mode: Exclude<PurchaseRecommendationRoute, { kind: "CLARIFICATION" }>["mode"],
) {
  switch (mode) {
    case "buy_now":
      return "Comprar agora";
    case "already_ordered":
      return "Itens já comprados";
    case "missing_minimum":
      return "Itens sem estoque mínimo";
    case "all":
      return "Lista recomendada de compra";
    case "code":
      return "Recomendação por código";
  }
}

export async function consultAssistantPurchaseRecommendations(
  route: Extract<PurchaseRecommendationRoute, { kind: "QUERY" }>,
): Promise<AssistantPurchaseRecommendationBlock> {
  const result = await loadPurchaseRecommendations();

  if (!result.data) {
    throw new AssistantDataError();
  }

  const data = result.data;
  const queryItems =
    route.mode === "code" && route.queryCode
      ? findPurchaseRecommendationItemsByCode(data, route.queryCode)
      : route.mode === "buy_now"
        ? data.buyNow
        : route.mode === "already_ordered"
          ? data.alreadyOrdered
          : route.mode === "missing_minimum"
            ? data.missingMinimum
            : [
                ...data.buyNow,
                ...data.alreadyOrdered,
                ...data.missingMinimum,
              ];
  const queryStatus =
    route.mode !== "code"
      ? null
      : queryItems.length === 0
        ? "NOT_FOUND"
        : queryItems.length === 1
          ? "FOUND"
          : "AMBIGUOUS";
  const items = queryItems.slice(0, assistantItemLimit).map((item) => ({
    ...item,
    relatedOrders: item.relatedOrders.slice(0, 10),
  }));
  const remainingCount = Math.max(queryItems.length - items.length, 0);
  const singleItem =
    route.mode === "code" && queryStatus === "FOUND"
      ? queryItems[0]
      : null;
  const primaryText =
    route.mode === "code"
      ? queryStatus === "NOT_FOUND"
        ? `Não encontrei nenhum item com o código ${route.queryCode}.`
        : queryStatus === "AMBIGUOUS"
          ? `O código ${route.queryCode} corresponde a mais de um item. Confira as opções.`
          : route.codeIntent === "pending"
            ? singleItem && singleItem.pendingPurchaseQuantity > 0
              ? `O Cód. ${singleItem.primaryCode} possui ${singleItem.pendingPurchaseQuantity} ${singleItem.pendingPurchaseQuantity === 1 ? "unidade" : "unidades"} em compra pendente.`
              : `O Cód. ${singleItem?.primaryCode} não possui compra pendente em Pedidos.`
            : singleItem?.group === "BUY_NOW"
            ? `Recomendação: comprar ${singleItem.recommendedQuantity} ${singleItem.recommendedQuantity === 1 ? "unidade" : "unidades"}.`
            : singleItem?.group === "ALREADY_ORDERED"
              ? `O Cód. ${singleItem.primaryCode} já possui compra pendente e não entra na lista de compra.`
              : singleItem?.group === "MISSING_MINIMUM"
                ? "Não é possível calcular uma compra recomendada porque o estoque mínimo não está definido."
                : `O Cód. ${singleItem?.primaryCode} não precisa de reposição neste momento.`
      : route.mode === "buy_now" && queryItems.length === 0
        ? "Nenhuma compra recomendada agora."
        : `${queryItems.length} ${
            queryItems.length === 1 ? "item encontrado" : "itens encontrados"
          }.`;
  const fallbackText = [
    primaryText,
    ...items.map((item) => {
      if (item.group === "BUY_NOW") {
        return `Cód. ${item.primaryCode}: comprar ${item.recommendedQuantity} unidade${item.recommendedQuantity === 1 ? "" : "s"}.`;
      }

      if (item.group === "ALREADY_ORDERED") {
        return `Cód. ${item.primaryCode}: ${item.pendingPurchaseQuantity} unidade${item.pendingPurchaseQuantity === 1 ? "" : "s"} em compra pendente; saldo projetado ${item.projectedStock}.`;
      }

      if (item.group === "MISSING_MINIMUM") {
        return `Cód. ${item.primaryCode}: estoque mínimo não definido.`;
      }

      return `Cód. ${item.primaryCode}: sem necessidade de reposição agora.`;
    }),
    ...(remainingCount > 0
      ? [`Mostrando ${items.length} de ${queryItems.length} itens.`]
      : []),
  ].join("\n");

  return {
    kind: "purchase_recommendation_list",
    title: titleForMode(route.mode),
    subtitle:
      "Cálculo baseado no estoque atual, no mínimo definido e nas compras pendentes em Pedidos.",
    mode: route.mode === "code" ? "all" : route.mode,
    queryCode: route.queryCode,
    queryStatus,
    primaryText,
    summary: data.summary,
    items,
    totalCount: queryItems.length,
    remainingCount,
    listHref: "/estoque?view=purchase-recommendations",
    fallbackText,
  };
}
