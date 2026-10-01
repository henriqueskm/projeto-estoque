import type { StockFlowBundleCode } from "@/lib/inbound-types";

export type BundleStockFlowPreview = {
  option: StockFlowBundleCode;
  requestedCodes: string[];
  quantity: number;
  currentBalance: number;
  predictedBalance: number;
  isValid: boolean;
};

export function buildBundleStockFlowPreview(
  lines: Array<{ option: { kind: string }; quantity: number }>,
  direction: "INBOUND" | "OUTBOUND",
): BundleStockFlowPreview[] {
  const grouped = new Map<string, BundleStockFlowPreview>();
  for (const line of lines) {
    if (line.option.kind !== "BUNDLE_CODE") continue;
    const option = line.option as StockFlowBundleCode;
    const current = grouped.get(option.bundleId);
    const quantity = (current?.quantity ?? 0) + line.quantity;
    const predictedBalance =
      option.readyBalance + (direction === "INBOUND" ? quantity : -quantity);
    grouped.set(option.bundleId, {
      option,
      requestedCodes: [...(current?.requestedCodes ?? []), option.code],
      quantity,
      currentBalance: option.readyBalance,
      predictedBalance,
      isValid:
        (current?.isValid ?? true) &&
        Number.isInteger(line.quantity) &&
        line.quantity > 0 &&
        Number.isSafeInteger(quantity) &&
        quantity <= 2_147_483_647 &&
        Number.isSafeInteger(predictedBalance) &&
        predictedBalance >= 0 &&
        predictedBalance <= 2_147_483_647,
    });
  }
  return Array.from(grouped.values()).sort((first, second) =>
    first.option.code.localeCompare(second.option.code),
  );
}
