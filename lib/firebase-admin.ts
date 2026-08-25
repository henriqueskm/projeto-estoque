import "server-only";

import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const firebaseAdminAppName = "negocios-k-push-admin";

function getFirebaseAdminApp(): App | null {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    .trim();

  if (!projectId || !clientEmail || !privateKey) return null;

  return getApps().some((app) => app.name === firebaseAdminAppName)
    ? getApp(firebaseAdminAppName)
    : initializeApp(
        {
          credential: cert({ projectId, clientEmail, privateKey }),
          projectId,
        },
        firebaseAdminAppName,
      );
}

export function getFirebaseAdminMessaging() {
  const app = getFirebaseAdminApp();
  return app ? getMessaging(app) : null;
}
