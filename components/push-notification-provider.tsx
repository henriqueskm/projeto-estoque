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
  createPushOperationGate,
  finishPushOperation,
  invalidatePushOperations,
  isCurrentPushOperation,
  runPushLogoutCleanup,
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
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  prepareForLogout: () => Promise<void>;
};

const PushNotificationContext =
  createContext<PushNotificationContextValue | null>(null);
const localOptOutKey = "negocios-k:push-disabled";
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
  options: { keepalive?: boolean } = {},
) {
  return fetch("/api/push-subscriptions", {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceId: getDeviceId(),
      firebaseInstallationId,
    }),
    keepalive: options.keepalive,
  });
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
    storeLocalOptOut: () =>
      window.localStorage.setItem(localOptOutKey, "true"),
  });
}

export function PushNotificationProvider({ children }: { children: ReactNode }) {
  const { refreshAlerts } = useSafisaPickupAlerts();
  const [state, setState] = useState<PushNotificationState>("checking");
  const [isWorking, setIsWorking] = useState(false);
  const operationGateRef = useRef(createPushOperationGate());
  const desiredEnabledRef = useRef<boolean | null>(null);
  const registrationGenerationRef = useRef(0);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());

  const queuePersistence = useCallback(<T,>(work: () => Promise<T>) => {
    const result = persistenceQueueRef.current.catch(() => undefined).then(work);
    persistenceQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const registerAndPersistInstallation = useCallback(async () => {
    const firebaseInstallationId = await waitForFirebasePushInstallation();
    if (!firebaseInstallationId) return null;

    return queuePersistence(async () => {
      const response = await persistInstallation(firebaseInstallationId, "POST");
      if (!response.ok) return null;
      storeFirebaseInstallationId(firebaseInstallationId);
      return firebaseInstallationId;
    });
  }, [queuePersistence]);

  const beginOperation = useCallback((operation: PushOperationKind) => {
    const generation = beginPushOperation(operationGateRef.current, operation);
    if (generation === null) return null;
    desiredEnabledRef.current = operation === "enable";
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
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
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

      if (window.localStorage.getItem(localOptOutKey) === "true") {
        desiredEnabledRef.current = false;
        if (active) setState("default");
        return;
      }

      try {
        const firebaseInstallationId = await registerAndPersistInstallation();
        desiredEnabledRef.current = Boolean(firebaseInstallationId);
        if (active) setState(firebaseInstallationId ? "granted" : "error");
      } catch {
        if (active) setState("error");
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [registerAndPersistInstallation]);

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
          desiredEnabledRef.current !== true
        ) return;
        try {
          const response = await queuePersistence(async () => {
            if (
              !active ||
              registrationGeneration !== registrationGenerationRef.current
            ) return null;
            const nextResponse = await persistInstallation(
              firebaseInstallationId,
              "POST",
            );
            if (nextResponse.ok) storeFirebaseInstallationId(firebaseInstallationId);
            return nextResponse;
          });
          if (
            !response ||
            !active ||
            registrationGeneration !== registrationGenerationRef.current ||
            desiredEnabledRef.current !== true
          ) return;
          if (!response.ok) {
            setState("error");
            return;
          }
        } catch {
          if (
            active &&
            registrationGeneration === registrationGenerationRef.current &&
            desiredEnabledRef.current === true
          ) setState("error");
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
            setState("error");
            return;
          }
          removeStoredFirebaseInstallationId(firebaseInstallationId);
          setState("default");
        } catch {
          if (active) setState("error");
        }
      },
    }).then((unsubscribe) => {
      if (active) stopRegistration = unsubscribe;
      else unsubscribe();
    }).catch(() => {
      if (active) setState("error");
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
  }, [queuePersistence, refreshAlerts, state]);

  const enable = useCallback(async () => {
    const operation = "enable" as const;
    const operationGeneration = beginOperation(operation);
    if (operationGeneration === null) return;

    try {
      if (isIosDevice() && !isStandaloneMode()) {
        if (operationIsCurrent(operationGeneration, operation)) setState("ios_install_required");
        return;
      }
      if (!isFirebasePushConfigured()) {
        if (operationIsCurrent(operationGeneration, operation)) setState("not_configured");
        return;
      }
      if (!(await browserSupportsFirebasePush())) {
        if (operationIsCurrent(operationGeneration, operation)) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (operationIsCurrent(operationGeneration, operation)) setState("denied");
        return;
      }

      if (
        Notification.permission !== "granted" &&
        !(await requestFirebasePushPermission())
      ) {
        const permissionAfterRequest = Reflect.get(
          Notification,
          "permission",
        ) as NotificationPermission;
        if (operationIsCurrent(operationGeneration, operation)) {
          setState(permissionAfterRequest === "denied" ? "denied" : "default");
        }
        return;
      }

      const firebaseInstallationId = await registerAndPersistInstallation();
      if (!operationIsCurrent(operationGeneration, operation)) return;
      if (!firebaseInstallationId) {
        setState("error");
        return;
      }

      window.localStorage.removeItem(localOptOutKey);
      setState("granted");
    } catch {
      if (operationIsCurrent(operationGeneration, operation)) setState("error");
    } finally {
      finishOperation(operationGeneration, operation);
    }
  }, [beginOperation, finishOperation, operationIsCurrent, registerAndPersistInstallation]);

  const disable = useCallback(async () => {
    const operation = "disable" as const;
    const operationGeneration = beginOperation(operation);
    if (operationGeneration === null) return;

    try {
      const result = await queuePersistence(async () => {
        const firebaseInstallationId = getStoredFirebaseInstallationId();
        if (!firebaseInstallationId) return null;
        const response = await persistInstallation(
          firebaseInstallationId,
          "DELETE",
        );
        return { firebaseInstallationId, response };
      });
      if (!operationIsCurrent(operationGeneration, operation)) return;
      if (!result) {
        setState("error");
        return;
      }
      const { firebaseInstallationId, response } = result;
      if (!response.ok) {
        setState("error");
        return;
      }
      removeStoredFirebaseInstallationId(firebaseInstallationId);

      await unregisterFirebasePushInstallation().catch(() => false);
      window.localStorage.setItem(localOptOutKey, "true");
      setState("default");
    } catch {
      if (operationIsCurrent(operationGeneration, operation)) setState("error");
    } finally {
      finishOperation(operationGeneration, operation);
    }
  }, [beginOperation, finishOperation, operationIsCurrent, queuePersistence]);

  const prepareForLogout = useCallback(async () => {
    desiredEnabledRef.current = false;
    registrationGenerationRef.current += 1;
    invalidatePushOperations(operationGateRef.current);
    setIsWorking(false);
    await queuePersistence(disablePushBeforeLogout);
  }, [queuePersistence]);

  const value = useMemo(
    () => ({ state, isWorking, enable, disable, prepareForLogout }),
    [disable, enable, isWorking, prepareForLogout, state],
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
