import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { measurePerformanceAudit } from "@/lib/performance-audit";

export type ActiveProfile = {
  id: string;
  name: string | null;
  displayName: string;
  email: string;
  hasRegisteredName: boolean;
};

async function loadActiveProfile(): Promise<ActiveProfile> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await measurePerformanceAudit("auth", "claims", () => supabase.auth.getClaims());
  const userId = claimsData?.claims?.sub;
  const emailClaim = claimsData?.claims?.email;

  if (claimsError || !userId) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await measurePerformanceAudit(
    "auth", "profile", () => supabase
      .from("profiles")
      .select("id, name")
      .eq("id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    () => ({ queryCount: 1, waveCount: 1 }),
  );

  if (profileError || !profile) {
    redirect("/login?error=inactive");
  }

  const registeredName =
    typeof profile.name === "string" ? profile.name.trim() : "";
  let authenticatedEmail =
    typeof emailClaim === "string" ? emailClaim.trim() : "";

  if (!authenticatedEmail) {
    const { data: userData, error: userError } =
      await measurePerformanceAudit("auth", "user_fallback", () => supabase.auth.getUser());

    if (userError || userData.user?.id !== userId) {
      redirect("/login");
    }

    authenticatedEmail = userData.user.email?.trim() ?? "";
  }

  return {
    id: profile.id,
    name: registeredName || null,
    displayName: registeredName || "Nome não cadastrado",
    email: authenticatedEmail || "E-mail não disponível",
    hasRegisteredName: Boolean(registeredName),
  };
}

// Authentication/profile checks are request-scoped only. This avoids duplicate
// work between the authenticated layout and data loaders without persisting an
// authorization decision across requests.
export const requireActiveProfile = cache(loadActiveProfile);
