import type {
  AssistantSupplierOrderPhotoPreviewBlock,
  AssistantSupplierOrderPhotoPreviewLine,
} from "./assistant-supplier-order-photo-contract.ts";
import { supplierOrderPhotoMaxQuantity } from "./assistant-supplier-order-photo-contract";
import { isRealSupplierOrderPhotoDate } from "./assistant-supplier-order-photo-create-contract";

export type SupplierOrderPhotoResolvedCode = {
  code: string;
  description: string;
};

export function supplierOrderPhotoPreviewIsEditable(block: AssistantSupplierOrderPhotoPreviewBlock) {
  return !block.existingOrder && ["NEEDS_REVIEW", "READY_FOR_REVIEW"].includes(block.state);
}

export function supplierOrderPhotoQuantityIsValid(quantity: unknown): quantity is number {
  return typeof quantity === "number" && Number.isInteger(quantity) &&
    quantity > 0 && quantity <= supplierOrderPhotoMaxQuantity;
}

function lineIsIdentified(line: AssistantSupplierOrderPhotoPreviewLine) {
  return line.blockingReasons.length === 0 && Boolean(line.displayCode?.trim() && line.description?.trim()) &&
    line.descriptionMatch !== "CONFLICT" && supplierOrderPhotoQuantityIsValid(line.quantity);
}

function recalculate(block: AssistantSupplierOrderPhotoPreviewBlock) {
  if (!supplierOrderPhotoPreviewIsEditable(block)) return block;
  const lines = block.lines.map((line): AssistantSupplierOrderPhotoPreviewLine => ({
    ...line, resolution: lineIsIdentified(line) ? "IDENTIFIED" : "NEEDS_REVIEW",
  }));
  const completeHeader = Boolean(
    block.negotiationNumber && /^[0-9]{1,120}$/.test(block.negotiationNumber) &&
    block.orderDate && isRealSupplierOrderPhotoDate(block.orderDate),
  );
  const ready = completeHeader && lines.length > 0 && lines.every(lineIsIdentified);
  return {
    ...block,
    lines,
    totalQuantity: lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0),
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
  if (!supplierOrderPhotoPreviewIsEditable(block) || !block.lines[lineIndex]) return block;
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
      warning: remaining.includes("VISUAL_REVIEW") ? line.warning : remaining.includes("QUANTITY_MISSING")
        ? "A identidade foi confirmada, mas a quantidade ainda precisa de revisão."
        : null,
      catalogOptions: [],
    };
  });
  return recalculate({ ...block, lines });
}

export function supplierOrderPhotoLineCanConfirmVisualReview(
  block: AssistantSupplierOrderPhotoPreviewBlock,
  lineIndex: number,
) {
  const line = block.lines[lineIndex];
  return supplierOrderPhotoPreviewIsEditable(block) && Boolean(line &&
    line.blockingReasons.includes("VISUAL_REVIEW") &&
    lineIsIdentified({ ...line, blockingReasons: line.blockingReasons.filter(reason => reason !== "VISUAL_REVIEW") }));
}

// Human acknowledgement resolves ONLY visual doubt. It cannot override a code,
// description or quantity blocker, nor turn an unreadable/duplicate card ready.
export function confirmSupplierOrderPhotoVisualReview(
  block: AssistantSupplierOrderPhotoPreviewBlock,
  lineIndex: number,
): AssistantSupplierOrderPhotoPreviewBlock {
  if (!supplierOrderPhotoLineCanConfirmVisualReview(block, lineIndex)) return block;
  return recalculate({ ...block, lines: block.lines.map((line, index) => index !== lineIndex ? line : {
    ...line,
    blockingReasons: line.blockingReasons.filter(reason => reason !== "VISUAL_REVIEW"),
    warning: "Produto e quantidade confirmados na revisão humana.",
  }) });
}

export function updateSupplierOrderPhotoPreviewQuantity(
  block: AssistantSupplierOrderPhotoPreviewBlock,
  lineIndex: number,
  quantity: number,
): AssistantSupplierOrderPhotoPreviewBlock {
  if (!supplierOrderPhotoPreviewIsEditable(block) || !block.lines[lineIndex] ||
    !supplierOrderPhotoQuantityIsValid(quantity)) return block;
  return recalculate({ ...block, lines: block.lines.map((line, index) => index !== lineIndex ? line : {
    ...line, quantity,
    blockingReasons: line.blockingReasons.filter(reason => reason !== "QUANTITY_MISSING"),
    warning: line.blockingReasons.some(reason => reason !== "QUANTITY_MISSING")
      ? line.warning : "Quantidade informada na revisão humana.",
  }) });
}

export function updateSupplierOrderPhotoPreviewHeader(
  block: AssistantSupplierOrderPhotoPreviewBlock,
  negotiationNumber: string,
  orderDate: string,
): AssistantSupplierOrderPhotoPreviewBlock {
  if (!supplierOrderPhotoPreviewIsEditable(block) || !/^[0-9]{1,120}$/.test(negotiationNumber.trim()) ||
    !isRealSupplierOrderPhotoDate(orderDate)) return block;
  return recalculate({ ...block, negotiationNumber: negotiationNumber.trim(), orderDate });
}
