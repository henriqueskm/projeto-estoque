import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActiveProfile = {
  id: string;
  name: string;
};

export async function requireActiveProfile(): Promise<ActiveProfile> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

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

  return {
    id: profile.id,
    name: profile.name?.trim() || "Usuário",
  };
}
