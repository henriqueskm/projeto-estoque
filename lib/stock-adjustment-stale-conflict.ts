import type { InventoryActionTarget } from "@/lib/inventory-action-types";

type StockAdjustmentMutationResult<TReceipt> =
  | { ok: true; receipt: TReceipt }
  | { ok: false; error: string; stale?: true };

export type StockAdjustmentSubmissionPayload = {
  target_kind: InventoryActionTarget["kind"];
  target_id: string;
  counted_quantity: number;
  expected_quantity: number;
  reason: string;
  idempotency_key: string;
};

export async function runStockAdjustmentSubmission<TReceipt>({
  clearAttempt,
  closeDialog,
  countedQuantity,
  execute,
  idempotencyKey,
  isCurrentAttempt,
  onError,
  onStale,
  onSuccess,
  reason,
  target,
}: {
  clearAttempt: () => void;
  closeDialog: () => void;
  countedQuantity: number;
  execute: (
    payload: StockAdjustmentSubmissionPayload,
  ) => Promise<StockAdjustmentMutationResult<TReceipt>>;
  idempotencyKey: string;
  isCurrentAttempt: () => boolean;
  onError: (message: string) => void;
  onStale: (message: string, targetId: string) => void | Promise<void>;
  onSuccess: (receipt: TReceipt) => void;
  reason: string;
  target: InventoryActionTarget;
}) {
  const targetId =
    target.kind === "ITEM" ? target.itemId : target.configurationId;
  const expectedQuantity =
    target.kind === "ITEM" ? target.looseQuantity : target.assembledQuantity;
  const result = await execute({
    target_kind: target.kind,
    target_id: targetId,
    counted_quantity: countedQuantity,
    expected_quantity: expectedQuantity,
    reason,
    idempotency_key: idempotencyKey,
  });

  if (!isCurrentAttempt()) {
    return "superseded" as const;
  }

  if (!result.ok) {
    if (!result.stale) {
      onError(result.error);
      return "error" as const;
    }

    clearAttempt();
    closeDialog();
    try {
      await onStale(result.error, targetId);
    } catch {
      // The stale feedback and closed dialog survive a failed refresh.
    }
    return "stale" as const;
  }

  onSuccess(result.receipt);
  return "success" as const;
}
