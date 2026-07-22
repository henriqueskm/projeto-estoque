"use client";

import { createContext, useContext, type ReactNode } from "react";

type AuthenticatedProfileContextValue = {
  displayName: string;
  hasRegisteredName: boolean;
};

const AuthenticatedProfileContext =
  createContext<AuthenticatedProfileContextValue | null>(null);

export function AuthenticatedProfileProvider({
  children,
  displayName,
  hasRegisteredName,
}: AuthenticatedProfileContextValue & { children: ReactNode }) {
  return (
    <AuthenticatedProfileContext.Provider
      value={{ displayName, hasRegisteredName }}
    >
      {children}
    </AuthenticatedProfileContext.Provider>
  );
}

export function useAuthenticatedProfile() {
  const profile = useContext(AuthenticatedProfileContext);

  if (!profile) {
    throw new Error(
      "useAuthenticatedProfile must be used within AuthenticatedProfileProvider.",
    );
  }

  return profile;
}
