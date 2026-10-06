import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { WorkspaceStateProvider } from "@/components/workspace-state-provider";
import { SemanticBackProvider } from "@/components/semantic-back-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { AssistantConversationProvider } from "@/components/assistant-conversation-provider";
import { AuthenticatedProfileProvider } from "@/components/authenticated-profile-provider";
import { SafisaPickupAlertProvider } from "@/components/safisa-pickup-alert-provider";
import { PushNotificationProvider } from "@/components/push-notification-provider";
import { requireActiveProfile } from "@/lib/auth";
import { PerformanceAuditPanel } from "@/components/performance-audit-panel";
import { measurePerformanceAudit } from "@/lib/performance-audit";

export default function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <Suspense fallback={<main aria-busy="true" aria-label="Verificando acesso" className="min-h-dvh bg-app-background px-4 py-8 text-text-primary"><p className="text-lg font-black">Negócios K</p><p className="mt-2 text-sm text-text-muted">Verificando acesso…</p></main>}>
      <AuthenticatedContent>{children}</AuthenticatedContent>
    </Suspense>
  );
}

async function AuthenticatedContent({
  children,
}: Readonly<{ children: ReactNode }>) {
  await connection();
  const profile = await measurePerformanceAudit("auth", "layout_profile", requireActiveProfile);

  return (
    <AuthenticatedProfileProvider
      displayName={profile.displayName}
      hasRegisteredName={profile.hasRegisteredName}
    >
      <SafisaPickupAlertProvider>
        <PushNotificationProvider>
          <WorkspaceStateProvider key={profile.id} userId={profile.id}>
          <SemanticBackProvider>
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
          </SemanticBackProvider>
          </WorkspaceStateProvider>
        </PushNotificationProvider>
      </SafisaPickupAlertProvider>
    </AuthenticatedProfileProvider>
  );
}
