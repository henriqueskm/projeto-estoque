import type {
  AssistantSupplierOrderPickupConfirmationResult,
  AssistantSupplierOrderPickupResultBlock,
} from "@/lib/assistant-types";

export const supplierOrderPickupRefreshWarning =
  "A retirada foi registrada, mas não foi possível atualizar todos os valores na tela. Abra o Pedido para consultar o estado atual.";

export function addSupplierOrderPickupRefreshWarning(
  result: AssistantSupplierOrderPickupConfirmationResult,
): AssistantSupplierOrderPickupConfirmationResult {
  if (
    result.block.outcome !== "success" &&
    result.block.outcome !== "no_change"
  ) {
    return result;
  }

  const warnings = Array.from(
    new Set([
      ...(result.block.warnings ?? []),
      supplierOrderPickupRefreshWarning,
    ]),
  );

  return {
    ...result,
    block: {
      ...result.block,
      refreshWarning: true,
      warnings,
    } satisfies AssistantSupplierOrderPickupResultBlock,
  };
}
