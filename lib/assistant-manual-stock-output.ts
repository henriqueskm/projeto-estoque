import "server-only";

import { randomUUID } from "node:crypto";
import type {
  AssistantChatSuccess,
  AssistantClarificationBlock,
  AssistantManualStockOutputConfirmationResult,
  AssistantManualStockOutputPreviewBlock,
  AssistantManualStockOutputResultBlock,
  AssistantStockOutputSelection,
  AssistantStockOutputTarget,
} from "@/lib/assistant-types";
import {
  ASSISTANT_MANUAL_STOCK_OUTPUT_DESCRIPTION,
  calculateManualStockOutputProjection,
  manualStockOutputProfileHasName,
} from "@/lib/ai/manual-stock-output-contract";
import {
  createManualStockOutputProposalToken,
  verifyManualStockOutputProposalToken,
} from "@/lib/ai/manual-stock-output-action-token";
import {
  createManualStockOutputIdentitySelection,
  type ManualStockOutputRequest,
} from "@/lib/ai/manual-stock-output-routing";
import {
  loadManualStockOutputTargetsByIds,
  resolveManualStockOutputTargets,
} from "@/lib/assistant-stock-output-data";
import { createClient } from "@/lib/supabase/server";
import { normalizeServoModel } from "@/lib/servo-model-search";

export { ASSISTANT_MANUAL_STOCK_OUTPUT_DESCRIPTION };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorBlock(title: string, message: string, outcome: AssistantManualStockOutputResultBlock["outcome"] = "error"): AssistantManualStockOutputResultBlock {
  return { kind: "manual_stock_output_result", action: "manual_stock_output", outcome, title, message,
    lines: [], linesProcessed: 0, totalQuantity: 0, totalAutoAssemblyQuantity: 0,
    occurredAt: null, reference: null, idempotentReplay: false, actions: [] };
}

