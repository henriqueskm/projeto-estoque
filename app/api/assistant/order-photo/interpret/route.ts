import { NextResponse } from "next/server";
import {
  supplierOrderPhotoMaxFileBytes,
  readSupplierOrderPhotoDimensions,
  supplierOrderPhotoDimensionsAreSafe,
  validateSupplierOrderPhotoBytes,
  type SupplierOrderPhotoInterpretError,
  type SupplierOrderPhotoInterpretSuccess,
} from "@/lib/assistant-supplier-order-photo-contract";
import {
  interpretSupplierOrderPhoto,
  type SupplierOrderPhotoCatalogTarget,
} from "@/lib/assistant-supplier-order-photo";
import {
  extractSupplierOrderPhotoWithGemini,
  resolveSupplierOrderPhotoModel,
  SupplierOrderPhotoProviderError,
  type SupplierOrderPhotoProviderInternalCode,
} from "@/lib/ai/supplier-order-photo-gemini";
import { physicalItemTypes } from "@/lib/inbound-types";
import { createClient } from "@/lib/supabase/server";

const multipartOverheadAllowance = 64 * 1024;

type SupplierOrderPhotoRouteInternalCode =
  | SupplierOrderPhotoProviderInternalCode
  | "CATALOG_READ_FAILED"
  | "ORDER_LOOKUP_FAILED"
  | "UNEXPECTED";

class SupplierOrderPhotoRouteError extends Error {
  constructor(
    readonly internalCode: SupplierOrderPhotoRouteInternalCode,
    readonly stage: "catalog" | "order_lookup",
  ) {
    super("Supplier order photo route dependency failed");
    this.name = "SupplierOrderPhotoRouteError";
  }
}

function response(body: SupplierOrderPhotoInterpretSuccess | SupplierOrderPhotoInterpretError, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    return new URL(origin).origin === origin && new URL(request.url).origin === origin;
  } catch {
    return false;
  }
}

