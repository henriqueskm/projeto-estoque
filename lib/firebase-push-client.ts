"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getMessaging,
  isSupported,
  onMessage,
  onRegistered,
  onUnregistered,
  register,
  unregister,
  type Messaging,
} from "firebase/messaging";
import { canUseServiceWorker } from "@/lib/pwa-capabilities";

const firebaseAppName = "negocios-k-push";
const registrationTimeoutMs = 10_000;

type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
};

type RegistrationListeners = {
  registered: (firebaseInstallationId: string) => void;
  unregistered?: (firebaseInstallationId: string) => void;
};

function readFirebasePublicConfig(): FirebasePublicConfig | null {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "",
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() ?? "",
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim() ?? "",
  };

  return Object.values(config).every(Boolean) ? config : null;
}

function getFirebaseApp(config: FirebasePublicConfig): FirebaseApp {
  return getApps().some((app) => app.name === firebaseAppName)
    ? getApp(firebaseAppName)
    : initializeApp(
        {
          apiKey: config.apiKey,
          authDomain: config.authDomain,
          projectId: config.projectId,
          messagingSenderId: config.messagingSenderId,
          appId: config.appId,
        },
        firebaseAppName,
      );
}

async function getPushContext(): Promise<{
  messaging: Messaging;
  registration: ServiceWorkerRegistration;
  vapidKey: string;
} | null> {
  const config = readFirebasePublicConfig();

  if (!config || !canUseServiceWorker() || !(await isSupported())) {
    return null;
  }

  const registration =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));

  return {
    messaging: getMessaging(getFirebaseApp(config)),
    registration,
    vapidKey: config.vapidKey,
  };
}

function observeRegistration(
  messaging: Messaging,
  listeners: RegistrationListeners,
) {
  const stopRegistered = onRegistered(messaging, listeners.registered);
  const stopUnregistered = onUnregistered(
    messaging,
    listeners.unregistered ?? (() => undefined),
  );

  return () => {
    stopRegistered();
    stopUnregistered();
  };
}

export function isFirebasePushConfigured() {
  return readFirebasePublicConfig() !== null;
}

export async function browserSupportsFirebasePush() {
  return (
    typeof Notification !== "undefined" &&
    canUseServiceWorker() &&
    (await isSupported())
  );
}

export async function requestFirebasePushPermission() {
  if (typeof Notification === "undefined") return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function waitForFirebasePushInstallation(
  timeoutMs = registrationTimeoutMs,
) {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return null;
  }

  const context = await getPushContext();
  if (!context) return null;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let stopObserving: () => void = () => undefined;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      stopObserving();
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("FID_REGISTRATION_TIMEOUT")));
    }, timeoutMs);

    stopObserving = observeRegistration(context.messaging, {
      registered(firebaseInstallationId) {
        finish(() => resolve(firebaseInstallationId));
      },
    });

    void register(context.messaging, {
      vapidKey: context.vapidKey,
      serviceWorkerRegistration: context.registration,
    }).catch((error: unknown) => {
      finish(() => reject(error));
    });
  });
}

export async function subscribeToFirebasePushRegistration(
  listeners: RegistrationListeners,
) {
  const context = await getPushContext();
  if (!context) return () => undefined;

  const stopObserving = observeRegistration(context.messaging, listeners);
  try {
    await register(context.messaging, {
      vapidKey: context.vapidKey,
      serviceWorkerRegistration: context.registration,
    });
  } catch (error) {
    stopObserving();
    throw error;
  }

  return stopObserving;
}

export async function unregisterFirebasePushInstallation() {
  const context = await getPushContext();
  if (!context) return false;
  await unregister(context.messaging);
  return true;
}

export async function subscribeToForegroundPush(listener: () => void) {
  const context = await getPushContext();
  if (!context) return () => undefined;

  return onMessage(context.messaging, (payload) => {
    if (payload.data?.type === "SAFISA_FULLY_READY") {
      listener();
    }
  });
}
