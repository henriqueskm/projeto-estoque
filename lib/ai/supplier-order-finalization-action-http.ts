import type { AssistantSupplierOrderFinalizationConfirmationResult } from "@/lib/assistant-types";
import { addSupplierOrderFinalizationRefreshWarning } from "@/lib/assistant-supplier-order-finalization";
import { handleStockEntryActionRequest } from "@/lib/ai/stock-entry-http-contract";

export async function handleSupplierOrderFinalizationPost(
  request: Request,
  dependencies: {
    confirm: (token: string) => Promise<AssistantSupplierOrderFinalizationConfirmationResult>;
    revalidate: () => void | Promise<void>;
  },
) {
  return handleStockEntryActionRequest(request, {
    ...dependencies,
    isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: addSupplierOrderFinalizationRefreshWarning,
    fallback: (): AssistantSupplierOrderFinalizationConfirmationResult => ({
      block: { kind: "supplier_order_finalization_result", action: "supplier_order_finalization", outcome: "error",
        title: "Resultado não confirmado", message: "Não foi possível confirmar a finalização. Confira o Pedido antes de tentar novamente.",
        order: null, occurredAt: null, idempotentReplay: false, actions: [] },
      contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null,
    }),
  });
}
