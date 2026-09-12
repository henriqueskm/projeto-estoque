"use client";

import { useRef, type ReactNode } from "react";
import { logout } from "@/app/auth/actions";
import { usePushNotifications } from "@/components/push-notification-provider";
import { runBoundedLogoutFlow } from "@/lib/push-notification-operations";

const pushCleanupDeadlineMs = 1_200;

export function PushAwareLogoutForm({
  children,
  buttonClassName,
  buttonRole,
  formClassName,
  formRole,
}: {
  children: ReactNode;
  buttonClassName: string;
  buttonRole?: "menuitem";
  formClassName?: string;
  formRole?: "none";
}) {
  const { prepareForLogout } = usePushNotifications();
  const allowSubmitRef = useRef(false);
  const isPreparingRef = useRef(false);

  return (
    <form
      action={logout}
      className={formClassName}
      role={formRole}
      data-assistant-session-logout
      onSubmit={(event) => {
        if (allowSubmitRef.current) return;

        event.preventDefault();
        if (isPreparingRef.current) return;

        isPreparingRef.current = true;
        const form = event.currentTarget;
        let deadlineId: number | null = null;
        const cleanupDeadline = new Promise<void>((resolve) => {
          deadlineId = window.setTimeout(resolve, pushCleanupDeadlineMs);
        });
        void runBoundedLogoutFlow({
          cleanup: prepareForLogout(),
          deadline: cleanupDeadline,
          submit: () => {
            if (deadlineId !== null) window.clearTimeout(deadlineId);
            allowSubmitRef.current = true;
            form.requestSubmit();
          },
        });
      }}
    >
      <button type="submit" role={buttonRole} className={buttonClassName}>
        {children}
      </button>
    </form>
  );
}
