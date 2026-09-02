import "server-only";

import { randomUUID } from "node:crypto";
import type {
  AssistantChatSuccess,
  AssistantClarificationBlock,
  AssistantManualStockOutputConfirmationResult,
  AssistantManualStockOutputPreviewBlock,
  AssistantManualStockOutputResultBlock,
  AssistantManualStockBatchSelectionLine,
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
  type ManualStockOutputBatchLineRequest,
  type ManualStockOutputRequest,
} from "@/lib/ai/manual-stock-output-routing";
import {
  loadManualStockOutputTargetsByIds,
  resolveManualStockOutputTargets,
} from "@/lib/assistant-stock-output-data";
import { createClient } from "@/lib/supabase/server";
import { normalizeServoModel } from "@/lib/servo-model-search";
import {
  consolidateResolvedManualStockLines,
  requiresManualStockIdentityChoice,
} from "@/lib/ai/manual-stock-list-routing.mjs";
import {
  buildOutboundPreview,
  type OutboundPreviewInputLine,
} from "@/lib/outbound-preview";
import type { OutboundCatalogOption } from "@/lib/outbound-types";

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

type ManualStockOutputBatchSelection = Extract<
  AssistantStockOutputSelection,
  { action: "manual_stock_output_batch" }
>;

function createOutputBatchSelection(
  lines: AssistantManualStockBatchSelectionLine[],
): ManualStockOutputBatchSelection {
  return { action: "manual_stock_output_batch", lines };
}

function updateOutputBatchLine(
  lines: AssistantManualStockBatchSelectionLine[],
  index: number,
  update: Partial<AssistantManualStockBatchSelectionLine>,
) {
  return lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...update } : line);
}

function toOutboundCatalogOption(
  target: AssistantStockOutputTarget,
): OutboundCatalogOption | null {
  if (target.kind === "ITEM") {
    const itemType = target.typeLabel === "Servo"
      ? "SERVO"
      : target.typeLabel === "Kit de instalação"
        ? "INSTALLATION_KIT"
        : target.typeLabel === "Kit de reparo"
          ? "REPAIR_KIT"
          : "LOOSE_PART";

    return {
      kind: "ITEM",
      id: target.targetId,
      code: target.displayCode,
      description: target.description,
      itemType,
      model: null,
      balance: target.currentStock,
    };
  }

  if (!target.configurationId || !target.servo || !target.installationKit) {
    return null;
  }

  return {
    kind: "COMMERCIAL_CODE",
    commercialCodeId: target.targetId,
    code: target.displayCode,
    configurationId: target.configurationId,
    description: target.description,
    imageUrl: null,
    assembledBalance: target.currentStock,
    aliases: target.aliases,
    servo: {
      id: target.servo.id,
      code: target.servo.code,
      description: target.servo.description,
      balance: target.servo.currentStock,
      model: null,
    },
    installationKit: {
      id: target.installationKit.id,
      code: target.installationKit.code,
      description: target.installationKit.description,
      balance: target.installationKit.currentStock,
    },
  };
}

function buildManualStockOutputBatchProjection(
  lines: Array<{ target: AssistantStockOutputTarget; quantity: number }>,
) {
  const previewInput: OutboundPreviewInputLine[] = [];
  for (const line of lines) {
    const option = toOutboundCatalogOption(line.target);
    if (!option) return null;
    previewInput.push({ option, quantity: line.quantity });
  }
  return buildOutboundPreview(previewInput);
}

function createOutputBatchIdentityClarification(
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
        id: `output-batch-${index + 1}-item`,
        label: "Servo sem kit",
        prompt: `Definir ${displayQuery} como Servo sem kit`,
        category: "inventory",
        stockOutputSelection: createOutputBatchSelection(updateOutputBatchLine(lines, index, {
          requestedIdentity: "ITEM",
          requiresIdentityChoice: false,
        })),
      },
      {
        id: `output-batch-${index + 1}-configuration`,
        label: "Servo com kit",
        prompt: `Definir ${displayQuery} como Servo com kit`,
        category: "inventory",
        stockOutputSelection: createOutputBatchSelection(updateOutputBatchLine(lines, index, {
          requestedIdentity: "COMMERCIAL_CODE",
          requiresIdentityChoice: false,
        })),
      },
      { id: "output-cancel", label: "Cancelar", prompt: "Cancelar esta saída.", category: "inventory" },
    ],
    fallbackText: "Escolha o tipo desse item para continuar revisando a lista.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

