import { NextResponse } from "next/server";
import { loadSafisaPickupAlerts } from "@/lib/safisa-pickup-alerts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  const result = await loadSafisaPickupAlerts(supabase);

  if (result.error) {
    return NextResponse.json(
      { error: "Não foi possível atualizar as retiradas Safisa agora." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "no-store" },
  });
}
