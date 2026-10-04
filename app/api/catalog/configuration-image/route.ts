import { createClient } from "@/lib/supabase/server";
import { isInventoryConfigurationVisible } from "@/lib/configuration-image-visibility";
import { logPerformanceAudit } from "@/lib/performance-audit";

const lifetimeSeconds = 600;
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers });
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: claims, error: claimsError } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (claimsError || !userId) return errorResponse("Sua sessão expirou. Entre novamente.", 401);
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("id").eq("id", userId).eq("is_active", true).maybeSingle();
    if (profileError) return errorResponse("Não foi possível validar seu acesso agora.", 503);
    if (!profile) return errorResponse("Seu perfil não está ativo.", 403);

    const params = new URL(request.url).searchParams;
    const configurationId = params.get("configurationId") ?? "";
    if (Array.from(params.keys()).some((key) => key !== "configurationId") ||
      params.getAll("configurationId").length !== 1 || !uuid.test(configurationId)) {
      return errorResponse("Solicitação inválida.", 400);
    }

    // All reads and signing use the current session client and existing RLS.
    // The request supplies only an identity; paths never come from the client.
    const { data: configuration, error: configurationError } = await supabase
      .from("commercial_configurations")
      .select("id, servo_id, installation_kit_id, is_active, image_path")
      .eq("id", configurationId).maybeSingle();
    if (configurationError) return errorResponse("Não foi possível consultar a foto agora.", 503);
    if (!configuration) return errorResponse("Configuração não encontrada.", 404);
    const [components, alias, balance] = await Promise.all([
      supabase.from("items").select("id, item_type, is_active")
        .in("id", [configuration.servo_id, configuration.installation_kit_id]),
      supabase.from("commercial_configuration_codes").select("id")
        .eq("configuration_id", configurationId).eq("is_active", true).limit(1),
      supabase.from("configuration_stock_balances").select("quantity")
        .eq("configuration_id", configurationId).maybeSingle(),
    ]);
    if (components.error || alias.error || balance.error) {
      return errorResponse("Não foi possível consultar a foto agora.", 503);
    }
    const servo = components.data?.find((item) => item.id === configuration.servo_id);
    const kit = components.data?.find((item) => item.id === configuration.installation_kit_id);
    if (!isInventoryConfigurationVisible(configuration.is_active, servo, kit,
      Boolean(alias.data?.length), balance.data?.quantity ?? 0)) {
      return errorResponse("Configuração não encontrada.", 404);
    }
    if (!configuration.image_path) return errorResponse("Foto não disponível.", 404);
    const startedAt = performance.now();
    const { data: signed, error: signingError } = await supabase.storage
      .from("commercial-catalog-images")
      .createSignedUrl(configuration.image_path, lifetimeSeconds);
    logPerformanceAudit({ loader: "configuration_image", phase: signingError || !signed?.signedUrl
      ? "sign_on_demand_error" : "sign_on_demand", durationMs: Math.round(performance.now() - startedAt), imagePathCount: 1 });
    if (signingError || !signed?.signedUrl) return errorResponse("Não foi possível carregar a foto agora. Tente novamente.", 502);
    return Response.json({ imageUrl: signed.signedUrl, expiresInSeconds: lifetimeSeconds }, { headers });
  } catch {
    return errorResponse("Não foi possível carregar a foto agora. Tente novamente.", 502);
  }
}
