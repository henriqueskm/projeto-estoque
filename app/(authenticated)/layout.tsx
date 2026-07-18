import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { requireActiveProfile } from "@/lib/auth";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const profile = await requireActiveProfile();

  return (
    <div className="min-h-screen bg-[#f4f7f5]">
      <AppHeader userName={profile.name} />
      {children}
    </div>
  );
}
