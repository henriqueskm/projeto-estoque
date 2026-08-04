import type { AssistantConfigurationAssemblyConfirmationResult } from "@/lib/assistant-types";
import { addConfigurationAssemblyRefreshWarning } from "@/lib/assistant-configuration-assembly";
import { handleStockEntryActionRequest } from "@/lib/ai/stock-entry-http-contract";

export async function handleConfigurationAssemblyPost(
  request: Request,
  dependencies: {
    confirm: (token: string) => Promise<AssistantConfigurationAssemblyConfirmationResult>;
    revalidate: () => void | Promise<void>;
  },
) {
  return handleStockEntryActionRequest(request, {
    ...dependencies,
    isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: addConfigurationAssemblyRefreshWarning,
    fallback: (): AssistantConfigurationAssemblyConfirmationResult => ({
      block: { kind: "configuration_assembly_result", action: "configuration_assembly", outcome: "error",
        title: "Resultado não confirmado", message: "Não foi possível confirmar a montagem. Confira o Estoque antes de tentar novamente.",
        target: null, quantity: 0, mountedStockBefore: null, mountedStockAfter: null, servoStockBefore: null,
        servoStockAfter: null, installationKitStockBefore: null, installationKitStockAfter: null,
        occurredAt: null, reference: null, idempotentReplay: false, actions: [] },
      contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null,
    }),
  });
}
