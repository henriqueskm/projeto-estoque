export type PushOperationKind = "enable" | "disable";
export type PushMutationKind = "enable" | "disable";
export type PushPreference = "enabled" | "disabled" | "unknown";
export type PushRegistrationIdentity = {
  deviceId: string;
  firebaseInstallationId: string;
};

type PushPreferenceStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
const pushDeviceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pushInstallationControlCharacterPattern = /[\u0000-\u001f\u007f]/;

function isPushRegistrationIdentity(
  value: unknown,
): value is PushRegistrationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const deviceId = Reflect.get(value, "deviceId");
  const firebaseInstallationId = Reflect.get(
    value,
    "firebaseInstallationId",
  );
  return (
    keys.length === 2 &&
    keys[0] === "deviceId" &&
    keys[1] === "firebaseInstallationId" &&
    typeof deviceId === "string" &&
    pushDeviceIdPattern.test(deviceId) &&
    typeof firebaseInstallationId === "string" &&
    firebaseInstallationId.trim() === firebaseInstallationId &&
    firebaseInstallationId.length > 0 &&
    firebaseInstallationId.length <= 512 &&
    !pushInstallationControlCharacterPattern.test(firebaseInstallationId)
  );
}

function readStoredPushRegistration(
  storage: Pick<Storage, "getItem">,
  registrationKey: string,
) {
  const serialized = storage.getItem(registrationKey);
  if (serialized === null) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isPushRegistrationIdentity(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function persistConfirmedPushRegistration(input: {
  storage: PushPreferenceStorage;
  registrationKey: string;
  identity: PushRegistrationIdentity;
}) {
  if (!isPushRegistrationIdentity(input.identity)) return false;
  try {
    input.storage.setItem(
      input.registrationKey,
      JSON.stringify(input.identity),
    );
    const stored = readStoredPushRegistration(
      input.storage,
      input.registrationKey,
    );
    return (
      stored?.deviceId === input.identity.deviceId &&
      stored.firebaseInstallationId === input.identity.firebaseInstallationId
    );
  } catch {
    return false;
  }
}

export function readConfirmedPushRegistration(input: {
  storage: PushPreferenceStorage;
  registrationKey: string;
  legacyInstallationKey: string;
  legacyDeviceKey: string;
}): PushRegistrationIdentity | null {
  try {
    const stored = readStoredPushRegistration(
      input.storage,
      input.registrationKey,
    );
    if (stored === undefined) return null;
    if (stored) return stored;

    const legacyIdentity = {
      deviceId: input.storage.getItem(input.legacyDeviceKey),
      firebaseInstallationId: input.storage.getItem(
        input.legacyInstallationKey,
      ),
    };
    if (!isPushRegistrationIdentity(legacyIdentity)) return null;
    return persistConfirmedPushRegistration({
      storage: input.storage,
      registrationKey: input.registrationKey,
      identity: legacyIdentity,
    })
      ? legacyIdentity
      : null;
  } catch {
    return null;
  }
}

export function removeConfirmedPushRegistration(input: {
  storage: PushPreferenceStorage;
  registrationKey: string;
  legacyInstallationKey: string;
  identity: PushRegistrationIdentity;
}) {
  try {
    const stored = readStoredPushRegistration(
      input.storage,
      input.registrationKey,
    );
    if (stored === undefined) return false;
    if (
      stored &&
      (stored.deviceId !== input.identity.deviceId ||
        stored.firebaseInstallationId !== input.identity.firebaseInstallationId)
    ) {
      return true;
    }

    input.storage.removeItem(input.registrationKey);
    if (
      input.storage.getItem(input.legacyInstallationKey) ===
      input.identity.firebaseInstallationId
    ) {
      input.storage.removeItem(input.legacyInstallationKey);
    }
    return (
      input.storage.getItem(input.registrationKey) === null &&
      input.storage.getItem(input.legacyInstallationKey) !==
        input.identity.firebaseInstallationId
    );
  } catch {
    return false;
  }
}

export function persistPushPreference(input: {
  storage: PushPreferenceStorage;
  preferenceKey: string;
  legacyOptOutKey: string;
  preference: Exclude<PushPreference, "unknown">;
}) {
  const {
    storage,
    preferenceKey,
    legacyOptOutKey,
    preference,
  } = input;

  if (preference === "enabled") {
    try {
      storage.removeItem(legacyOptOutKey);
      storage.setItem(preferenceKey, preference);
      if (
        storage.getItem(preferenceKey) === preference &&
        storage.getItem(legacyOptOutKey) !== "true"
      ) {
        return true;
      }
    } catch {
      // Roll back below to a fail-closed preference whenever possible.
    }

    try {
      storage.setItem(preferenceKey, "disabled");
      storage.setItem(legacyOptOutKey, "true");
    } catch {
      // A later read failure is also interpreted as unknown/fail-closed.
    }
    return false;
  }

  let preferenceStored = false;
  let legacyOptOutStored = false;
  try {
    // Clearing a previous enabled value first makes quota-style write failures
    // reload as unknown (fail-closed), never as the stale opt-in.
    storage.removeItem(preferenceKey);
    storage.setItem(preferenceKey, preference);
    preferenceStored = storage.getItem(preferenceKey) === preference;
  } catch {
    // The legacy marker is still attempted for existing open tabs.
  }
  try {
    storage.setItem(legacyOptOutKey, "true");
    legacyOptOutStored = storage.getItem(legacyOptOutKey) === "true";
  } catch {
    // In-memory disable and Firebase cleanup remain authoritative this session.
  }
  return preferenceStored || legacyOptOutStored;
}

/**
 * Legacy migration is deliberately conservative: only an existing stored FID
 * paired with a valid stored device UUID is evidence of a previously completed
 * NK registration; browser permission alone is not. Any inaccessible or
 * malformed storage state remains unknown.
 */
export function readAndMigratePushPreference(input: {
  storage: PushPreferenceStorage;
  preferenceKey: string;
  legacyOptOutKey: string;
  installationKey: string;
  deviceKey: string;
}): PushPreference {
  try {
    const storedPreference = input.storage.getItem(input.preferenceKey);
    if (input.storage.getItem(input.legacyOptOutKey) === "true") {
      if (storedPreference === "disabled") return "disabled";
      return persistPushPreference({
        ...input,
        preference: "disabled",
      })
        ? "disabled"
        : "unknown";
    }

    if (storedPreference === "enabled" || storedPreference === "disabled") {
      return storedPreference;
    }
    if (storedPreference !== null) return "unknown";

    const legacyInstallationId = input.storage.getItem(input.installationKey);
    const legacyDeviceId = input.storage.getItem(input.deviceKey);
    if (
      !legacyInstallationId ||
      !legacyDeviceId ||
      !pushDeviceIdPattern.test(legacyDeviceId)
    ) return "unknown";
    return persistPushPreference({
      ...input,
      preference: "enabled",
    })
      ? "enabled"
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function shouldAutoRegisterPush(preference: PushPreference) {
  return preference === "enabled";
}

type PushRegistrationResponse = { ok: boolean };

export async function registerPushInstallationWithConvergence(input: {
  firebaseInstallationId: string;
  getOrCreateDeviceId: () => string;
  readDeviceId: () => string | null;
  storeConfirmedRegistration: (
    identity: PushRegistrationIdentity,
  ) => boolean;
  registerInstallation: (
    deviceId: string,
    firebaseInstallationId: string,
  ) => Promise<PushRegistrationResponse>;
  rollbackInstallation?: (
    deviceId: string,
    firebaseInstallationId: string,
  ) => Promise<unknown>;
  canRegister: () => boolean;
  maxAttempts?: number;
}) {
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 5));
  let deviceId: string;
  let registrationConfirmed = false;

  try {
    if (!input.canRegister()) return null;
    deviceId = input.getOrCreateDeviceId();
  } catch {
    return null;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      if (!registrationConfirmed && !input.canRegister()) return null;
      const storedBeforeRequest = input.readDeviceId();
      if (!storedBeforeRequest) return null;
      deviceId = storedBeforeRequest;

      const response = await input.registerInstallation(
        deviceId,
        input.firebaseInstallationId,
      );
      if (!response.ok) return null;
      registrationConfirmed = true;

      // Replace the cleanup identity only after a semantically confirmed POST.
      const confirmedIdentity = {
        deviceId,
        firebaseInstallationId: input.firebaseInstallationId,
      };
      if (!input.storeConfirmedRegistration(confirmedIdentity)) {
        try {
          await input.rollbackInstallation?.(
            deviceId,
            input.firebaseInstallationId,
          );
        } catch {
          // Rollback is best-effort; registration is never reported complete.
        }
        return null;
      }

      const canonicalDeviceId = input.readDeviceId();
      if (!canonicalDeviceId) return null;
      if (canonicalDeviceId === deviceId) {
        return input.canRegister()
          ? {
              deviceId,
              firebaseInstallationId: input.firebaseInstallationId,
            }
          : null;
      }
      deviceId = canonicalDeviceId;
    } catch {
      return null;
    }
  }

  return null;
}

export async function isPushMutationConfirmed(
  response: Pick<Response, "ok" | "json">,
  operation: PushMutationKind,
) {
  if (!response.ok) return false;

  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const confirmationField = operation === "enable" ? "enabled" : "disabled";
    return Reflect.get(body, confirmationField) === true;
  } catch {
    return false;
  }
}

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

