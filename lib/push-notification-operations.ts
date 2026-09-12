export type PushOperationKind = "enable" | "disable";

export type PushOperationGate = {
  generation: number;
  working: boolean;
  operation: PushOperationKind | null;
};

export function createPushOperationGate(): PushOperationGate {
  return { generation: 0, working: false, operation: null };
}

export function beginPushOperation(
  gate: PushOperationGate,
  operation: PushOperationKind,
) {
  if (gate.working) {
    const disableSupersedesEnable =
      operation === "disable" && gate.operation === "enable";
    if (!disableSupersedesEnable) return null;
  }
  gate.generation += 1;
  gate.working = true;
  gate.operation = operation;
  return gate.generation;
}

export function isCurrentPushOperation(
  gate: PushOperationGate,
  generation: number,
  operation: PushOperationKind,
) {
  return (
    gate.working &&
    gate.generation === generation &&
    gate.operation === operation
  );
}

export function finishPushOperation(
  gate: PushOperationGate,
  generation: number,
  operation: PushOperationKind,
) {
  if (!isCurrentPushOperation(gate, generation, operation)) return false;
  gate.working = false;
  gate.operation = null;
  return true;
}

export function invalidatePushOperations(gate: PushOperationGate) {
  gate.generation += 1;
  gate.working = false;
  gate.operation = null;
}

type LogoutCleanupResponse = { ok: boolean };

export function createPushPersistenceQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(work: () => Promise<T>) {
      const result = tail.catch(() => undefined).then(work);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    idle() {
      return tail;
    },
  };
}

export async function runPushDisableCleanup(input: {
  firebaseInstallationId: string | null;
  disableInstallation: (
    firebaseInstallationId: string,
  ) => Promise<LogoutCleanupResponse>;
  removeStoredInstallation: (firebaseInstallationId: string) => void;
  unregisterInstallation: () => Promise<unknown>;
}) {
  let deleteConfirmed = input.firebaseInstallationId === null;
  let unregisterConfirmed = false;

  if (input.firebaseInstallationId) {
    try {
      const response = await input.disableInstallation(
        input.firebaseInstallationId,
      );
      deleteConfirmed = response.ok;
      if (response.ok) {
        input.removeStoredInstallation(input.firebaseInstallationId);
      }
    } catch {
      // Keep the FID so a later retry can target the same device record.
    }
  }

  try {
    await input.unregisterInstallation();
    unregisterConfirmed = true;
  } catch {
    // Backend deletion and local Firebase unregistration are independent.
  }

  return {
    deleteConfirmed,
    unregisterConfirmed,
    synchronized: deleteConfirmed && unregisterConfirmed,
  };
}

export async function runPushLogoutCleanup(input: {
  firebaseInstallationId: string | null;
  disableInstallation: (
    firebaseInstallationId: string,
  ) => Promise<LogoutCleanupResponse>;
  removeStoredInstallation: (firebaseInstallationId: string) => void;
  unregisterInstallation: () => Promise<unknown>;
  storeLocalOptOut: () => void;
}) {
  input.storeLocalOptOut();
  return runPushDisableCleanup(input);
}

export async function runBoundedLogoutFlow(input: {
  cleanup: Promise<unknown>;
  deadline: Promise<unknown>;
  submit: () => void;
}) {
  try {
    await Promise.race([input.cleanup, input.deadline]);
  } catch {
    // Cleanup is best-effort; submission is the authoritative logout path.
  } finally {
    input.submit();
  }
}
