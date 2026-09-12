"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSafisaPickupAlerts } from "@/components/safisa-pickup-alert-provider";
import {
  browserSupportsFirebasePush,
  isFirebasePushConfigured,
  requestFirebasePushPermission,
  subscribeToFirebasePushRegistration,
  subscribeToForegroundPush,
  unregisterFirebasePushInstallation,
  waitForFirebasePushInstallation,
} from "@/lib/firebase-push-client";
import { isIosDevice, isStandaloneMode } from "@/lib/pwa-capabilities";
import {
  beginPushOperation,
  createPushOptOutReconciler,
  createPushPersistenceQueue,
  createPushOperationGate,
  finishPushOperation,
  invalidatePushOperations,
  isPushMutationConfirmed,
  isCurrentPushOperation,
  persistPushPreference,
  readAndMigratePushPreference,
  registerPushInstallationWithConvergence,
  runPushDisableCleanup,
  runPushLogoutCleanup,
  shouldAutoRegisterPush,
  subscribeToPushDeviceIdentityEvents,
  subscribeToPushOptOutEvents,
  type PushOperationKind,
} from "@/lib/push-notification-operations";

export type PushNotificationState =
  | "checking"
  | "default"
  | "granted"
  | "denied"
  | "unsupported"
  | "not_configured"
  | "ios_install_required"
  | "error";

type PushNotificationContextValue = {
  state: PushNotificationState;
  isWorking: boolean;
  operation: PushOperationKind | null;
  errorOperation: PushOperationKind | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  prepareForLogout: () => Promise<void>;
};

const PushNotificationContext =
  createContext<PushNotificationContextValue | null>(null);
const localPushPreferenceKey = "negocios-k:push-preference";
const legacyLocalOptOutKey = "negocios-k:push-disabled";
const localDeviceIdKey = "negocios-k:push-device-id";
const localFirebaseInstallationIdKey =
  "negocios-k:push-firebase-installation-id";

function getDeviceId() {
  const existing = window.localStorage.getItem(localDeviceIdKey);
  if (existing) return existing;

  const deviceId = window.crypto.randomUUID();
  window.localStorage.setItem(localDeviceIdKey, deviceId);
  return deviceId;
}

function getStoredDeviceId() {
  return window.localStorage.getItem(localDeviceIdKey);
}

function getStoredFirebaseInstallationId() {
  return window.localStorage.getItem(localFirebaseInstallationIdKey);
}

function storeFirebaseInstallationId(firebaseInstallationId: string) {
  window.localStorage.setItem(
    localFirebaseInstallationIdKey,
    firebaseInstallationId,
  );
}

function removeStoredFirebaseInstallationId(firebaseInstallationId?: string) {
  const stored = getStoredFirebaseInstallationId();
  if (!firebaseInstallationId || stored === firebaseInstallationId) {
    window.localStorage.removeItem(localFirebaseInstallationIdKey);
  }
}

async function persistInstallation(
  firebaseInstallationId: string,
  method: "POST" | "DELETE",
  options: { keepalive?: boolean; deviceId?: string } = {},
) {
  const deviceId = options.deviceId ?? getStoredDeviceId();
  if (!deviceId) return { ok: false };

  const response = await fetch("/api/push-subscriptions", {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceId,
      firebaseInstallationId,
    }),
    keepalive: options.keepalive,
  });
  return {
    ok: await isPushMutationConfirmed(
      response,
      method === "POST" ? "enable" : "disable",
    ),
  };
}

function readLocalPushPreference() {
  try {
    return readAndMigratePushPreference({
      storage: window.localStorage,
      preferenceKey: localPushPreferenceKey,
      legacyOptOutKey: legacyLocalOptOutKey,
      installationKey: localFirebaseInstallationIdKey,
      deviceKey: localDeviceIdKey,
    });
  } catch {
    return "unknown" as const;
  }
}