function answer(block: AssistantManualStockOutputResultBlock): AssistantChatSuccess {
  return { message: block.message, structuredBlock: block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

export function createManualStockOutputAmbiguity(quantity: number, targetQuery: string): AssistantChatSuccess {
  const normalizedModel = normalizeServoModel(targetQuery);
  const displayQuery = normalizedModel ? normalizedModel.replace(/^([A-Z]+)(\d+)$/, "$1-$2") : targetQuery;
  const itemSelection = createManualStockOutputIdentitySelection(targetQuery, quantity, "ITEM")!;
  const configurationSelection = createManualStockOutputIdentitySelection(targetQuery, quantity, "COMMERCIAL_CODE")!;
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification", title: "Qual tipo de saída deseja registrar?",
    message: `${displayQuery} pode representar um Servo sem kit ou um Servo com kit.`,
    options: [
      { id: "output-item", label: "Saída manual · Servo sem kit", prompt: `Selecionar Servo sem kit · ${displayQuery}`,
        category: "inventory", stockOutputSelection: itemSelection },
      { id: "output-box", label: "Saída manual · Servo com kit", prompt: `Selecionar Servo com kit · ${displayQuery}`,
        category: "inventory", stockOutputSelection: configurationSelection },
      { id: "output-cancel", label: "Cancelar", prompt: "Cancelar esta saída.", category: "inventory" },
    ], fallbackText: "Escolha o tipo de saída antes de continuar.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

function createTargetClarification(quantity: number, targets: AssistantStockOutputTarget[]): AssistantChatSuccess {
  const visibleTargets = targets.slice(0, 5);
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification", title: "Qual Servo com kit deseja selecionar?",
    message: targets.length > visibleTargets.length
      ? "Há várias configurações físicas para esse modelo. Escolha uma opção ou informe o Cód. exato."
      : "Há mais de uma configuração física para esse modelo. Escolha uma opção.",
    options: [
      ...visibleTargets.map((target, index) => ({ id: `output-target-${index + 1}`,
        label: `Servo com kit · Cód. ${target.aliases.join(" / ") || target.displayCode}`.slice(0, 60),
        prompt: `Selecionar Servo com kit · Cód. ${target.aliases.join(" / ") || target.displayCode}`,
        description: target.description.slice(0, 180), category: "inventory" as const,
        stockOutputSelection: { action: "manual_stock_output_target" as const, targetId: target.targetId,
          targetKind: target.kind, quantity } })),
      { id: "output-cancel", label: "Cancelar", prompt: "Cancelar esta saída.", category: "inventory" as const },
    ], fallbackText: "Escolha a configuração física antes de continuar.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

function createPreviewForTarget(
  target: AssistantStockOutputTarget,
  quantity: number,
  context: { userId: string; profileName: string | null },
): AssistantChatSuccess {
  const projection = calculateManualStockOutputProjection(target.currentStock, target.availableStock, quantity);
  if (!projection.sufficient) {
    return answer(errorBlock("Estoque insuficiente",
      `O Cód. ${target.displayCode} possui ${target.availableStock} unidade${target.availableStock === 1 ? "" : "s"} disponível${target.availableStock === 1 ? "" : "eis"}. Nenhuma saída foi executada.`));
  }
  const signed = createManualStockOutputProposalToken({ userId: context.userId,
    lines: [{ kind: target.kind, targetId: target.targetId, quantity }], idempotencyKey: randomUUID() },
    process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "");
  if (!signed) return answer(errorBlock("Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada."));
  const block: AssistantManualStockOutputPreviewBlock = {
    kind: "manual_stock_output_preview", action: "manual_stock_output", state: "pending",
    title: "Confirmar saída manual", message: "Os saldos serão relidos e validados pelo banco antes da saída.",
    proposalToken: signed.token, expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(),
    lines: [{ target, outputQuantity: quantity, estimatedStockAfter: projection.estimatedStockAfter,
      autoAssembledQuantity: projection.autoAssembledQuantity }], totalQuantity: quantity,
    totalAutoAssemblyQuantity: projection.autoAssembledQuantity, confirmLabel: "Confirmar saída", cancelLabel: "Cancelar",
    regeneratePrompt: `Saída manual de ${quantity} unidade${quantity === 1 ? "" : "s"} do Cód. ${target.displayCode}.`,
  };
  return { message: block.message, structuredBlock: block, contextItemQuery: target.displayCode,
    contextItemReferenceKind: "CATALOG_CODE",
    contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

export async function createAssistantManualStockOutputPreview(
  request: ManualStockOutputRequest,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (!uuidPattern.test(context.userId) || !manualStockOutputProfileHasName(context.profileName)) {
    return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma saída."));
  }
  const supabase = await createClient();
  const resolved = await resolveManualStockOutputTargets(supabase, request.targetQuery, request.requestedIdentity);
  if (resolved.failed) return answer(errorBlock("Consulta indisponível", "Não foi possível localizar o item agora."));
  if (!resolved.targets.length) return answer(errorBlock("Item não encontrado",
    `Não encontrei um item ativo com o código ou modelo ${request.targetQuery}. Nenhuma saída foi executada.`));
  if (resolved.targets.length > 1) return request.requestedIdentity === null
    ? createManualStockOutputAmbiguity(request.quantity, request.targetQuery)
    : createTargetClarification(request.quantity, resolved.targets);
  return createPreviewForTarget(resolved.targets[0], request.quantity, context);
}

export async function createAssistantManualStockOutputPreviewFromSelection(
  selection: AssistantStockOutputSelection,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (selection.action === "manual_stock_output_identity") {
    return createAssistantManualStockOutputPreview({ quantity: selection.quantity, targetQuery: selection.targetQuery,
      requestedIdentity: selection.targetKind }, context);
  }
  if (!uuidPattern.test(context.userId) || !manualStockOutputProfileHasName(context.profileName)) {
    return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma saída."));
  }
  const supabase = await createClient();
  const resolved = await loadManualStockOutputTargetsByIds(supabase,
    [{ kind: selection.targetKind, targetId: selection.targetId }]);
  const target = resolved.targets.get(`${selection.targetKind}:${selection.targetId}`);
  if (resolved.failed || !target) return answer(errorBlock("Alvo indisponível",
    "O item ou código comercial não está mais ativo. Gere uma nova prévia."));
  return createPreviewForTarget(target, selection.quantity, context);
}

type RpcReceipt = { movement_batch_id?: unknown; lines_processed?: unknown; total_quantity?: unknown; auto_assembled_quantity?: unknown };
type MovementRow = { item_id?: string; configuration_id?: string; quantity_change: number; quantity_before: number; quantity_after: number; created_at: string };

export async function confirmAssistantManualStockOutput(proposalToken: string): Promise<AssistantManualStockOutputConfirmationResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { block: errorBlock("Sessão expirada", "Entre novamente para confirmar a saída."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).eq("is_active", true).maybeSingle();
  if (!profile || !manualStockOutputProfileHasName(profile.name)) {
    return { block: errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma saída."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const verified = verifyManualStockOutputProposalToken(proposalToken,
    process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "", userId);
  if (!verified.ok) {
    const expired = verified.reason === "expired";
    return { block: errorBlock(expired ? "Prévia expirada" : "Confirmação inválida",
      expired ? "Gere uma nova prévia com os saldos atuais." : "A confirmação não é válida para esta ação.",
      expired ? "expired" : "error"), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const payload = verified.payload;
  const before = await loadManualStockOutputTargetsByIds(supabase, payload.lines);
  const targets = payload.lines.map((line) => before.targets.get(`${line.kind}:${line.targetId}`));
  if (before.failed || targets.some((target) => !target)) return { block: errorBlock("Alvo indisponível",
    "Um item ou código comercial não está mais ativo. Gere uma nova prévia."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  if (payload.lines.some((line, index) => line.quantity > targets[index]!.availableStock)) {
    return { block: errorBlock("Estoque insuficiente", "O saldo mudou e não atende mais à saída. Gere uma nova prévia."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const existingBatch = await supabase.from("movement_batches").select("id")
    .eq("user_id", userId).eq("idempotency_key", payload.idempotencyKey).maybeSingle();
  const { data, error } = await supabase.rpc("stock_outbound_items", {
    p_lines: payload.lines.map((line) => line.kind === "ITEM"
      ? { kind: "ITEM", item_id: line.targetId, quantity: line.quantity }
      : { kind: "COMMERCIAL_CODE", commercial_code_id: line.targetId, quantity: line.quantity }),
    p_idempotency_key: payload.idempotencyKey,
    p_description: ASSISTANT_MANUAL_STOCK_OUTPUT_DESCRIPTION,
  });
  if (error) {
    const message = error.message.toLowerCase();
    const safeMessage = message.includes("idempotency") || message.includes("different")
      ? "Esta chave já foi usada com dados diferentes. Gere uma nova prévia."
      : message.includes("insufficient") || message.includes("saldo") || message.includes("stock")
        ? "O saldo disponível mudou. Gere uma nova prévia."
        : message.includes("inactive") || message.includes("does not exist")
          ? "O item ou código comercial não está mais disponível. Gere uma nova prévia."
          : "Não foi possível registrar a saída manual agora.";
    return { block: errorBlock("Saída não registrada", safeMessage), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const receipt = data as RpcReceipt;
  const batchId = typeof receipt?.movement_batch_id === "string" && uuidPattern.test(receipt.movement_batch_id) ? receipt.movement_batch_id : null;
  const linesProcessed = typeof receipt?.lines_processed === "number" && Number.isSafeInteger(receipt.lines_processed) ? receipt.lines_processed : payload.lines.length;
  const totalQuantity = typeof receipt?.total_quantity === "number" && Number.isSafeInteger(receipt.total_quantity)
    ? receipt.total_quantity : payload.lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalAutoAssemblyQuantity = typeof receipt?.auto_assembled_quantity === "number" && Number.isSafeInteger(receipt.auto_assembled_quantity)
    ? receipt.auto_assembled_quantity : 0;
  const block: AssistantManualStockOutputResultBlock = {
    kind: "manual_stock_output_result", action: "manual_stock_output", outcome: "success", title: "Saída manual concluída",
    message: "A saída manual foi registrada no Estoque.", lines: [], linesProcessed, totalQuantity,
    totalAutoAssemblyQuantity, occurredAt: null, reference: batchId,
    idempotentReplay: Boolean(existingBatch.data?.id && existingBatch.data.id === batchId),
    actions: [{ kind: "link", label: "Abrir no Estoque", href: "/estoque" },
      { kind: "link", label: "Abrir Histórico", href: "/historico" }],
  };
  if (!batchId) {
    block.refreshWarning = true;
    block.message += " Atualize a página para conferir os detalhes.";
    return { block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  try {
    const [stockMovementsResult, configurationMovementsResult] = await Promise.all([
      supabase.from("stock_movements").select("item_id, quantity_change, quantity_before, quantity_after, created_at").eq("batch_id", batchId),
      supabase.from("configuration_stock_movements").select("configuration_id, quantity_change, quantity_before, quantity_after, created_at").eq("batch_id", batchId),
    ]);
    if (stockMovementsResult.error || configurationMovementsResult.error) throw new Error("refresh_failed");
    const stockMovements = (stockMovementsResult.data ?? []) as MovementRow[];
    const configurationMovements = (configurationMovementsResult.data ?? []) as MovementRow[];
    block.lines = payload.lines.map((line, index) => {
      const target = targets[index]!;
      if (line.kind === "ITEM") {
        const movement = stockMovements.find((row) => row.item_id === line.targetId && row.quantity_change === -line.quantity);
        if (!movement) throw new Error("refresh_mismatch");
        return { target,
          outputQuantity: line.quantity, previousStock: movement.quantity_before, currentStock: movement.quantity_after,
          autoAssembledQuantity: 0 };
      }
      const movements = configurationMovements.filter((row) => row.configuration_id === target.configurationId);
      const outbound = movements.find((row) => row.quantity_change === -line.quantity);
      const assembly = movements.find((row) => row.quantity_change > 0);
      if (!outbound) throw new Error("refresh_mismatch");
      const autoAssembledQuantity = assembly?.quantity_change ?? 0;
      return { target, outputQuantity: line.quantity,
        previousStock: assembly?.quantity_before ?? outbound.quantity_before, currentStock: outbound.quantity_after,
        autoAssembledQuantity };
    });
    block.occurredAt = [...stockMovements, ...configurationMovements][0]?.created_at ?? null;
  } catch {
    block.refreshWarning = true;
    block.message += " A operação foi concluída, mas os detalhes não puderam ser atualizados agora.";
  }
  return { block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

export function addManualStockOutputRefreshWarning(result: AssistantManualStockOutputConfirmationResult) {
  if (result.block.outcome !== "success") return result;
  return { ...result, block: { ...result.block, refreshWarning: true,
    message: `${result.block.message} Atualize a página para conferir os dados mais recentes.` } };
}
