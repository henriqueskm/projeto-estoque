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
} from "@/lib/assistant-supplier-order-photo";
import {
  extractSupplierOrderPhotoWithGemini,
  resolveSupplierOrderPhotoModel,
  SupplierOrderPhotoProviderError,
  type SupplierOrderPhotoProviderInternalCode,
} from "@/lib/ai/supplier-order-photo-gemini";
import { loadSupplierOrderPhotoCatalog, SupplierOrderPhotoCatalogError } from "@/lib/assistant-supplier-order-photo-catalog";
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
      loadCatalog: async () => {
        try { return await loadSupplierOrderPhotoCatalog(supabase); }
        catch (error) {
          if (error instanceof SupplierOrderPhotoCatalogError) {
            throw new SupplierOrderPhotoRouteError("CATALOG_READ_FAILED", "catalog");
          }
          throw error;
        }
      },
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
