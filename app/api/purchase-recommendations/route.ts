import { NextResponse } from "next/server";
import { loadPurchaseRecommendations } from "@/lib/purchase-recommendations";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return response({ error: "Não autorizado." }, 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError) {
    return response(
      { error: "Não foi possível validar seu acesso agora." },
      503,
    );
  }

  if (!profile) {
    return response({ error: "Não autorizado." }, 403);
  }

  const result = await loadPurchaseRecommendations(supabase);

  if (!result.data) {
    return response({ error: result.error }, 503);
  }

  return response(result.data);
}
