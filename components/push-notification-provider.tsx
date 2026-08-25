"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  });
}

async function registerAndPersistInstallation() {
  const firebaseInstallationId = await waitForFirebasePushInstallation();
  if (!firebaseInstallationId) return null;

  const response = await persistInstallation(firebaseInstallationId, "POST");
  if (!response.ok) return null;

  storeFirebaseInstallationId(firebaseInstallationId);
  return firebaseInstallationId;
}

export async function disablePushBeforeLogout() {
  try {
    const firebaseInstallationId = getStoredFirebaseInstallationId();
    if (firebaseInstallationId) {
      const response = await persistInstallation(
        firebaseInstallationId,
        "DELETE",
      );
      if (!response.ok) return;
      removeStoredFirebaseInstallationId(firebaseInstallationId);
    }

    await unregisterFirebasePushInstallation().catch(() => false);
    window.localStorage.setItem(localOptOutKey, "true");
  } catch {
    // Push cleanup is best-effort and must never block logout.
  }
}

export function PushNotificationProvider({ children }: { children: ReactNode }) {
  const { refreshAlerts } = useSafisaPickupAlerts();
  const [state, setState] = useState<PushNotificationState>("checking");
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    let active = true;

    async function initialize() {
      if (!isFirebasePushConfigured()) {
        if (active) setState("not_configured");
        return;
      }

      if (isIosDevice() && !isStandaloneMode()) {
        if (active) setState("ios_install_required");
        return;
      }

      if (!(await browserSupportsFirebasePush())) {
        if (active) setState("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (active) setState("denied");
        return;
      }

      if (Notification.permission !== "granted") {
        if (active) setState("default");
        return;
      }

      if (window.localStorage.getItem(localOptOutKey) === "true") {
        if (active) setState("default");
        return;
      }

      try {
        const firebaseInstallationId = await registerAndPersistInstallation();
        if (active) setState(firebaseInstallationId ? "granted" : "error");
      } catch {
        if (active) setState("error");
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (state !== "granted") return;

    let active = true;
    let stopRegistration: () => void = () => undefined;
    let stopForeground: () => void = () => undefined;

    void subscribeToFirebasePushRegistration({
      async registered(firebaseInstallationId) {
        try {
          const response = await persistInstallation(
            firebaseInstallationId,
            "POST",
          );
          if (!active) return;
          if (!response.ok) {
            setState("error");
            return;
          }
          storeFirebaseInstallationId(firebaseInstallationId);
        } catch {
          if (active) setState("error");
        }
      },
      async unregistered(firebaseInstallationId) {
        try {
          const response = await persistInstallation(
            firebaseInstallationId,
            "DELETE",
          );
          if (!active) return;
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
      stopRegistration();
      stopForeground();
    };
  }, [refreshAlerts, state]);

  const enable = useCallback(async () => {
    if (isWorking) return;
    setIsWorking(true);

    try {
      if (isIosDevice() && !isStandaloneMode()) {
        setState("ios_install_required");
        return;
      }
      if (!isFirebasePushConfigured()) {
        setState("not_configured");
        return;
      }
      if (!(await browserSupportsFirebasePush())) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
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
        setState(permissionAfterRequest === "denied" ? "denied" : "error");
        return;
      }

      const firebaseInstallationId = await registerAndPersistInstallation();
      if (!firebaseInstallationId) {
        setState("error");
        return;
      }

      window.localStorage.removeItem(localOptOutKey);
      setState("granted");
    } catch {
      setState("error");
    } finally {
      setIsWorking(false);
    }
  }, [isWorking]);

  const disable = useCallback(async () => {
    if (isWorking) return;
    setIsWorking(true);

    try {
      const firebaseInstallationId = getStoredFirebaseInstallationId();
      if (!firebaseInstallationId) {
        setState("error");
        return;
      }

      const response = await persistInstallation(
        firebaseInstallationId,
        "DELETE",
      );
      if (!response.ok) {
        setState("error");
        return;
      }
      removeStoredFirebaseInstallationId(firebaseInstallationId);

      await unregisterFirebasePushInstallation().catch(() => false);
      window.localStorage.setItem(localOptOutKey, "true");
      setState("default");
    } catch {
      setState("error");
    } finally {
      setIsWorking(false);
    }
  }, [isWorking]);

  const value = useMemo(
    () => ({ state, isWorking, enable, disable }),
    [disable, enable, isWorking, state],
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
