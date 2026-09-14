type SupplierOrderMutationResult =
  | { ok: true }
  | { ok: false; error: string; stale?: boolean };

export function handleSupplierOrderStaleConflict(
  result: SupplierOrderMutationResult,
  effects: {
    clearAttempt: () => void;
    reload: (message: string) => void;
  },
) {
  if (result.ok || !result.stale) {
    return false;
  }

  effects.clearAttempt();
  effects.reload(result.error);
  return true;
}
