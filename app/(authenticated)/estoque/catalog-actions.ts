"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { executeCatalogWrite } from "@/lib/catalog-writer";
import { invalidateNkCatalog } from "@/lib/shared-catalog";
import { catalogPostCommitMatches, catalogUuidPattern, parsePhysicalCatalogSnapshot, validatePhysicalCatalogRequest,
  type PhysicalCatalogRequest, type PhysicalCatalogResult, type PhysicalCatalogReceipt } from "@/lib/physical-catalog-management";

async function context() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const profile = await supabase.from("profiles").select("id").eq("id", data.claims.sub).eq("is_active", true).maybeSingle();
  return profile.error || !profile.data ? null : supabase;
}
export async function loadPhysicalCatalogPreview(itemId: string) {
  if (!catalogUuidPattern.test(itemId)) return { ok: false as const, error: "Produto inválido." };
  try {
    const supabase = await context();
    if (!supabase) return { ok: false as const, error: "Entre novamente com um perfil interno ativo." };
    const { data, error } = await supabase.rpc("get_physical_catalog_item_preview", { p_item_id: itemId });
    const snapshot = !error && parsePhysicalCatalogSnapshot(data);
    return snapshot ? { ok: true as const, snapshot } : { ok: false as const, error: "Não foi possível carregar a prévia. Tente novamente." };
  } catch { return { ok: false as const, error: "Não foi possível carregar a prévia. Tente novamente." }; }
}
export async function managePhysicalCatalog(request: PhysicalCatalogRequest, idempotencyKey: string): Promise<PhysicalCatalogResult> {
  const invalid = validatePhysicalCatalogRequest(request);
  if (invalid || !catalogUuidPattern.test(idempotencyKey)) return { ok: false, error: invalid ?? "Tentativa inválida." };
  try {
    const supabase = await context();
    if (!supabase) return { ok: false, error: "Entre novamente com um perfil interno ativo." };
    const { data, error } = await executeCatalogWrite(supabase, { kind: "PHYSICAL_CATALOG", request, idempotencyKey });
    if (error) {
      if (error.code === "40001") return { ok: false, stale: true, error: "O produto ou saldo mudou. Atualize a prévia antes de confirmar." };
      if (error.message?.includes("catalog_item_has_dependencies")) return { ok: false, error: "Exclusão bloqueada: o produto possui Pedidos pendentes, configuração, receita, aplicação ou compatibilidade vinculada." };
      if (["22023", "23514", "23505", "42501", "28000", "22P02"].includes(error.code)) return { ok: false, error: "Operação recusada. Confira código único, dados, vínculos e perfil ativo antes de tentar novamente." };
      return { ok: false, uncertain: true, error: "Não foi possível confirmar o resultado. Verifique a mesma tentativa antes de fazer outra alteração." };
    }
    // Invalidate even if verification fails: the transaction may have committed.
    invalidateNkCatalog();
    for (const path of ["/estoque", "/relatorio-estoque", "/entrada", "/saida", "/", "/pedidos", "/aplicacoes"]) revalidatePath(path);
    const item = parsePhysicalCatalogSnapshot(data?.item);
    const receipt: PhysicalCatalogReceipt | null = item && data?.operation === request.operation && typeof data.idempotentReplay === "boolean"
      ? { item, operation: request.operation, idempotentReplay: data.idempotentReplay } : null;
    const fresh = receipt ? await supabase.rpc("get_physical_catalog_item_preview", { p_item_id: receipt.item.id }) : null;
    const snapshot = !fresh?.error && parsePhysicalCatalogSnapshot(fresh?.data);
    if (!receipt || !snapshot || !catalogPostCommitMatches(receipt, snapshot)) return { ok: false, uncertain: true, error: "A confirmação precisa ser verificada novamente. Não envie uma nova operação." };
    return { ok: true, receipt };
  } catch { return { ok: false, uncertain: true, error: "Conexão interrompida. Verifique a mesma tentativa para evitar duplicação." }; }
}
