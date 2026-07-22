import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AssistantFloatingLink } from "@/components/assistant-floating-link";
import { AuthenticatedProfileProvider } from "@/components/authenticated-profile-provider";
import { requireActiveProfile } from "@/lib/auth";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const profile = await requireActiveProfile();

  return (
    <AuthenticatedProfileProvider
      displayName={profile.displayName}
      hasRegisteredName={profile.hasRegisteredName}
    >
      <div className="min-h-screen bg-app-background">
        <AppSidebar
          userName={profile.displayName}
          hasRegisteredName={profile.hasRegisteredName}
        />
        <div className="min-h-[calc(100dvh-3.5rem)] lg:min-h-screen lg:pl-64">
          {children}
        </div>
        <AssistantFloatingLink />
      </div>
    </AuthenticatedProfileProvider>
  );
}
