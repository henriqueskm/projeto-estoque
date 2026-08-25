import { NextResponse } from "next/server";
import {
  isPushSubscriptionSameOrigin,
  readPushSubscriptionBody,
} from "@/lib/push-subscription-http";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function requireInternalUser() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  return profileError || !profile ? null : supabase;
}

async function mutateSubscription(request: Request, operation: "register" | "disable") {
  if (!isPushSubscriptionSameOrigin(request)) {
    return json({ error: "Origem da solicitação não permitida." }, 403);
  }

  const parsed = await readPushSubscriptionBody(request);
  if ("error" in parsed) {
    const message = parsed.error === 415
      ? "O conteúdo da solicitação deve ser JSON."
      : parsed.error === 413
        ? "Solicitação muito grande."
        : "Solicitação inválida.";
    return json({ error: message }, parsed.error);
  }

  const supabase = await requireInternalUser();
  if (!supabase) return json({ error: "Não autorizado." }, 401);

  const rpcName = operation === "register"
    ? "register_push_subscription"
    : "disable_push_subscription";
  const { data, error } = await supabase.rpc(rpcName, {
    p_device_id: parsed.data.deviceId,
    p_firebase_installation_id: parsed.data.firebaseInstallationId,
  });

  if (error) {
    const status = error.code === "42501" || error.code === "28000" ? 403 : 400;
    return json(
      {
        error: status === 403
          ? "Seu perfil interno não está ativo."
          : "Não foi possível atualizar as notificações neste dispositivo.",
      },
      status,
    );
  }

  return json(
    operation === "register"
      ? { enabled: data?.enabled === true }
      : { disabled: data?.disabled === true },
    200,
  );
}

export async function POST(request: Request) {
  return mutateSubscription(request, "register");
}

export async function DELETE(request: Request) {
  return mutateSubscription(request, "disable");
}
