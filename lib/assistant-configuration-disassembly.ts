import "server-only";

import { randomUUID } from "node:crypto";
import { disassembleCommercialConfiguration } from "@/app/(authenticated)/estoque/actions";
import type {
  AssistantChatSuccess,
  AssistantClarificationBlock,
  AssistantConfigurationDisassemblyConfirmationResult,
  AssistantConfigurationDisassemblyPreviewBlock,
  AssistantConfigurationDisassemblyResultBlock,
  AssistantConfigurationDisassemblySelection,
  AssistantConfigurationDisassemblyTarget,
} from "@/lib/assistant-types";
import {
  ASSISTANT_CONFIGURATION_DISASSEMBLY_DESCRIPTION,
  calculateConfigurationDisassemblyProjection,
  configurationDisassemblyProfileHasName,
} from "@/lib/ai/configuration-disassembly-contract";
import {
  createConfigurationDisassemblyProposalToken,
  verifyConfigurationDisassemblyProposalToken,
} from "@/lib/ai/configuration-disassembly-action-token";
import type { ConfigurationDisassemblyRequest } from "@/lib/ai/configuration-disassembly-routing";
import {
  loadConfigurationDisassemblyTargetByCodeId,
  resolveConfigurationDisassemblyTargets,
} from "@/lib/assistant-configuration-disassembly-data";
import { createClient } from "@/lib/supabase/server";

const maximumInteger = 2_147_483_647;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorBlock(
  title: string,
  message: string,
  outcome: AssistantConfigurationDisassemblyResultBlock["outcome"] = "error",
): AssistantConfigurationDisassemblyResultBlock {
  return {
    kind: "configuration_disassembly_result", action: "configuration_disassembly", outcome, title, message,
    target: null, quantity: 0, mountedStockBefore: null, mountedStockAfter: null,
    servoStockBefore: null, servoStockAfter: null, installationKitStockBefore: null,
    installationKitStockAfter: null, occurredAt: null, reference: null, idempotentReplay: false, actions: [],
  };
}

