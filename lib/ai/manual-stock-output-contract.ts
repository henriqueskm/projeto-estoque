export const ASSISTANT_MANUAL_STOCK_OUTPUT_DESCRIPTION =
  "Saída manual confirmada pela Assistente NK.";

export function manualStockOutputProfileHasName(name: unknown) {
  return typeof name === "string" && Boolean(name.trim());
}

export function calculateManualStockOutputProjection(
  currentStock: number,
  availableStock: number,
  quantity: number,
) {
  const autoAssembledQuantity = Math.max(0, quantity - currentStock);
  return {
    autoAssembledQuantity,
    estimatedStockAfter: currentStock + autoAssembledQuantity - quantity,
    sufficient: quantity <= availableStock,
  };
}
