import "server-only";

import { randomUUID } from "node:crypto";
import type {
  AssistantChatSuccess,
  AssistantClarificationBlock,
  AssistantManualStockEntryConfirmationResult,
  AssistantManualStockEntryPreviewBlock,
  AssistantManualStockBatchSelectionLine,
  AssistantManualStockEntryResultBlock,
  AssistantStockEntrySelection,
  AssistantStockEntryTarget,
} from "@/lib/assistant-types";
import { createManualStockEntryProposalToken, verifyManualStockEntryProposalToken } from "@/lib/ai/stock-entry-action-tokens";
import {
  createManualStockEntryIdentitySelection,
  type ManualStockEntryBatchLineRequest,
  type ManualStockEntryRequest,
} from "@/lib/ai/manual-stock-entry-routing";
import { loadManualStockEntryTargetsByIds, resolveManualStockEntryTargets } from "@/lib/assistant-stock-entry-data";
import { createClient } from "@/lib/supabase/server";
import { ASSISTANT_MANUAL_STOCK_ENTRY_DESCRIPTION } from "@/lib/ai/manual-stock-entry-contract";
import { normalizeServoModel } from "@/lib/servo-model-search";
import {
  consolidateResolvedManualStockLines,
  requiresManualStockIdentityChoice,
} from "@/lib/ai/manual-stock-list-routing.mjs";

