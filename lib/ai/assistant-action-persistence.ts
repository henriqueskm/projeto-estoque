import type {
  AssistantManualStockEntryPreviewBlock,
  AssistantManualStockOutputPreviewBlock,
  AssistantSupplierOrderPickupPreviewBlock,
  AssistantSupplierOrderStockEntryPreviewBlock,
} from "@/lib/assistant-types";

export function expireSupplierOrderPickupPreview(
  block: AssistantSupplierOrderPickupPreviewBlock,
): AssistantSupplierOrderPickupPreviewBlock {
  return {
    ...block,
    state: "expired",
    title: "Prévia expirada",
    message:
      "Solicite novamente a retirada para confirmar com os valores atuais.",
    proposalToken: null,
    expiresAt: null,
  };
}

export function expireStockEntryPreview<T extends
  | AssistantSupplierOrderStockEntryPreviewBlock
  | AssistantManualStockEntryPreviewBlock
  | AssistantManualStockOutputPreviewBlock>(block: T): T {
  return {
    ...block,
    state: "expired",
    title: "Prévia expirada",
    message: block.action === "manual_stock_output"
      ? "Solicite novamente a saída para confirmar com os valores atuais."
      : "Solicite novamente a entrada para confirmar com os valores atuais.",
    proposalToken: null,
    expiresAt: null,
  } as T;
}
