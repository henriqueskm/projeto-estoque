import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AssistantConversationProvider } from "@/components/assistant-conversation-provider";
import { AuthenticatedProfileProvider } from "@/components/authenticated-profile-provider";
import { SafisaPickupAlertProvider } from "@/components/safisa-pickup-alert-provider";
import { PushNotificationProvider } from "@/components/push-notification-provider";
import { requireActiveProfile } from "@/lib/auth";
import { PerformanceAuditPanel } from "@/components/performance-audit-panel";
import { measurePerformanceAudit } from "@/lib/performance-audit";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const profile = await measurePerformanceAudit("auth", "layout_profile", requireActiveProfile);

  return (
    <AuthenticatedProfileProvider
      displayName={profile.displayName}
      hasRegisteredName={profile.hasRegisteredName}
    >
      <SafisaPickupAlertProvider>
        <PushNotificationProvider>
          <AssistantConversationProvider
            key={profile.id}
            userId={profile.id}
          >
            <div className="min-h-dvh bg-app-background">
              <AppSidebar
                userName={profile.displayName}
                hasRegisteredName={profile.hasRegisteredName}
              />
              <div className="min-h-dvh pt-16 lg:pt-0 lg:pl-64">
                {children}
              </div>
              {(process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview") ? <PerformanceAuditPanel /> : null}
            </div>
          </AssistantConversationProvider>
        </PushNotificationProvider>
      </SafisaPickupAlertProvider>
    </AuthenticatedProfileProvider>
  );
}