function answer(block: AssistantConfigurationDisassemblyResultBlock): AssistantChatSuccess {
  return { message: block.message, structuredBlock: block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

function createTargetClarification(quantity: number, targets: AssistantConfigurationDisassemblyTarget[]): AssistantChatSuccess {
  const visibleTargets = targets.slice(0, 5);
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification", title: "Qual Servo com kit deseja desmontar?",
    message: targets.length > visibleTargets.length
      ? "Há várias configurações físicas para esse modelo. Escolha uma opção ou informe o Cód. exato."
      : "Há mais de uma configuração física para esse modelo. Escolha uma opção.",
    options: [
      ...visibleTargets.map((target, index) => ({
        id: `disassembly-target-${index + 1}`,
        label: `Servo com kit · Cód. ${target.aliases.join(" / ") || target.displayCode}`.slice(0, 60),
        prompt: `Selecionar desmontagem · Cód. ${target.aliases.join(" / ") || target.displayCode}`,
        description: target.description.slice(0, 180), category: "inventory" as const,
        configurationDisassemblySelection: { action: "configuration_disassembly_target" as const,
          commercialCodeId: target.commercialCodeId, quantity },
      })),
      { id: "disassembly-cancel", label: "Cancelar", prompt: "Cancelar esta desmontagem.", category: "inventory" as const },
    ],
    fallbackText: "Escolha a configuração física antes de continuar.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

function createPreview(
  target: AssistantConfigurationDisassemblyTarget,
  quantity: number,
  context: { userId: string; profileName: string | null },
): AssistantChatSuccess {
  const projection = calculateConfigurationDisassemblyProjection(
    target.currentStock, target.servo.currentStock, target.installationKit.currentStock, quantity,
  );
  if (!projection.sufficient) {
    const overflow = projection.servoStockAfter > maximumInteger || projection.installationKitStockAfter > maximumInteger;
    return answer(errorBlock(
      overflow ? "Quantidade acima do limite" : "Saldo montado insuficiente",
      overflow
        ? "A desmontagem solicitada excede o limite permitido. Nenhuma desmontagem foi executada."
        : `O saldo montado atual é de ${target.currentStock} unidade${target.currentStock === 1 ? "" : "s"}. Nenhuma desmontagem foi executada.`,
    ));
  }
  const signed = createConfigurationDisassemblyProposalToken({
    userId: context.userId, commercialCodeId: target.commercialCodeId, configurationId: target.configurationId,
    quantity, idempotencyKey: randomUUID(),
  }, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "");
  if (!signed) return answer(errorBlock("Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada."));
  const block: AssistantConfigurationDisassemblyPreviewBlock = {
    kind: "configuration_disassembly_preview", action: "configuration_disassembly", state: "pending",
    title: "Confirmar desmontagem",
    message: "O saldo montado e os componentes serão relidos e validados pelo banco antes da desmontagem.",
    proposalToken: signed.token, expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(),
    target, quantity, mountedStockAfter: projection.mountedStockAfter, servoStockAfter: projection.servoStockAfter,
    installationKitStockAfter: projection.installationKitStockAfter, totalQuantity: quantity,
    confirmLabel: "Confirmar desmontagem", cancelLabel: "Cancelar",
    regeneratePrompt: `Desmonte ${quantity} unidade${quantity === 1 ? "" : "s"} do Cód. ${target.displayCode}.`,
  };
  return { message: block.message, structuredBlock: block, contextItemQuery: target.displayCode,
    contextItemReferenceKind: "CATALOG_CODE",
    contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

function profileError(context: { userId: string; profileName: string | null }) {
  return !uuidPattern.test(context.userId) || !configurationDisassemblyProfileHasName(context.profileName);
}

export async function createAssistantConfigurationDisassemblyPreview(
  request: ConfigurationDisassemblyRequest,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (profileError(context)) return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma desmontagem."));
  const supabase = await createClient();
  const resolved = await resolveConfigurationDisassemblyTargets(supabase, request.targetQuery);
  if (resolved.failed) return answer(errorBlock("Consulta indisponível", "Não foi possível localizar a configuração agora."));
  if (!resolved.targets.length) return answer(errorBlock("Configuração não encontrada",
    `Não encontrei um Servo com kit para ${request.targetQuery}. Nenhuma desmontagem foi executada.`));
  if (resolved.targets.length > 1) return createTargetClarification(request.quantity, resolved.targets);
  return createPreview(resolved.targets[0], request.quantity, context);
}

export async function createAssistantConfigurationDisassemblyPreviewFromSelection(
  selection: AssistantConfigurationDisassemblySelection,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (profileError(context)) return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma desmontagem."));
  const supabase = await createClient();
  const loaded = await loadConfigurationDisassemblyTargetByCodeId(supabase, selection.commercialCodeId);
  if (loaded.failed || !loaded.target) return answer(errorBlock("Configuração indisponível", "O Servo com kit não está mais disponível. Gere uma nova prévia."));
  return createPreview(loaded.target, selection.quantity, context);
}

export async function confirmAssistantConfigurationDisassembly(
  proposalToken: string,
): Promise<AssistantConfigurationDisassemblyConfirmationResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { block: errorBlock("Sessão expirada", "Entre novamente para confirmar a desmontagem."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).eq("is_active", true).maybeSingle();
  if (!profile || !configurationDisassemblyProfileHasName(profile.name)) {
    return { block: errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma desmontagem."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const verified = verifyConfigurationDisassemblyProposalToken(
    proposalToken, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "", userId,
  );
  if (!verified.ok) {
    const expired = verified.reason === "expired";
    return { block: errorBlock(expired ? "Prévia expirada" : "Confirmação inválida",
      expired ? "Gere uma nova prévia com os saldos atuais." : "A confirmação não é válida para esta ação.",
      expired ? "expired" : "error"), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const payload = verified.payload;
  const loaded = await loadConfigurationDisassemblyTargetByCodeId(supabase, payload.commercialCodeId);
  const target = loaded.target;
  if (loaded.failed || !target || target.configurationId !== payload.configurationId) {
    return { block: errorBlock("Configuração indisponível", "O Servo com kit mudou ou não está mais disponível. Gere uma nova prévia."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const existing = await supabase.from("movement_batches").select("id").eq("user_id", userId)
    .eq("idempotency_key", payload.idempotencyKey).maybeSingle();
  if (existing.error) return { block: errorBlock("Consulta indisponível", "Não foi possível validar a confirmação agora. Tente novamente com a mesma prévia."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const projection = calculateConfigurationDisassemblyProjection(
    target.currentStock, target.servo.currentStock, target.installationKit.currentStock, payload.quantity,
  );
  if (!existing.data?.id && !projection.sufficient) return { block: errorBlock(
    projection.servoStockAfter > maximumInteger || projection.installationKitStockAfter > maximumInteger
      ? "Quantidade acima do limite" : "Saldo montado insuficiente",
    "Os saldos mudaram e não atendem mais à desmontagem. Gere uma nova prévia.",
  ), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const operation = await disassembleCommercialConfiguration({
    configuration_id: payload.configurationId, quantity: payload.quantity, idempotency_key: payload.idempotencyKey,
    commercial_code: target.displayCode, description: ASSISTANT_CONFIGURATION_DISASSEMBLY_DESCRIPTION,
  });
  if (!operation.ok) return { block: errorBlock("Desmontagem não registrada", operation.error), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const receipt = operation.receipt;
  const receiptValid = receipt.operationType === "DISASSEMBLY" && receipt.configurationId === payload.configurationId &&
    receipt.commercialCode === target.displayCode && receipt.quantity === payload.quantity &&
    receipt.servoId === target.servo.id && receipt.installationKitId === target.installationKit.id &&
    receipt.configurationQuantityAfter === receipt.configurationQuantityBefore - payload.quantity &&
    receipt.servoQuantityAfter === receipt.servoQuantityBefore + payload.quantity &&
    receipt.kitQuantityAfter === receipt.kitQuantityBefore + payload.quantity;
  const block: AssistantConfigurationDisassemblyResultBlock = {
    kind: "configuration_disassembly_result", action: "configuration_disassembly", outcome: "success",
    title: "Desmontagem concluída", message: "O Servo com kit foi desmontado e os saldos foram atualizados.",
    target: receiptValid ? { ...target, currentStock: receipt.configurationQuantityBefore,
      servo: { ...target.servo, currentStock: receipt.servoQuantityBefore },
      installationKit: { ...target.installationKit, currentStock: receipt.kitQuantityBefore } } : null,
    quantity: receiptValid ? payload.quantity : 0,
    mountedStockBefore: receiptValid ? receipt.configurationQuantityBefore : null,
    mountedStockAfter: receiptValid ? receipt.configurationQuantityAfter : null,
    servoStockBefore: receiptValid ? receipt.servoQuantityBefore : null,
    servoStockAfter: receiptValid ? receipt.servoQuantityAfter : null,
    installationKitStockBefore: receiptValid ? receipt.kitQuantityBefore : null,
    installationKitStockAfter: receiptValid ? receipt.kitQuantityAfter : null,
    occurredAt: null, reference: receipt.movementBatchId,
    idempotentReplay: Boolean(existing.data?.id && existing.data.id === receipt.movementBatchId),
    actions: [{ kind: "link", label: "Abrir no Estoque", href: `/estoque?configuration=${payload.configurationId}` },
      { kind: "link", label: "Abrir Histórico", href: "/historico" }],
  };
  if (!receiptValid) {
    block.refreshWarning = true;
    block.message += " A operação foi concluída, mas os detalhes não puderam ser atualizados agora.";
    return { block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  try {
    const { data: batch, error } = await supabase.from("movement_batches").select("occurred_at")
      .eq("id", receipt.movementBatchId).maybeSingle();
    if (error) throw new Error("refresh_failed");
    block.occurredAt = typeof batch?.occurred_at === "string" ? batch.occurred_at : null;
  } catch {
    block.refreshWarning = true;
    block.message += " A operação foi concluída, mas a data não pôde ser atualizada agora.";
  }
  return { block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

export function addConfigurationDisassemblyRefreshWarning(result: AssistantConfigurationDisassemblyConfirmationResult) {
  if (result.block.outcome !== "success") return result;
  return { ...result, block: { ...result.block, refreshWarning: true,
    message: `${result.block.message} Atualize a página para conferir os dados mais recentes.` } };
}
