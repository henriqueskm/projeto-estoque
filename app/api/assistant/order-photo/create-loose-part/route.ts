import {
  assistantOrderPhotoJson, authenticateAssistantOrderPhotoRequest, readExactJson,
} from "@/lib/assistant-order-photo-route";
import {
  assessSupplierOrderPhotoLoosePartCode,
  loadSupplierOrderPhotoCatalog,
} from "@/lib/assistant-supplier-order-photo-catalog";

function friendlyError(message: string) {
  if (/commercial configuration/i.test(message)) return "Este código já pertence a um código comercial.";
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
    const assessment = assessSupplierOrderPhotoLoosePartCode(
      await loadSupplierOrderPhotoCatalog(auth.supabase),
      code,
    );
    if (!assessment.allowed && assessment.resolution.kind === "FOUND") {
      return assistantOrderPhotoJson({
        error: `O Cód. ${assessment.resolution.target.code} já pertence ao catálogo oficial. Selecione esse produto na revisão.`,
      }, 409);
    }
    if (!assessment.allowed && assessment.resolution.kind === "AMBIGUOUS") {
      return assistantOrderPhotoJson({
        error: "Este código pertence a uma família conhecida. Defina o produto oficial correto na revisão.",
      }, 409);
    }
  } catch {
    return assistantOrderPhotoJson({ error: "Não foi possível validar o catálogo agora." }, 503);
  }
  const { data, error } = await auth.supabase.rpc("create_loose_part", {
    p_code: code, p_description: description,
  });
  if (error) return assistantOrderPhotoJson({ error: friendlyError(error.message) }, 409);
  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown> : null;
  if (!result || typeof result.code !== "string" || typeof result.description !== "string" || typeof result.created !== "boolean") {
    return assistantOrderPhotoJson({ error: "A peça foi processada, mas não foi possível atualizar a prévia." }, 502);
  }
  return assistantOrderPhotoJson({ code: result.code, description: result.description, created: result.created }, 200);
}
