import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { requireActiveProfile } from "@/lib/auth";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const profile = await requireActiveProfile();

  return (
    <div className="min-h-screen bg-app-background">
      <AppHeader
        userName={profile.displayName}
        userEmail={profile.email}
        hasRegisteredName={profile.hasRegisteredName}
      />
      {children}
    </div>
  );
}