function hasPersistedPushOptIn() {
  try {
    return window.localStorage.getItem(localPushPreferenceKey) === "enabled";
  } catch {
    return false;
  }
}

function persistLocalPushPreference(preference: "enabled" | "disabled") {
  try {
    return persistPushPreference({
      storage: window.localStorage,
      preferenceKey: localPushPreferenceKey,
      legacyOptOutKey: legacyLocalOptOutKey,
      preference,
    });
  } catch {
    return false;
  }
}

export async function disablePushBeforeLogout() {
  let firebaseInstallationId: string | null = null;
  try {
    firebaseInstallationId = getStoredFirebaseInstallationId();
  } catch {
    // Firebase unregistration is still attempted when local storage is unavailable.
  }
  await runPushLogoutCleanup({
    firebaseInstallationId,
    disableInstallation: (firebaseInstallationId) =>
      persistInstallation(firebaseInstallationId, "DELETE", { keepalive: true }),
    removeStoredInstallation: removeStoredFirebaseInstallationId,
    unregisterInstallation: unregisterFirebasePushInstallation,
    storeLocalOptOut: () => {
      persistLocalPushPreference("disabled");
    },
  });
}

export function PushNotificationProvider({ children }: { children: ReactNode }) {
  const { refreshAlerts } = useSafisaPickupAlerts();
  const [state, setState] = useState<PushNotificationState>("checking");
  const [isWorking, setIsWorking] = useState(false);
  const [operation, setOperation] = useState<PushOperationKind | null>(null);
  const [errorOperation, setErrorOperation] =
    useState<PushOperationKind | null>(null);
  const operationGateRef = useRef(createPushOperationGate());
  const desiredEnabledRef = useRef<boolean | null>(null);
  const registrationGenerationRef = useRef(0);
  const [persistenceQueue] = useState(createPushPersistenceQueue);
  const [optOutReconciler] = useState(createPushOptOutReconciler);
  const queuePersistence = persistenceQueue.run;

  const reconcileInstallation = useCallback(async (
    firebaseInstallationId: string,
  ) => {
    const canPersist = () =>
      desiredEnabledRef.current === true &&
      hasPersistedPushOptIn();

    return queuePersistence(async () => {
      if (!canPersist()) return null;
      return registerPushInstallationWithConvergence({
        firebaseInstallationId,
        getOrCreateDeviceId: getDeviceId,
        readDeviceId: getStoredDeviceId,
        storeInstallation: storeFirebaseInstallationId,
        registerInstallation: (deviceId, installationId) =>
          persistInstallation(installationId, "POST", { deviceId }),
        rollbackInstallation: (deviceId, installationId) =>
          persistInstallation(installationId, "DELETE", { deviceId }),
        canRegister: canPersist,
        maxAttempts: 3,
      });
    });
  }, [queuePersistence]);

  const registerAndPersistInstallation = useCallback(async () => {
    if (
      desiredEnabledRef.current !== true ||
      !hasPersistedPushOptIn()
    ) return null;
    const firebaseInstallationId = await waitForFirebasePushInstallation();
    if (!firebaseInstallationId) return null;
    return reconcileInstallation(firebaseInstallationId);
  }, [reconcileInstallation]);

  const beginOperation = useCallback((operation: PushOperationKind) => {
    const generation = beginPushOperation(operationGateRef.current, operation);
    if (generation === null) return null;
    desiredEnabledRef.current = operation === "enable";
    setOperation(operation);
    setErrorOperation(null);
    setIsWorking(true);
    return generation;
  }, []);

  const operationIsCurrent = useCallback(
    (generation: number, operation: PushOperationKind) =>
      isCurrentPushOperation(operationGateRef.current, generation, operation),
    [],
  );

  const finishOperation = useCallback(
    (generation: number, operation: PushOperationKind) => {
      if (finishPushOperation(operationGateRef.current, generation, operation)) {
        setIsWorking(false);
        setOperation(null);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const preference = readLocalPushPreference();
      if (!shouldAutoRegisterPush(preference)) {
        desiredEnabledRef.current = false;
        registrationGenerationRef.current += 1;
        if (active) setState("default");
        if (preference !== "disabled") return;

        let firebaseInstallationId: string | null = null;
        try {
          firebaseInstallationId = getStoredFirebaseInstallationId();
        } catch {
          // Firebase unregistration is still attempted without readable storage.
        }
        await optOutReconciler.run(() =>
          queuePersistence(() => runPushDisableCleanup({
            firebaseInstallationId,
            disableInstallation: (installationId) =>
              persistInstallation(installationId, "DELETE"),
            removeStoredInstallation: removeStoredFirebaseInstallationId,
            unregisterInstallation: unregisterFirebasePushInstallation,
          })),
        );
        return;
      }

      if (!isFirebasePushConfigured()) {
        desiredEnabledRef.current = false;
        if (active) setState("not_configured");
        return;
      }

      if (isIosDevice() && !isStandaloneMode()) {
        desiredEnabledRef.current = false;
        if (active) setState("ios_install_required");
        return;
      }

      if (!(await browserSupportsFirebasePush())) {
        desiredEnabledRef.current = false;
        if (active) setState("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        desiredEnabledRef.current = false;
        if (active) setState("denied");
        return;
      }

      if (Notification.permission !== "granted") {
        desiredEnabledRef.current = false;
        if (active) setState("default");
        return;
      }

      try {
        desiredEnabledRef.current = true;
        const registration = await registerAndPersistInstallation();
        if (!active || desiredEnabledRef.current !== true) return;
        desiredEnabledRef.current = Boolean(registration);
        if (registration) {
          setErrorOperation(null);
          setState("granted");
        } else {
          setErrorOperation("enable");
          setState("error");
        }
      } catch {
        if (active && desiredEnabledRef.current === true) {
          setErrorOperation("enable");
          setState("error");
        }
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [optOutReconciler, queuePersistence, registerAndPersistInstallation]);

  useEffect(() => {
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      desiredEnabledRef.current = false;
      return;
    }

    const onOptOut = () => {
      if (desiredEnabledRef.current === false) return;
      desiredEnabledRef.current = false;
      registrationGenerationRef.current += 1;
      invalidatePushOperations(operationGateRef.current);
      setIsWorking(false);
      setOperation(null);
      setErrorOperation(null);
      setState("default");

      void optOutReconciler.run(() => queuePersistence(() => {
        let firebaseInstallationId: string | null = null;
        try {
          firebaseInstallationId = getStoredFirebaseInstallationId();
        } catch {
          // Firebase is still unregistered when local storage is unavailable.
        }
        return runPushDisableCleanup({
          firebaseInstallationId,
          disableInstallation: (storedInstallationId) =>
            persistInstallation(storedInstallationId, "DELETE"),
          removeStoredInstallation: removeStoredFirebaseInstallationId,
          unregisterInstallation: unregisterFirebasePushInstallation,
        });
      }));
    };

    const stopPreferenceOptOut = subscribeToPushOptOutEvents({
      eventTarget: window,
      storage,
      storageKey: localPushPreferenceKey,
      disabledValue: "disabled",
      onOptOut,
    });
    const stopLegacyOptOut = subscribeToPushOptOutEvents({
      eventTarget: window,
      storage,
      storageKey: legacyLocalOptOutKey,
      onOptOut,
    });
    const stopDeviceIdentity = subscribeToPushDeviceIdentityEvents({
      eventTarget: window,
      storage,
      storageKey: localDeviceIdKey,
      onIdentityChange: () => {
        if (
          desiredEnabledRef.current !== true ||
          !hasPersistedPushOptIn()
        ) return;
        void registerAndPersistInstallation().then((registration) => {
          if (
            !registration &&
            desiredEnabledRef.current === true &&
            hasPersistedPushOptIn()
          ) {
            setErrorOperation("enable");
            setState("error");
          }
        }).catch(() => {
          if (
            desiredEnabledRef.current === true &&
            hasPersistedPushOptIn()
          ) {
            setErrorOperation("enable");
            setState("error");
          }
        });
      },
    });

    return () => {
      stopPreferenceOptOut();
      stopLegacyOptOut();
      stopDeviceIdentity();
    };
  }, [optOutReconciler, queuePersistence, registerAndPersistInstallation]);

  useEffect(() => {
    if (state !== "granted") return;

    let active = true;
    desiredEnabledRef.current = true;
    const registrationGeneration = registrationGenerationRef.current + 1;
    registrationGenerationRef.current = registrationGeneration;
    let stopRegistration: () => void = () => undefined;
    let stopForeground: () => void = () => undefined;

    void subscribeToFirebasePushRegistration({
      async registered(firebaseInstallationId) {
        if (
          !active ||
          registrationGeneration !== registrationGenerationRef.current ||
          desiredEnabledRef.current !== true ||
          !hasPersistedPushOptIn()
        ) return;
        try {
          const registration = await reconcileInstallation(
            firebaseInstallationId,
          );
          if (
            !active ||
            registrationGeneration !== registrationGenerationRef.current ||
            desiredEnabledRef.current !== true
          ) return;
          if (!registration) {
            setErrorOperation("enable");
            setState("error");
            return;
          }
        } catch {
          if (
            active &&
            registrationGeneration === registrationGenerationRef.current &&
            desiredEnabledRef.current === true
          ) {
            setErrorOperation("enable");
            setState("error");
          }
        }
      },
      async unregistered(firebaseInstallationId) {
        if (
          !active ||
          registrationGeneration !== registrationGenerationRef.current ||
          desiredEnabledRef.current !== true
        ) return;
        try {
          const response = await queuePersistence(() =>
            persistInstallation(firebaseInstallationId, "DELETE"));
          if (
            !active ||
            registrationGeneration !== registrationGenerationRef.current ||
            desiredEnabledRef.current !== true
          ) return;
          if (!response.ok) {
            setErrorOperation("enable");
            setState("error");
            return;
          }
          removeStoredFirebaseInstallationId(firebaseInstallationId);
          setState("default");
        } catch {
          if (
            active &&
            registrationGeneration === registrationGenerationRef.current &&
            desiredEnabledRef.current === true
          ) {
            setErrorOperation("enable");
            setState("error");
          }
        }
      },
    }).then((unsubscribe) => {
      if (active) stopRegistration = unsubscribe;
      else unsubscribe();
    }).catch(() => {
      if (
        active &&
        registrationGeneration === registrationGenerationRef.current &&
        desiredEnabledRef.current === true
      ) {
        setErrorOperation("enable");
        setState("error");
      }
    });

    void subscribeToForegroundPush(() => void refreshAlerts()).then(
      (unsubscribe) => {
        if (active) stopForeground = unsubscribe;
        else unsubscribe();
      },
    );

    return () => {
      active = false;
      if (registrationGenerationRef.current === registrationGeneration) {
        registrationGenerationRef.current += 1;
      }
      stopRegistration();
      stopForeground();
    };
  }, [queuePersistence, reconcileInstallation, refreshAlerts, state]);

  const enable = useCallback(async () => {
    const operation = "enable" as const;
    const operationGeneration = beginOperation(operation);
    if (operationGeneration === null) return;

    try {
      if (!persistLocalPushPreference("enabled")) {
        desiredEnabledRef.current = false;
        setErrorOperation("enable");
        setState("error");
        return;
      }
      optOutReconciler.reset();

      if (isIosDevice() && !isStandaloneMode()) {
        desiredEnabledRef.current = false;
        if (operationIsCurrent(operationGeneration, operation)) setState("ios_install_required");
        return;
      }
      if (!isFirebasePushConfigured()) {
        desiredEnabledRef.current = false;
        if (operationIsCurrent(operationGeneration, operation)) setState("not_configured");
        return;
      }
      if (!(await browserSupportsFirebasePush())) {
        desiredEnabledRef.current = false;
        if (operationIsCurrent(operationGeneration, operation)) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        desiredEnabledRef.current = false;
        if (operationIsCurrent(operationGeneration, operation)) setState("denied");
        return;
      }

      if (
        Notification.permission !== "granted" &&
        !(await requestFirebasePushPermission())
      ) {
        desiredEnabledRef.current = false;
        const permissionAfterRequest = Reflect.get(
          Notification,
          "permission",
        ) as NotificationPermission;
        if (operationIsCurrent(operationGeneration, operation)) {
          setState(permissionAfterRequest === "denied" ? "denied" : "default");
        }
        return;
      }

      const registration = await registerAndPersistInstallation();
      if (!operationIsCurrent(operationGeneration, operation)) return;
      if (!registration) {
        desiredEnabledRef.current = false;
        setErrorOperation("enable");
        setState("error");
        return;
      }

      setErrorOperation(null);
      setState("granted");
    } catch {
      if (operationIsCurrent(operationGeneration, operation)) {
        desiredEnabledRef.current = false;
        setErrorOperation("enable");
        setState("error");
      }
    } finally {
      finishOperation(operationGeneration, operation);
    }
  }, [beginOperation, finishOperation, operationIsCurrent, optOutReconciler, registerAndPersistInstallation]);

  const disable = useCallback(async () => {
    const operation = "disable" as const;
    const operationGeneration = beginOperation(operation);
    if (operationGeneration === null) return;

    desiredEnabledRef.current = false;
    registrationGenerationRef.current += 1;
    persistLocalPushPreference("disabled");
    setState("default");

    try {
      const result = await queuePersistence(() => {
        let firebaseInstallationId: string | null = null;
        try {
          firebaseInstallationId = getStoredFirebaseInstallationId();
        } catch {
          // Firebase is still unregistered when local storage is unavailable.
        }
        return runPushDisableCleanup({
          firebaseInstallationId,
          disableInstallation: (storedInstallationId) =>
            persistInstallation(storedInstallationId, "DELETE"),
          removeStoredInstallation: removeStoredFirebaseInstallationId,
          unregisterInstallation: unregisterFirebasePushInstallation,
        });
      });
      if (!operationIsCurrent(operationGeneration, operation)) return;
      if (!result.synchronized) {
        setErrorOperation("disable");
        setState("error");
        return;
      }
      setErrorOperation(null);
      setState("default");
    } catch {
      if (operationIsCurrent(operationGeneration, operation)) {
        setErrorOperation("disable");
        setState("error");
      }
    } finally {
      finishOperation(operationGeneration, operation);
    }
  }, [beginOperation, finishOperation, operationIsCurrent, queuePersistence]);

  const prepareForLogout = useCallback(async () => {
    desiredEnabledRef.current = false;
    registrationGenerationRef.current += 1;
    invalidatePushOperations(operationGateRef.current);
    persistLocalPushPreference("disabled");
    setIsWorking(false);
    setOperation(null);
    await queuePersistence(disablePushBeforeLogout);
  }, [queuePersistence]);

  const value = useMemo(
    () => ({
      state,
      isWorking,
      operation,
      errorOperation,
      enable,
      disable,
      prepareForLogout,
    }),
    [
      disable,
      enable,
      errorOperation,
      isWorking,
      operation,
      prepareForLogout,
      state,
    ],
  );

  return (
    <PushNotificationContext.Provider value={value}>
      {children}
    </PushNotificationContext.Provider>
  );
}

export function usePushNotifications() {
  const context = useContext(PushNotificationContext);
  if (!context) {
    throw new Error("usePushNotifications must be used within its provider.");
  }
  return context;
}