async function loadCatalog(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<SupplierOrderPhotoCatalogTarget[]> {
  const [itemsResult, configurationsResult, codesResult] = await Promise.all([
    supabase.from("items").select("id, code, description, item_type, is_active")
      .in("item_type", [...physicalItemTypes]).eq("is_active", true),
    supabase.from("commercial_configurations")
      .select("id, description, servo_id, installation_kit_id, is_active").eq("is_active", true),
    supabase.from("commercial_configuration_codes")
      .select("id, code, configuration_id, is_active").eq("is_active", true),
  ]);
  if (itemsResult.error || configurationsResult.error || codesResult.error) {
    throw new SupplierOrderPhotoRouteError("CATALOG_READ_FAILED", "catalog");
  }
  const items = (itemsResult.data ?? []) as Array<{
    id: string; code: string; description: string; item_type: string; is_active: boolean;
  }>;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const physicalTargets: SupplierOrderPhotoCatalogTarget[] = items.map((item) => ({
    identity: `ITEM:${item.id}`,
    codeIdentity: item.id,
    code: item.code,
    description: item.description,
  }));
  const configurationById = new Map(
    ((configurationsResult.data ?? []) as Array<{
      id: string; description: string | null; servo_id: string; installation_kit_id: string; is_active: boolean;
    }>).map((configuration) => [configuration.id, configuration]),
  );
  const configurationTargets = ((codesResult.data ?? []) as Array<{
    id: string; code: string; configuration_id: string; is_active: boolean;
  }>).flatMap((code) => {
    const configuration = configurationById.get(code.configuration_id);
    const servo = configuration ? itemById.get(configuration.servo_id) : null;
    const kit = configuration ? itemById.get(configuration.installation_kit_id) : null;
    if (!configuration || !servo || !kit) return [];
    return [{
      identity: `CONFIGURATION:${configuration.id}`,
      codeIdentity: code.id,
      code: code.code,
      description: configuration.description?.trim() || `${servo.description} + ${kit.code}`,
    } satisfies SupplierOrderPhotoCatalogTarget];
  });
  return [...physicalTargets, ...configurationTargets];
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!isSameOrigin(request)) return response({ error: "Origem da solicitação não permitida." }, 403);
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data;")) {
    return response({ error: "Envie uma imagem em formulário multipart." }, 415);
  }
  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength !== null && !/^\d+$/.test(rawContentLength)) {
    return response({ error: "O tamanho da solicitação é inválido." }, 400);
  }
  const contentLength = rawContentLength === null ? null : Number(rawContentLength);
  if (contentLength !== null && contentLength > supplierOrderPhotoMaxFileBytes + multipartOverheadAllowance) {
    return response({ error: "A imagem é muito grande. Escolha uma foto menor." }, 413);
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return response({ error: "Sua sessão expirou. Entre novamente." }, 401);
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("id").eq("id", userId).eq("is_active", true).maybeSingle();
  if (profileError) return response({ error: "Não foi possível validar seu acesso agora." }, 503);
  if (!profile) return response({ error: "Seu perfil não está ativo." }, 403);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return response({ error: "Não foi possível ler a imagem enviada." }, 400);
  }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "image" || !(entries[0]?.[1] instanceof File)) {
    return response({ error: "Envie exatamente uma imagem do Pedido." }, 400);
  }
  const file = entries[0][1];
  if (file.size < 1 || file.size > supplierOrderPhotoMaxFileBytes) {
    return response({ error: file.size < 1 ? "A imagem está vazia." : "A imagem é muito grande. Escolha uma foto menor." }, 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateSupplierOrderPhotoBytes(file.type.toLowerCase(), bytes);
  if (!validation.ok) {
    return response({ error: "O arquivo não é uma imagem JPEG, PNG, WebP, HEIC ou HEIF válida." }, 415);
  }
  const dimensions = readSupplierOrderPhotoDimensions(bytes, validation.mimeType);
  if (!supplierOrderPhotoDimensionsAreSafe(dimensions)) {
    return response({ error: "Não foi possível validar as dimensões desta imagem com segurança." }, 415);
  }

  try {
    const block = await interpretSupplierOrderPhoto({
      extract: () => extractSupplierOrderPhotoWithGemini({ bytes, mimeType: validation.mimeType }),
      loadCatalog: () => loadCatalog(supabase),
      findExistingOrder: async (negotiationNumber) => {
        const result = await supabase.from("supplier_order_summaries")
          .select("id, negotiation_number, status, is_in_history")
          .eq("negotiation_number", negotiationNumber).limit(2);
        if (result.error) {
          throw new SupplierOrderPhotoRouteError("ORDER_LOOKUP_FAILED", "order_lookup");
        }
        const rows = (result.data ?? []) as Array<{
          id: string; negotiation_number: string; status: string; is_in_history: boolean;
        }>;
        if (rows.length > 1) {
          throw new SupplierOrderPhotoRouteError("ORDER_LOOKUP_FAILED", "order_lookup");
        }
        const order = rows[0];
        return order ? {
          negotiationNumber: order.negotiation_number,
          status: order.status,
          href: `/pedidos?view=${order.is_in_history ? "history" : "active"}&order=${order.id}`,
        } : null;
      },
    });
    console.info("assistant_order_photo", {
      outcome: block.state,
      mimeType: validation.mimeType,
      sizeBytes: file.size,
      durationMs: Date.now() - startedAt,
    });
    return response({ message: "Foto de Pedido analisada", structuredBlock: block }, 200);
  } catch (error) {
    const providerError = error instanceof SupplierOrderPhotoProviderError ? error : null;
    const routeError = error instanceof SupplierOrderPhotoRouteError ? error : null;
    console.warn("assistant_order_photo", {
      outcome: "ERROR",
      stage: providerError ? "provider" : routeError?.stage ?? "interpretation",
      internalCode: providerError?.internalCode ?? routeError?.internalCode ?? "UNEXPECTED",
      providerStatus: providerError?.providerStatus ?? null,
      model: providerError?.model ?? resolveSupplierOrderPhotoModel(),
      mimeType: validation.mimeType,
      sizeBytes: file.size,
      durationMs: Date.now() - startedAt,
    });
    return response({ error: "Não foi possível analisar este Pedido agora. Tente novamente." }, 502);
  }
}
