import type {
  AssistantSupplierOrderPhotoPreviewBlock,
  AssistantSupplierOrderPhotoPreviewLine,
} from "./assistant-supplier-order-photo-contract.ts";

export type SupplierOrderPhotoResolvedCode = {
  code: string;
  description: string;
};

function recalculate(block: AssistantSupplierOrderPhotoPreviewBlock) {
  if (block.existingOrder) return block;
  const completeHeader = Boolean(
    block.negotiationNumber && /^[0-9]{1,120}$/.test(block.negotiationNumber) && block.orderDate,
  );
  const ready = completeHeader && block.lines.length > 0 &&
    block.lines.every((line) => line.resolution === "IDENTIFIED");
  return {
    ...block,
    state: ready ? "READY_FOR_REVIEW" as const : "NEEDS_REVIEW" as const,
    title: ready ? "Pedido identificado" : "Pedido precisa de revisão",
    message: ready
      ? "Confira os dados extraídos e validados no catálogo oficial."
      : "Alguns dados não puderam ser confirmados com segurança.",
    fallbackText: ready
      ? `Pedido ${block.negotiationNumber} identificado em prévia. Nenhum Pedido foi criado.`
      : "A foto foi analisada e precisa de revisão. Nenhum Pedido foi criado.",
  };
}

export function updateSupplierOrderPhotoPreviewLine(
  block: AssistantSupplierOrderPhotoPreviewBlock,
  lineIndex: number,
  result: SupplierOrderPhotoResolvedCode | null,
): AssistantSupplierOrderPhotoPreviewBlock {
  if (!block.lines[lineIndex]) return block;
  const lines = block.lines.map((line, index): AssistantSupplierOrderPhotoPreviewLine => {
    if (index !== lineIndex) return line;
    const remaining = line.blockingReasons.filter((reason) =>
      !["CODE_NOT_FOUND", "CODE_MISSING", "CODE_AMBIGUOUS", "CODE_UNCERTAIN", "DESCRIPTION_CONFLICT"].includes(reason),
    );
    if (!result) {
      return {
        ...line,
        displayCode: null,
        description: null,
        blockingReasons: ["CODE_NOT_FOUND", ...remaining],
        resolution: "NEEDS_REVIEW",
        descriptionMatch: "UNCERTAIN",
        warning: "Código não cadastrado.",
        catalogOptions: [],
      };
    }
    return {
      ...line,
      displayCode: result.code,
      description: result.description,
      blockingReasons: remaining,
      resolution: remaining.length === 0 ? "IDENTIFIED" : "NEEDS_REVIEW",
      descriptionMatch: "MATCH",
      warning: remaining.includes("QUANTITY_MISSING")
        ? "A identidade foi confirmada, mas a quantidade ainda precisa de revisão."
        : null,
      catalogOptions: [],
    };
  });
  return recalculate({ ...block, lines });
}
