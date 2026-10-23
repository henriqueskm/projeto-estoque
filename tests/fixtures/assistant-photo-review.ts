import type { AssistantSupplierOrderPhotoPreviewBlock } from "../../lib/assistant-supplier-order-photo-contract.ts";

// Synthetic preview only: never use a customer's photo, order or descriptions.
export function photoReviewFixture(): AssistantSupplierOrderPhotoPreviewBlock {
  const quantities = [2, 1, 3, 1, 4];
  return {
    kind: "supplier_order_photo_preview", state: "NEEDS_REVIEW",
    title: "Pedido precisa de revisão", message: "Alguns dados não puderam ser confirmados com segurança.",
    banner: "Somente prévia — nenhum Pedido foi criado.",
    negotiationNumber: "00900123", orderDate: "2026-10-23", totalQuantity: 11,
    warnings: [], existingOrder: null, fallbackText: "Prévia fictícia; nenhum Pedido foi criado.",
    lines: quantities.map((quantity, index) => ({
      rawCode: `FIX-0${index + 1}`, displayCode: `FIX-0${index + 1}`,
      description: `Produto fictício para teste ${index + 1}`, rawDescription: `Produto fictício para teste ${index + 1}`,
      quantity, resolution: index === 4 ? "NEEDS_REVIEW" : "IDENTIFIED",
      blockingReasons: index === 4 ? ["VISUAL_REVIEW"] : [], descriptionMatch: "MATCH",
      warning: index === 4 ? "Anotação manuscrita sobre a descrição pode alterar o item. Confira o produto e a quantidade." : null,
      consolidatedLineCount: 1, catalogOptions: [],
    })),
  };
}
