type SupplierOrderMutationResult<TReceipt> =
  | { ok: true; receipt: TReceipt }
  | { ok: false; error: string; stale?: boolean };

type SupplierOrderConfirmationPayload = {
  expected_updated_at: string;
  idempotency_key: string;
};

export async function runSupplierOrderConfirmationMutation<TReceipt>({
  clearAttempt,
  closeConfirmation,
  execute,
  idempotencyKey,
  isCurrentAttempt,
  onError,
  onStale,
  onSuccess,
  supplierOrder,
}: {
  clearAttempt: () => void;
  closeConfirmation: () => void;
  execute: (
    payload: SupplierOrderConfirmationPayload,
  ) => Promise<SupplierOrderMutationResult<TReceipt>>;
  idempotencyKey: string;
  isCurrentAttempt: () => boolean;
  onError: (message: string) => void;
  onStale: (message: string, supplierOrderId: string) => void | Promise<void>;
  onSuccess: (receipt: TReceipt) => void;
  supplierOrder: { id: string; updatedAt: string };
}) {
  const result = await execute({
    expected_updated_at: supplierOrder.updatedAt,
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
    closeConfirmation();
    try {
      await onStale(result.error, supplierOrder.id);
    } catch {
      // The stale message and closed confirmation must survive a failed refresh.
    }
    return "stale" as const;
  }

  onSuccess(result.receipt);
  return "success" as const;
}
