import type { AssistantManualStockOutputConfirmationResult } from "@/lib/assistant-types";
import {
  addManualStockOutputRefreshWarning,
} from "@/lib/assistant-manual-stock-output";
import { handleStockEntryActionRequest } from "@/lib/ai/stock-entry-http-contract";

export async function handleManualStockOutputPost(
  request: Request,
  dependencies: {
    confirm: (token: string) => Promise<AssistantManualStockOutputConfirmationResult>;
    revalidate: () => void | Promise<void>;
  },
) {
  return handleStockEntryActionRequest(request, {
    ...dependencies,
    isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: addManualStockOutputRefreshWarning,
    fallback: (): AssistantManualStockOutputConfirmationResult => ({
      block: { kind: "manual_stock_output_result", action: "manual_stock_output", outcome: "error",
        title: "Resultado não confirmado", message: "Não foi possível confirmar a saída manual. Confira o Estoque antes de tentar novamente.",
        lines: [], linesProcessed: 0, totalQuantity: 0, totalAutoAssemblyQuantity: 0, occurredAt: null,
        reference: null, idempotentReplay: false, actions: [] },
      contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null,
    }),
  });
}
