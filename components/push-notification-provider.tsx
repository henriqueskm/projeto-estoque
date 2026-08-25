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
  deleteCurrentFirebasePushToken,
  getCurrentFirebasePushToken,
  isFirebasePushConfigured,
  requestFirebasePushToken,
  subscribeToForegroundPush,
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

function getDeviceId() {
  const existing = window.localStorage.getItem(localDeviceIdKey);
  if (existing) return existing;

  const deviceId = window.crypto.randomUUID();
  window.localStorage.setItem(localDeviceIdKey, deviceId);
  return deviceId;
}

async function persistToken(token: string, method: "POST" | "DELETE") {
  return fetch("/api/push-subscriptions", {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ deviceId: getDeviceId(), fcmToken: token }),
  });
}

export async function disablePushBeforeLogout() {
  try {
    if (
      !isFirebasePushConfigured() ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    const token = await getCurrentFirebasePushToken();
    if (!token) return;

    const response = await persistToken(token, "DELETE");
    if (response.ok) {
      await deleteCurrentFirebasePushToken();
      window.localStorage.setItem(localOptOutKey, "true");
    }
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
        const token = await getCurrentFirebasePushToken();
        if (!token) {
          if (active) setState("error");
          return;
        }
        const response = await persistToken(token, "POST");
        if (active) setState(response.ok ? "granted" : "error");
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

    let unsubscribe: () => void = () => undefined;
    let active = true;
    void subscribeToForegroundPush(() => void refreshAlerts()).then(
      (nextUnsubscribe) => {
        if (active) unsubscribe = nextUnsubscribe;
        else nextUnsubscribe();
      },
    );

    return () => {
      active = false;
      unsubscribe();
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

      const token = await requestFirebasePushToken();
      if (!token) {
        const permissionAfterRequest = Reflect.get(
          Notification,
          "permission",
        ) as NotificationPermission;
        setState(permissionAfterRequest === "denied" ? "denied" : "error");
        return;
      }

      const response = await persistToken(token, "POST");
      if (!response.ok) {
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
      const token = await getCurrentFirebasePushToken();
      if (!token) {
        window.localStorage.setItem(localOptOutKey, "true");
        setState("default");
        return;
      }

      const response = await persistToken(token, "DELETE");
      if (!response.ok) {
        setState("error");
        return;
      }

      await deleteCurrentFirebasePushToken();
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
