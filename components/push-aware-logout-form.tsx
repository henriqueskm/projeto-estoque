"use client";

import { type ReactNode } from "react";
import { logout } from "@/app/auth/actions";

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
  return (
    <form
      action={logout}
      className={formClassName}
      role={formRole}
      data-assistant-session-logout
    >
      <button type="submit" role={buttonRole} className={buttonClassName}>
        {children}
      </button>
    </form>
  );
}