export { ASSISTANT_MANUAL_STOCK_ENTRY_DESCRIPTION };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorBlock(title: string, message: string, outcome: AssistantManualStockEntryResultBlock["outcome"] = "error"): AssistantManualStockEntryResultBlock {
  return { kind: "manual_stock_entry_result", action: "manual_stock_entry", outcome, title, message,
    lines: [], linesProcessed: 0, totalQuantity: 0, occurredAt: null, reference: null,
    idempotentReplay: false, actions: [] };
}
function answer(block: AssistantManualStockEntryResultBlock): AssistantChatSuccess {
  return { message: block.message, structuredBlock: block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

export function createManualStockEntryAmbiguity(quantity: number, targetQuery: string): AssistantChatSuccess {
  const normalizedModel = normalizeServoModel(targetQuery);
  const displayQuery = normalizedModel
    ? normalizedModel.replace(/^([A-Z]+)(\d+)$/, "$1-$2")
    : targetQuery;
  const itemSelection = createManualStockEntryIdentitySelection(targetQuery, quantity, "ITEM")!;
  const configurationSelection = createManualStockEntryIdentitySelection(targetQuery, quantity, "COMMERCIAL_CODE")!;
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification", title: "Qual tipo de entrada deseja registrar?",
    message: `${displayQuery} pode representar um Servo sem kit, um Servo com kit ou uma entrada vinculada a Pedido.`,
    options: [
      { id: "manual-item", label: "Entrada manual · Servo sem kit", prompt: `Selecionar Servo sem kit · ${displayQuery}`,
        category: "inventory", stockEntrySelection: itemSelection },
      { id: "manual-box", label: "Entrada manual · Servo com kit", prompt: `Selecionar Servo com kit · ${displayQuery}`,
        category: "inventory", stockEntrySelection: configurationSelection },
      { id: "order-entry", label: "Entrada vinculada a Pedido", prompt: "Selecionar entrada vinculada a Pedido",
        category: "supplier_orders", stockEntrySelection: { action: "supplier_order_stock_entry_flow", targetQuery, quantity } },
      { id: "entry-cancel", label: "Cancelar", prompt: "Cancelar esta entrada.", category: "inventory" },
    ], fallbackText: "Escolha o tipo de entrada antes de continuar.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

function createManualStockEntryTargetClarification(
  quantity: number,
  targets: AssistantStockEntryTarget[],
): AssistantChatSuccess {
  const visibleTargets = targets.slice(0, 5);
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification",
    title: "Qual Servo com kit deseja selecionar?",
    message: targets.length > visibleTargets.length
      ? "Há várias configurações físicas para esse modelo. Escolha uma das opções ou informe o Cód. exato."
      : "Há mais de uma configuração física para esse modelo. Escolha uma opção.",
    options: [
      ...visibleTargets.map((target, index) => {
        const aliases = target.aliases.join(" / ") || target.displayCode;
        return {
          id: `manual-target-${index + 1}`,
          label: `Servo com kit · Cód. ${aliases}`.slice(0, 60),
          prompt: `Selecionar Servo com kit · Cód. ${aliases}`,
          description: target.description.slice(0, 180),
          category: "inventory" as const,
          stockEntrySelection: {
            action: "manual_stock_entry_target" as const,
            targetId: target.targetId,
            targetKind: target.kind,
            quantity,
          },
        };
      }),
      { id: "entry-cancel", label: "Cancelar", prompt: "Cancelar esta entrada.", category: "inventory" as const },
    ],
    fallbackText: "Escolha a configuração física antes de continuar.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

function createManualStockEntryPreviewForTarget(
  target: AssistantStockEntryTarget,
  quantity: number,
  context: { userId: string; profileName: string | null },
): AssistantChatSuccess {
  const signed = createManualStockEntryProposalToken({ userId: context.userId,
    lines: [{ kind: target.kind, targetId: target.targetId, quantity }],
    idempotencyKey: randomUUID() }, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "");
  if (!signed) return answer(errorBlock("Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada."));
  const block: AssistantManualStockEntryPreviewBlock = {
    kind: "manual_stock_entry_preview", action: "manual_stock_entry", state: "pending",
    title: "Confirmar entrada manual", message: "O saldo atual será relido antes de aplicar o mesmo delta positivo.",
    proposalToken: signed.token, expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(),
    lines: [{ target, entryQuantity: quantity, estimatedStockAfter: target.currentStock + quantity }],
    totalQuantity: quantity, confirmLabel: "Confirmar entrada", cancelLabel: "Cancelar",
    regeneratePrompt: `Entrada manual de ${quantity} unidade${quantity === 1 ? "" : "s"} do Cód. ${target.displayCode}.`,
  };
  return { message: block.message, structuredBlock: block, contextItemQuery: target.displayCode,
    contextItemReferenceKind: "CATALOG_CODE",
    contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

type ManualStockEntryBatchSelection = Extract<
  AssistantStockEntrySelection,
  { action: "manual_stock_entry_batch" }
>;

function createEntryBatchSelection(
  lines: AssistantManualStockBatchSelectionLine[],
): ManualStockEntryBatchSelection {
  return { action: "manual_stock_entry_batch", lines };
}

function updateEntryBatchLine(
  lines: AssistantManualStockBatchSelectionLine[],
  index: number,
  update: Partial<AssistantManualStockBatchSelectionLine>,
) {
  return lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...update } : line);
}

function createEntryBatchIdentityClarification(
  lines: AssistantManualStockBatchSelectionLine[],
  index: number,
): AssistantChatSuccess {
  const line = lines[index];
  const displayQuery = normalizeServoModel(line.targetQuery)?.replace(/^([A-Z]+)(\d+)$/, "$1-$2") || line.targetQuery;
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification",
    title: `Defina o tipo do item ${index + 1}`,
    message: `${displayQuery} pode representar um Servo sem kit ou um Servo com kit. A lista inteira continuará em revisão.`,
    options: [
      {
        id: `entry-batch-${index + 1}-item`,
        label: "Servo sem kit",
        prompt: `Definir ${displayQuery} como Servo sem kit`,
        category: "inventory",
        stockEntrySelection: createEntryBatchSelection(updateEntryBatchLine(lines, index, {
          requestedIdentity: "ITEM",
          requiresIdentityChoice: false,
        })),
      },
      {
        id: `entry-batch-${index + 1}-configuration`,
        label: "Servo com kit",
        prompt: `Definir ${displayQuery} como Servo com kit`,
        category: "inventory",
        stockEntrySelection: createEntryBatchSelection(updateEntryBatchLine(lines, index, {
          requestedIdentity: "COMMERCIAL_CODE",
          requiresIdentityChoice: false,
        })),
      },
      { id: "entry-cancel", label: "Cancelar", prompt: "Cancelar esta entrada.", category: "inventory" },
    ],
    fallbackText: "Escolha o tipo desse item para continuar revisando a lista.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

function createEntryBatchTargetClarification(
  lines: AssistantManualStockBatchSelectionLine[],
  index: number,
  targets: AssistantStockEntryTarget[],
): AssistantChatSuccess {
  const visibleTargets = targets.slice(0, 5);
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification",
    title: `Defina o produto do item ${index + 1}`,
    message: targets.length > visibleTargets.length
      ? `Há ${targets.length} resultados para ${lines[index].targetQuery}. Escolha uma das opções visíveis ou envie a lista novamente com o Cód. exato.`
      : `Há mais de um resultado para ${lines[index].targetQuery}. Escolha o produto correto para continuar.`,
    options: [
      ...visibleTargets.map((target, targetIndex) => ({
        id: `entry-batch-${index + 1}-target-${targetIndex + 1}`,
        label: `Cód. ${target.aliases.join(" / ") || target.displayCode}`.slice(0, 60),
        prompt: `Definir produto · Cód. ${target.displayCode}`,
        description: target.description.slice(0, 180),
        category: "inventory" as const,
        stockEntrySelection: createEntryBatchSelection(updateEntryBatchLine(lines, index, {
          targetId: target.targetId,
          targetKind: target.kind,
          requiresIdentityChoice: false,
        })),
      })),
      { id: "entry-cancel", label: "Cancelar", prompt: "Cancelar esta entrada.", category: "inventory" as const },
    ],
    fallbackText: "Escolha o produto correto para continuar revisando a lista.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

async function createManualStockEntryBatchPreview(
  lines: AssistantManualStockBatchSelectionLine[],
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (!uuidPattern.test(context.userId) || !context.profileName?.trim()) {
    return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma entrada."));
  }

  const identityIndex = lines.findIndex((line) =>
    !line.targetId && (
      line.requiresIdentityChoice ||
      requiresManualStockIdentityChoice(line.targetQuery, line.requestedIdentity)
    ));
  if (identityIndex >= 0) return createEntryBatchIdentityClarification(lines, identityIndex);

  const supabase = await createClient();
  const selectedLineMap = new Map<string, { kind: "ITEM" | "COMMERCIAL_CODE"; targetId: string }>();
  lines.filter((line) => line.targetId && line.targetKind).forEach((line) => {
    selectedLineMap.set(`${line.targetKind}:${line.targetId}`, { kind: line.targetKind!, targetId: line.targetId! });
  });
  const selectedLines = Array.from(selectedLineMap.values());
  const selected = selectedLines.length
    ? await loadManualStockEntryTargetsByIds(supabase, selectedLines)
    : { targets: new Map<string, AssistantStockEntryTarget>(), failed: false };
  const unresolved = await Promise.all(lines.filter((line) => !line.targetId).map((line) =>
    resolveManualStockEntryTargets(supabase, line.targetQuery, line.requestedIdentity)));
  if (selected.failed || unresolved.some((result) => result.failed)) {
    return answer(errorBlock("Consulta indisponível", "Não foi possível validar todos os itens da lista agora. Nenhuma entrada foi executada."));
  }

  let unresolvedIndex = 0;
  const resolvedTargets: AssistantStockEntryTarget[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.targetId && line.targetKind) {
      const target = selected.targets.get(`${line.targetKind}:${line.targetId}`);
      if (!target) return answer(errorBlock("Alvo indisponível", `O item ${index + 1} não está mais ativo. A lista inteira foi bloqueada.`));
      resolvedTargets.push(target);
      continue;
    }
    const result = unresolved[unresolvedIndex++];
    if (!result.targets.length) {
      return answer(errorBlock("Item não encontrado", `Não encontrei o item ${index + 1}, ${line.targetQuery}. A lista inteira foi bloqueada e nenhuma entrada foi executada.`));
    }
    if (result.targets.length > 1) return createEntryBatchTargetClarification(lines, index, result.targets);
    resolvedTargets.push(result.targets[0]);
  }

  const resolvedLines = consolidateResolvedManualStockLines(lines.map((line, index) => {
    const target = resolvedTargets[index];
    return {
      identityKey: target.kind === "COMMERCIAL_CODE" ? `CONFIG:${target.configurationId ?? target.targetId}` : `ITEM:${target.targetId}`,
      target,
      quantity: line.quantity,
    };
  }));
  if (!resolvedLines.length) return answer(errorBlock("Lista inválida", "As quantidades da lista excedem o limite seguro. Nenhuma entrada foi executada."));
  const signed = createManualStockEntryProposalToken({
    userId: context.userId,
    lines: resolvedLines.map(({ target, quantity }) => ({ kind: target.kind, targetId: target.targetId, quantity })),
    idempotencyKey: randomUUID(),
  }, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "");
  if (!signed) return answer(errorBlock("Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada."));

  const totalQuantity = resolvedLines.reduce((sum, line) => sum + line.quantity, 0);
  const regeneratePrompt = `Entrada manual:\n${resolvedLines.map(({ target, quantity }) => `${quantity} do ${target.displayCode}`).join("\n")}`;
  const block: AssistantManualStockEntryPreviewBlock = {
    kind: "manual_stock_entry_preview",
    action: "manual_stock_entry",
    state: "pending",
    title: "Confirmar entrada manual",
    message: "Revise todos os itens. Os saldos atuais serão relidos antes de aplicar o lote inteiro.",
    proposalToken: signed.token,
    expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(),
    lines: resolvedLines.map(({ target, quantity }) => ({
      target,
      entryQuantity: quantity,
      estimatedStockAfter: target.currentStock + quantity,
    })),
    totalQuantity,
    confirmLabel: "Confirmar entrada",
    cancelLabel: "Cancelar",
    regeneratePrompt,
  };
  return {
    message: block.message,
    structuredBlock: block,
    contextItemQuery: null,
    contextItemReferenceKind: null,
    contextSupplierOrderId: null,
    contextSupplierOrderCatalogCode: null,
  };
}

export function createAssistantManualStockEntryBatchPreview(
  requests: ManualStockEntryBatchLineRequest[],
  context: { userId: string; profileName: string | null },
) {
  return createManualStockEntryBatchPreview(requests.map((request) => ({
    quantity: request.quantity,
    targetQuery: request.targetQuery,
    requestedIdentity: request.requestedIdentity,
    targetId: null,
    targetKind: null,
    requiresIdentityChoice: request.requiresIdentityChoice,
  })), context);
}

export function createAssistantManualStockEntryBatchPreviewFromSelection(
  selection: ManualStockEntryBatchSelection,
  context: { userId: string; profileName: string | null },
) {
  return createManualStockEntryBatchPreview(selection.lines, context);
}

export async function createAssistantManualStockEntryPreview(
  request: ManualStockEntryRequest,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (!uuidPattern.test(context.userId) || !context.profileName?.trim()) {
    return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma entrada."));
  }
  const supabase = await createClient();
  const resolved = await resolveManualStockEntryTargets(supabase, request.targetQuery, request.requestedIdentity);
  if (resolved.failed) return answer(errorBlock("Consulta indisponível", "Não foi possível localizar o item agora."));
  if (resolved.targets.length === 0) return answer(errorBlock("Item não encontrado", `Não encontrei um item ativo com o código ou modelo ${request.targetQuery}. Nenhuma peça nova foi criada.`));
  if (resolved.targets.length > 1) {
    return request.requestedIdentity === null
      ? createManualStockEntryAmbiguity(request.quantity, request.targetQuery)
      : createManualStockEntryTargetClarification(request.quantity, resolved.targets);
  }
  const target = resolved.targets[0];
  return createManualStockEntryPreviewForTarget(target, request.quantity, context);
}

export async function createAssistantManualStockEntryPreviewFromSelection(
  selection: Extract<AssistantStockEntrySelection, { action: "manual_stock_entry_target" }>,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (!uuidPattern.test(context.userId) || !context.profileName?.trim()) {
    return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma entrada."));
  }
  const supabase = await createClient();
  const resolved = await loadManualStockEntryTargetsByIds(supabase, [{
    kind: selection.targetKind,
    targetId: selection.targetId,
  }]);
  const target = resolved.targets.get(`${selection.targetKind}:${selection.targetId}`);
  if (resolved.failed || !target) {
    return answer(errorBlock("Alvo indisponível", "O item ou código comercial não está mais ativo. Gere uma nova prévia."));
  }
  return createManualStockEntryPreviewForTarget(target, selection.quantity, context);
}

type RpcReceipt = { movement_batch_id?: unknown; lines_processed?: unknown; total_quantity?: unknown; commercial_quantity?: unknown };
type MovementRow = { item_id?: string; configuration_id?: string; quantity_change: number; quantity_before: number; quantity_after: number; created_at: string };

async function loadTargetsByToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lines: Array<{ kind: "ITEM" | "COMMERCIAL_CODE"; targetId: string; quantity: number }>,
) {
  const resolved = await loadManualStockEntryTargetsByIds(supabase, lines);
  return {
    targets: lines.map((line) => resolved.targets.get(`${line.kind}:${line.targetId}`)!),
    failed: resolved.failed || lines.some((line) => !resolved.targets.has(`${line.kind}:${line.targetId}`)),
  };
}

export async function confirmAssistantManualStockEntry(proposalToken: string): Promise<AssistantManualStockEntryConfirmationResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { block: errorBlock("Sessão expirada", "Entre novamente para confirmar a entrada."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).eq("is_active", true).maybeSingle();
  if (!profile || typeof profile.name !== "string" || !profile.name.trim()) {
    return { block: errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma entrada."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const verified = verifyManualStockEntryProposalToken(proposalToken, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "", userId);
  if (!verified.ok) {
    const expired = verified.reason === "expired";
    return { block: errorBlock(expired ? "Prévia expirada" : "Confirmação inválida", expired ? "Gere uma nova prévia com o saldo atual." : "A confirmação não é válida para esta ação.", expired ? "expired" : "error"), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const payload = verified.payload;
  const before = await loadTargetsByToken(supabase, payload.lines);
  if (before.failed) return { block: errorBlock("Alvo indisponível", "Um item ou código comercial não está mais ativo. Gere uma nova prévia."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const existingBatch = await supabase.from("movement_batches").select("id")
    .eq("user_id", userId).eq("idempotency_key", payload.idempotencyKey).maybeSingle();
  const { data, error } = await supabase.rpc("stock_inbound_lines", {
    p_lines: payload.lines.map((line) => line.kind === "ITEM"
      ? { kind: "ITEM", item_id: line.targetId, quantity: line.quantity }
      : { kind: "COMMERCIAL_CODE", commercial_code_id: line.targetId, quantity: line.quantity }),
    p_idempotency_key: payload.idempotencyKey,
    p_description: ASSISTANT_MANUAL_STOCK_ENTRY_DESCRIPTION,
  });
  if (error) {
    const message = error.message.toLowerCase();
    const safeMessage = message.includes("idempotency") || message.includes("different")
      ? "Esta chave já foi usada com dados diferentes. Gere uma nova prévia."
      : message.includes("inactive") || message.includes("does not exist")
        ? "O item ou código comercial não está mais disponível. Gere uma nova prévia."
        : "Não foi possível registrar a entrada manual agora.";
    return { block: errorBlock("Entrada não registrada", safeMessage), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const receipt = data as RpcReceipt;
  const batchId = typeof receipt?.movement_batch_id === "string" && uuidPattern.test(receipt.movement_batch_id) ? receipt.movement_batch_id : null;
  const linesProcessed = typeof receipt?.lines_processed === "number" && Number.isSafeInteger(receipt.lines_processed) ? receipt.lines_processed : payload.lines.length;
  const totalQuantity = typeof receipt?.total_quantity === "number" && Number.isSafeInteger(receipt.total_quantity) ? receipt.total_quantity : payload.lines.reduce((sum, line) => sum + line.quantity, 0);
  const block: AssistantManualStockEntryResultBlock = { kind: "manual_stock_entry_result", action: "manual_stock_entry", outcome: "success",
    title: "Entrada manual concluída", message: "A entrada manual foi registrada no Estoque.", lines: [], linesProcessed,
    totalQuantity, occurredAt: null, reference: batchId,
    idempotentReplay: Boolean(existingBatch.data?.id && existingBatch.data.id === batchId),
    actions: [{ kind: "link", label: "Abrir no Estoque", href: "/estoque" }, { kind: "link", label: "Abrir Histórico", href: "/historico" }] };
  if (!batchId) {
    block.refreshWarning = true;
    block.message += " Atualize a página para conferir os detalhes.";
    return { block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  try {
    const [stockMovements, configurationMovements] = await Promise.all([
      supabase.from("stock_movements").select("item_id, quantity_change, quantity_before, quantity_after, created_at").eq("batch_id", batchId),
      supabase.from("configuration_stock_movements").select("configuration_id, quantity_change, quantity_before, quantity_after, created_at").eq("batch_id", batchId),
    ]);
    if (stockMovements.error || configurationMovements.error) throw new Error("refresh_failed");
    const movementByTarget = new Map<string, MovementRow>();
    ((stockMovements.data ?? []) as MovementRow[]).forEach((row) => movementByTarget.set(`ITEM:${row.item_id}`, row));
    ((configurationMovements.data ?? []) as MovementRow[]).forEach((row) => movementByTarget.set(`CONFIG:${row.configuration_id}`, row));
    block.lines = payload.lines.map((line, index) => {
      const target = before.targets[index];
      const movement = movementByTarget.get(line.kind === "ITEM" ? `ITEM:${line.targetId}` : `CONFIG:${target.configurationId}`);
      if (!movement || movement.quantity_change !== line.quantity) throw new Error("refresh_mismatch");
      return { target: { ...target, currentStock: movement.quantity_after }, entryQuantity: line.quantity,
        previousStock: movement.quantity_before, currentStock: movement.quantity_after };
    });
    block.occurredAt = [...movementByTarget.values()][0]?.created_at ?? null;
  } catch {
    block.refreshWarning = true;
    block.message += " A operação foi concluída, mas os detalhes não puderam ser atualizados agora.";
  }
  return { block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

export function addManualStockEntryRefreshWarning(result: AssistantManualStockEntryConfirmationResult) {
  if (result.block.outcome !== "success") return result;
  return { ...result, block: { ...result.block, refreshWarning: true,
    message: `${result.block.message} Atualize a página para conferir os dados mais recentes.` } };
}
