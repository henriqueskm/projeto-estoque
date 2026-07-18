import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActiveProfile = {
  id: string;
  name: string | null;
  displayName: string;
  email: string;
  hasRegisteredName: boolean;
};

export async function requireActiveProfile(): Promise<ActiveProfile> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  const emailClaim = claimsData?.claims?.email;

  if (claimsError || !userId) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError || !profile) {
    redirect("/login?error=inactive");
  }

  const registeredName =
    typeof profile.name === "string" ? profile.name.trim() : "";
  let authenticatedEmail =
    typeof emailClaim === "string" ? emailClaim.trim() : "";

  if (!authenticatedEmail) {
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

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
