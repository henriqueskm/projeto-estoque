import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function authenticateSupplierOrdersRequest() {
  const client = await createClient();
  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return { ok: false as const, status: 401 as const };
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false as const, status: 403 as const };
  }

  return { ok: true as const, client };
}