export function createPushOptOutReconciler() {
  let reconciliation: Promise<unknown> | null = null;

  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      if (!reconciliation) reconciliation = work();
      return reconciliation as Promise<T>;
    },
    reset() {
      reconciliation = null;
    },
  };
}

export function subscribeToPushOptOutEvents(input: {
  eventTarget: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  storage: Storage;
  storageKey: string;
  disabledValue?: string;
  onOptOut: () => void;
}) {
  const listener: EventListener = (event) => {
    const storageEvent = event as StorageEvent;
    if (
      storageEvent.storageArea === input.storage &&
      storageEvent.key === input.storageKey &&
      storageEvent.newValue === (input.disabledValue ?? "true")
    ) {
      input.onOptOut();
    }
  };

  input.eventTarget.addEventListener("storage", listener);
  return () => input.eventTarget.removeEventListener("storage", listener);
}

export function subscribeToPushDeviceIdentityEvents(input: {
  eventTarget: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  storage: Storage;
  storageKey: string;
  onIdentityChange: () => void;
}) {
  const listener: EventListener = (event) => {
    const storageEvent = event as StorageEvent;
    if (
      storageEvent.storageArea === input.storage &&
      storageEvent.key === input.storageKey &&
      typeof storageEvent.newValue === "string" &&
      storageEvent.newValue.length > 0
    ) {
      input.onIdentityChange();
    }
  };

  input.eventTarget.addEventListener("storage", listener);
  return () => input.eventTarget.removeEventListener("storage", listener);
}

