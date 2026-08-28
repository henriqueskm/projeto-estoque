import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AssistantConversationProvider } from "@/components/assistant-conversation-provider";
import { AuthenticatedProfileProvider } from "@/components/authenticated-profile-provider";
import { SafisaPickupAlertProvider } from "@/components/safisa-pickup-alert-provider";
import { PushNotificationProvider } from "@/components/push-notification-provider";
import { requireActiveProfile } from "@/lib/auth";
import { loadSafisaPickupAlerts } from "@/lib/safisa-pickup-alerts";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const profile = await requireActiveProfile();
  const safisaPickupAlerts = await loadSafisaPickupAlerts();

  return (
    <AuthenticatedProfileProvider
      displayName={profile.displayName}
      hasRegisteredName={profile.hasRegisteredName}
    >
      <SafisaPickupAlertProvider initialResult={safisaPickupAlerts}>
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
            </div>
          </AssistantConversationProvider>
        </PushNotificationProvider>
      </SafisaPickupAlertProvider>
    </AuthenticatedProfileProvider>
  );
}
