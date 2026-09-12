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
  if (gate.working) return null;
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

export async function runPushLogoutCleanup(input: {
  firebaseInstallationId: string | null;
  disableInstallation: (
    firebaseInstallationId: string,
  ) => Promise<LogoutCleanupResponse>;
  removeStoredInstallation: (firebaseInstallationId: string) => void;
  unregisterInstallation: () => Promise<unknown>;
  storeLocalOptOut: () => void;
}) {
  if (input.firebaseInstallationId) {
    try {
      const response = await input.disableInstallation(
        input.firebaseInstallationId,
      );
      if (response.ok) {
        input.removeStoredInstallation(input.firebaseInstallationId);
      }
    } catch {
      // Logout cleanup continues with local unregistration.
    }
  }

  try {
    await input.unregisterInstallation();
  } catch {
    // Logout itself must not depend on Firebase cleanup.
  }

  input.storeLocalOptOut();
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
