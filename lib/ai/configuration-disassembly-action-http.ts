import type { AssistantConfigurationDisassemblyConfirmationResult } from "@/lib/assistant-types";
import { addConfigurationDisassemblyRefreshWarning } from "@/lib/assistant-configuration-disassembly";
import { handleStockEntryActionRequest } from "@/lib/ai/stock-entry-http-contract";

export async function handleConfigurationDisassemblyPost(
  request: Request,
  dependencies: {
    confirm: (token: string) => Promise<AssistantConfigurationDisassemblyConfirmationResult>;
    revalidate: () => void | Promise<void>;
  },
) {
  return handleStockEntryActionRequest(request, {
    ...dependencies,
    isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: addConfigurationDisassemblyRefreshWarning,
    fallback: (): AssistantConfigurationDisassemblyConfirmationResult => ({
      block: {
        kind: "configuration_disassembly_result", action: "configuration_disassembly", outcome: "error",
        title: "Resultado não confirmado", message: "Não foi possível confirmar a desmontagem. Confira o Estoque antes de tentar novamente.",
        target: null, quantity: 0, mountedStockBefore: null, mountedStockAfter: null,
        servoStockBefore: null, servoStockAfter: null, installationKitStockBefore: null,
        installationKitStockAfter: null, occurredAt: null, reference: null, idempotentReplay: false, actions: [],
      },
      contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null,
    }),
  });
}
