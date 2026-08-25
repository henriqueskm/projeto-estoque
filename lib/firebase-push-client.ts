"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
} from "firebase/messaging";
import { canUseServiceWorker } from "@/lib/pwa-capabilities";

const firebaseAppName = "negocios-k-push";

type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
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

export async function getCurrentFirebasePushToken() {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return null;
  }

  const context = await getPushContext();
  if (!context) return null;

  const token = await getToken(context.messaging, {
    vapidKey: context.vapidKey,
    serviceWorkerRegistration: context.registration,
  });

  return token || null;
}

export async function requestFirebasePushToken() {
  if (typeof Notification === "undefined") return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  return getCurrentFirebasePushToken();
}

export async function deleteCurrentFirebasePushToken() {
  const context = await getPushContext();
  if (!context) return false;
  return deleteToken(context.messaging);
}

export async function subscribeToForegroundPush(
  listener: () => void,
) {
  const context = await getPushContext();
  if (!context) return () => undefined;

  return onMessage(context.messaging, (payload) => {
    if (payload.data?.type === "SAFISA_FULLY_READY") {
      listener();
    }
  });
}
