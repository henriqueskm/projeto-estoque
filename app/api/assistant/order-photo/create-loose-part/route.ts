import {
  assistantOrderPhotoJson, authenticateAssistantOrderPhotoRequest, readExactJson,
} from "@/lib/assistant-order-photo-route";
import {
  CatalogWritePolicyError,
  executeCatalogWrite,
} from "@/lib/catalog-writer";
import { invalidateNkCatalog } from "@/lib/shared-catalog";

function friendlyError(message: string) {
  if (/commercial configuration/i.test(message)) return "Este código já pertence a um código comercial.";
  if (/conflicts with (?:existing|physical) catalog/i.test(message)) return "Este código corresponde a outro cadastro existente.";
  if (/inactive/i.test(message)) return "Esta peça avulsa está inativa e não pode ser reativada automaticamente.";
  if (/different description/i.test(message)) return "Este código já possui uma descrição diferente no catálogo.";
  if (/another item type|not registered as a loose-part/i.test(message)) return "Este código já pertence a outro tipo de item do catálogo.";
  if (/active profile|profile must have a name|authenticated/i.test(message)) return "Seu perfil precisa estar ativo e ter um nome cadastrado.";
  return "Não foi possível cadastrar esta peça. Revise os dados e tente novamente.";
}

export async function POST(request: Request) {
  const auth = await authenticateAssistantOrderPhotoRequest(request);
  if ("error" in auth) return auth.error;
  const body = await readExactJson(request, ["code", "description"]);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!code || code.length > 120 || !description || description.length > 500) {
    return assistantOrderPhotoJson({ error: "Informe código e descrição válidos." }, 400);
  }
  try {
    const { data, error } = await executeCatalogWrite(auth.supabase, {
      kind: "CATALOG_ONLY_LOOSE_PART",
      code,
      description,
    });
    if (error) return assistantOrderPhotoJson({ error: friendlyError(error.message) }, 409);
    const result = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown> : null;
    if (!result || typeof result.code !== "string" || typeof result.description !== "string" || typeof result.created !== "boolean") {
      return assistantOrderPhotoJson({ error: "A peça foi processada, mas não foi possível atualizar a prévia." }, 502);
    }
    // Invalidate successful idempotent replays too. A previous request may
    // have committed the item but lost its response before invalidating.
    invalidateNkCatalog();
    return assistantOrderPhotoJson({ code: result.code, description: result.description, created: result.created }, 200);
  } catch (error) {
    if (error instanceof CatalogWritePolicyError) {
      if (error.reason === "KNOWN_CODE") {
        return assistantOrderPhotoJson({
          error: `O Cód. ${error.catalogCodes[0]} já pertence ao catálogo oficial. Selecione esse produto na revisão.`,
        }, 409);
      }
      if (error.reason === "AMBIGUOUS_CODE") {
        return assistantOrderPhotoJson({
          error: "Este código pertence a uma família conhecida. Defina o produto oficial correto na revisão.",
        }, 409);
      }
      if (error.reason === "UNSUPPORTED_CODE") {
        return assistantOrderPhotoJson({
          error: "Este código usa um formato não suportado. Informe o código oficial sem criar uma nova grafia.",
        }, 409);
      }
    }
    return assistantOrderPhotoJson({ error: "Não foi possível validar o catálogo agora." }, 503);
  }
}
