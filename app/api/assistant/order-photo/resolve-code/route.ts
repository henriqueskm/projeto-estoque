import {
  assistantOrderPhotoJson, authenticateAssistantOrderPhotoRequest, readExactJson,
} from "@/lib/assistant-order-photo-route";
import {
  loadSupplierOrderPhotoCatalog, resolveSupplierOrderPhotoCatalogCode,
} from "@/lib/assistant-supplier-order-photo-catalog";

export async function POST(request: Request) {
  const auth = await authenticateAssistantOrderPhotoRequest(request);
  if ("error" in auth) return auth.error;
  const body = await readExactJson(request, ["code"]);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 120) return assistantOrderPhotoJson({ error: "Informe um código válido." }, 400);
  try {
    const result = resolveSupplierOrderPhotoCatalogCode(
      await loadSupplierOrderPhotoCatalog(auth.supabase), code,
    );
    if (result.kind === "FOUND") {
      return assistantOrderPhotoJson({ status: "FOUND", code: result.target.code, description: result.target.description }, 200);
    }
    if (result.kind === "AMBIGUOUS") {
      return assistantOrderPhotoJson({
        status: "AMBIGUOUS",
        error: "Este código possui mais de uma correspondência e precisa de revisão.",
        options: result.candidates.map((candidate) => ({
          code: candidate.code,
          description: candidate.description,
        })),
      }, 409);
    }
    return assistantOrderPhotoJson({ status: "NOT_FOUND", code }, 200);
  } catch {
    return assistantOrderPhotoJson({ error: "Não foi possível consultar o catálogo agora." }, 503);
  }
}