export async function runPushDisableCleanup(input: {
  confirmedRegistration: PushRegistrationIdentity | null;
  disableRegistration: (
    identity: PushRegistrationIdentity,
  ) => Promise<LogoutCleanupResponse>;
  removeConfirmedRegistration: (
    identity: PushRegistrationIdentity,
  ) => void;
  unregisterInstallation: () => Promise<unknown>;
}) {
  let deleteConfirmed = input.confirmedRegistration === null;
  let unregisterConfirmed = false;

  if (input.confirmedRegistration) {
    try {
      const response = await input.disableRegistration(
        input.confirmedRegistration,
      );
      deleteConfirmed = response.ok;
      if (response.ok) {
        try {
          input.removeConfirmedRegistration(input.confirmedRegistration);
        } catch {
          // Confirmed DELETE makes stale local identity harmless; unregister continues.
        }
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
  confirmedRegistration: PushRegistrationIdentity | null;
  disableRegistration: (
    identity: PushRegistrationIdentity,
  ) => Promise<LogoutCleanupResponse>;
  removeConfirmedRegistration: (
    identity: PushRegistrationIdentity,
  ) => void;
  unregisterInstallation: () => Promise<unknown>;
  storeLocalOptOut: () => void;
}) {
  try {
    input.storeLocalOptOut();
  } catch {
    // Storage is best-effort; remote and Firebase cleanup must still run.
  }
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