function createOutputBatchTargetClarification(
  lines: AssistantManualStockBatchSelectionLine[],
  index: number,
  targets: AssistantStockOutputTarget[],
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
        id: `output-batch-${index + 1}-target-${targetIndex + 1}`,
        label: `Cód. ${target.aliases.join(" / ") || target.displayCode}`.slice(0, 60),
        prompt: `Definir produto · Cód. ${target.displayCode}`,
        description: target.description.slice(0, 180),
        category: "inventory" as const,
        stockOutputSelection: createOutputBatchSelection(updateOutputBatchLine(lines, index, {
          targetId: target.targetId,
          targetKind: target.kind,
          requiresIdentityChoice: false,
        })),
      })),
      { id: "output-cancel", label: "Cancelar", prompt: "Cancelar esta saída.", category: "inventory" as const },
    ],
    fallbackText: "Escolha o produto correto para continuar revisando a lista.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

async function createManualStockOutputBatchPreview(
  lines: AssistantManualStockBatchSelectionLine[],
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (!uuidPattern.test(context.userId) || !manualStockOutputProfileHasName(context.profileName)) {
    return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma saída."));
  }

  const identityIndex = lines.findIndex((line) =>
    !line.targetId && (
      line.requiresIdentityChoice ||
      requiresManualStockIdentityChoice(line.targetQuery, line.requestedIdentity)
    ));
  if (identityIndex >= 0) return createOutputBatchIdentityClarification(lines, identityIndex);

  const supabase = await createClient();
  const selectedLineMap = new Map<string, { kind: "ITEM" | "COMMERCIAL_CODE"; targetId: string }>();
  lines.filter((line) => line.targetId && line.targetKind).forEach((line) => {
    selectedLineMap.set(`${line.targetKind}:${line.targetId}`, { kind: line.targetKind!, targetId: line.targetId! });
  });
  const selectedLines = Array.from(selectedLineMap.values());
  const selected = selectedLines.length
    ? await loadManualStockOutputTargetsByIds(supabase, selectedLines)
    : { targets: new Map<string, AssistantStockOutputTarget>(), failed: false };
  const unresolved = await Promise.all(lines.filter((line) => !line.targetId).map((line) =>
    resolveManualStockOutputTargets(supabase, line.targetQuery, line.requestedIdentity)));
  if (selected.failed || unresolved.some((result) => result.failed)) {
    return answer(errorBlock("Consulta indisponível", "Não foi possível validar todos os itens da lista agora. Nenhuma saída foi executada."));
  }

  let unresolvedIndex = 0;
  const resolvedTargets: AssistantStockOutputTarget[] = [];
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
      return answer(errorBlock("Item não encontrado", `Não encontrei o item ${index + 1}, ${line.targetQuery}. A lista inteira foi bloqueada e nenhuma saída foi executada.`));
    }
    if (result.targets.length > 1) return createOutputBatchTargetClarification(lines, index, result.targets);
    resolvedTargets.push(result.targets[0]);
  }

  const consolidatedLines = consolidateResolvedManualStockLines(lines.map((line, index) => {
    const target = resolvedTargets[index];
    return {
      identityKey: target.kind === "COMMERCIAL_CODE" ? `CONFIG:${target.configurationId ?? target.targetId}` : `ITEM:${target.targetId}`,
      target,
      quantity: line.quantity,
    };
  }));
  if (!consolidatedLines.length) return answer(errorBlock("Lista inválida", "As quantidades da lista excedem o limite seguro. Nenhuma saída foi executada."));
  const batchProjection = buildManualStockOutputBatchProjection(consolidatedLines);
  if (!batchProjection) {
    return answer(errorBlock("Consulta indisponível", "Não foi possível validar todos os componentes da lista agora. Nenhuma saída foi executada."));
  }
  if (!batchProjection.isValid) {
    return answer(errorBlock(
      "Estoque insuficiente",
      `${batchProjection.errors[0] ?? "O estoque não atende a lista informada."} A lista inteira foi bloqueada e nenhuma saída foi executada.`,
    ));
  }
  const itemProjectionById = new Map(batchProjection.itemLines.map((line) => [line.option.id, line]));
  const commercialProjectionById = new Map(
    batchProjection.commercialLines.map((line) => [line.option.commercialCodeId, line]),
  );
  const resolvedLines = consolidatedLines.map(({ target, quantity }) => {
    if (target.kind === "ITEM") {
      const projection = itemProjectionById.get(target.targetId);
      return {
        target,
        quantity,
        projection: {
          estimatedStockAfter: projection?.predictedBalance ?? target.currentStock - quantity,
          autoAssembledQuantity: 0,
        },
      };
    }
    const projection = commercialProjectionById.get(target.targetId);
    const autoAssembledQuantity = projection?.autoAssembledQuantity ?? 0;
    return {
      target,
      quantity,
      projection: {
        estimatedStockAfter: target.currentStock + autoAssembledQuantity - quantity,
        autoAssembledQuantity,
      },
    };
  });

  const signed = createManualStockOutputProposalToken({
    userId: context.userId,
    lines: resolvedLines.map(({ target, quantity }) => ({ kind: target.kind, targetId: target.targetId, quantity })),
    idempotencyKey: randomUUID(),
  }, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "");
  if (!signed) return answer(errorBlock("Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada."));

  const totalQuantity = resolvedLines.reduce((sum, line) => sum + line.quantity, 0);
  const totalAutoAssemblyQuantity = resolvedLines.reduce((sum, line) => sum + line.projection.autoAssembledQuantity, 0);
  const regeneratePrompt = `Saída manual:\n${resolvedLines.map(({ target, quantity }) => `${quantity} do ${target.displayCode}`).join("\n")}`;
  const block: AssistantManualStockOutputPreviewBlock = {
    kind: "manual_stock_output_preview",
    action: "manual_stock_output",
    state: "pending",
    title: "Confirmar saída manual",
    message: "Revise todos os itens. Os saldos serão relidos antes de aplicar o lote inteiro.",
    proposalToken: signed.token,
    expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(),
    lines: resolvedLines.map(({ target, quantity, projection }) => ({
      target,
      outputQuantity: quantity,
      estimatedStockAfter: projection.estimatedStockAfter,
      autoAssembledQuantity: projection.autoAssembledQuantity,
    })),
    totalQuantity,
    totalAutoAssemblyQuantity,
    confirmLabel: "Confirmar saída",
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

export function createAssistantManualStockOutputBatchPreview(
  requests: ManualStockOutputBatchLineRequest[],
  context: { userId: string; profileName: string | null },
) {
  return createManualStockOutputBatchPreview(requests.map((request) => ({
    quantity: request.quantity,
    targetQuery: request.targetQuery,
    requestedIdentity: request.requestedIdentity,
    targetId: null,
    targetKind: null,
    requiresIdentityChoice: request.requiresIdentityChoice,
  })), context);
}

export function createAssistantManualStockOutputBatchPreviewFromSelection(
  selection: ManualStockOutputBatchSelection,
  context: { userId: string; profileName: string | null },
) {
  return createManualStockOutputBatchPreview(selection.lines, context);
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
  selection: Exclude<AssistantStockOutputSelection, { action: "manual_stock_output_batch" }>,
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
  const currentProjection = buildManualStockOutputBatchProjection(
    payload.lines.map((line, index) => ({ target: targets[index]!, quantity: line.quantity })),
  );
  if (!currentProjection || !currentProjection.isValid) {
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
