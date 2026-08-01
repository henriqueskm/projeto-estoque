import type {
  AssistantManualStockEntryConfirmationResult,
  AssistantSupplierOrderStockEntryConfirmationResult,
} from "@/lib/assistant-types";
import { addManualStockEntryRefreshWarning } from "@/lib/assistant-manual-stock-entry";
import { addSupplierOrderStockEntryRefreshWarning } from "@/lib/assistant-supplier-order-stock-entry";
import {
  handleStockEntryActionRequest,
} from "@/lib/ai/stock-entry-http-contract";

export async function handleSupplierOrderStockEntryPost(
  request: Request,
  dependencies: { confirm: (token: string) => Promise<AssistantSupplierOrderStockEntryConfirmationResult>; revalidate: () => void | Promise<void> },
) {
  return handleStockEntryActionRequest(request, {
    ...dependencies,
    isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: addSupplierOrderStockEntryRefreshWarning,
    fallback: (): AssistantSupplierOrderStockEntryConfirmationResult => ({ block: { kind: "supplier_order_stock_entry_result", action: "supplier_order_stock_entry", outcome: "error",
      title: "Resultado não confirmado", message: "Não foi possível confirmar a entrada. Confira o Pedido antes de tentar novamente.",
      order: null, lines: [], linesProcessed: 0, totalQuantity: 0, occurredAt: null, reference: null,
      idempotentReplay: false, actions: [] }, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null }),
  });
}

export async function handleManualStockEntryPost(
  request: Request,
  dependencies: { confirm: (token: string) => Promise<AssistantManualStockEntryConfirmationResult>; revalidate: () => void | Promise<void> },
) {
  return handleStockEntryActionRequest(request, {
    ...dependencies,
    isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: addManualStockEntryRefreshWarning,
    fallback: (): AssistantManualStockEntryConfirmationResult => ({ block: { kind: "manual_stock_entry_result", action: "manual_stock_entry", outcome: "error",
      title: "Resultado não confirmado", message: "Não foi possível confirmar a entrada manual. Confira o Estoque antes de tentar novamente.",
      lines: [], linesProcessed: 0, totalQuantity: 0, occurredAt: null, reference: null,
      idempotentReplay: false, actions: [] }, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null }),
  });
}
