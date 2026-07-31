import type { AssistantSupplierOrderPickupPreviewBlock } from "@/lib/assistant-types";

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
