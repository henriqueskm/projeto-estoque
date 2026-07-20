import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation";
import { requireActiveProfile } from "@/lib/auth";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const profile = await requireActiveProfile();

  return (
    <div className="min-h-screen bg-app-background pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <AppHeader
        userName={profile.displayName}
        userEmail={profile.email}
        hasRegisteredName={profile.hasRegisteredName}
      />
      {children}
      <MobileBottomNavigation />
    </div>
  );
}
