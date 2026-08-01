import type {
  AssistantManualStockEntryPreviewBlock,
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
  | AssistantManualStockEntryPreviewBlock>(block: T): T {
  return {
    ...block,
    state: "expired",
    title: "Prévia expirada",
    message: "Solicite novamente a entrada para confirmar com os valores atuais.",
    proposalToken: null,
    expiresAt: null,
  } as T;
}
