import "server-only";

import { randomUUID } from "node:crypto";
import type {
  AssistantChatSuccess,
  AssistantClarificationBlock,
  AssistantConfigurationAssemblyConfirmationResult,
  AssistantConfigurationAssemblyPreviewBlock,
  AssistantConfigurationAssemblyResultBlock,
  AssistantConfigurationAssemblySelection,
  AssistantConfigurationAssemblyTarget,
} from "@/lib/assistant-types";
import {
  ASSISTANT_CONFIGURATION_ASSEMBLY_DESCRIPTION,
  calculateConfigurationAssemblyProjection,
  configurationAssemblyProfileHasName,
} from "@/lib/ai/configuration-assembly-contract";
import {
  createConfigurationAssemblyProposalToken,
  verifyConfigurationAssemblyProposalToken,
} from "@/lib/ai/configuration-assembly-action-token";
import type { ConfigurationAssemblyRequest } from "@/lib/ai/configuration-assembly-routing";
import {
  loadConfigurationAssemblyTargetByCodeId,
  resolveConfigurationAssemblyTargets,
} from "@/lib/assistant-configuration-assembly-data";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorBlock(title: string, message: string, outcome: AssistantConfigurationAssemblyResultBlock["outcome"] = "error"): AssistantConfigurationAssemblyResultBlock {
  return { kind: "configuration_assembly_result", action: "configuration_assembly", outcome, title, message,
    target: null, quantity: 0, mountedStockBefore: null, mountedStockAfter: null, servoStockBefore: null,
    servoStockAfter: null, installationKitStockBefore: null, installationKitStockAfter: null,
    occurredAt: null, reference: null, idempotentReplay: false, actions: [] };
}

function answer(block: AssistantConfigurationAssemblyResultBlock): AssistantChatSuccess {
  return { message: block.message, structuredBlock: block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

function createTargetClarification(quantity: number, targets: AssistantConfigurationAssemblyTarget[]): AssistantChatSuccess {
  const visibleTargets = targets.slice(0, 5);
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification", title: "Qual Servo com kit deseja montar?",
    message: targets.length > visibleTargets.length
      ? "Há várias configurações físicas para esse modelo. Escolha uma opção ou informe o Cód. exato."
      : "Há mais de uma configuração física para esse modelo. Escolha uma opção.",
    options: [
      ...visibleTargets.map((target, index) => ({ id: `assembly-target-${index + 1}`,
        label: `Servo com kit · Cód. ${target.aliases.join(" / ") || target.displayCode}`.slice(0, 60),
        prompt: `Selecionar montagem · Cód. ${target.aliases.join(" / ") || target.displayCode}`,
        description: target.description.slice(0, 180), category: "inventory" as const,
        configurationAssemblySelection: { action: "configuration_assembly_target" as const,
          commercialCodeId: target.commercialCodeId, quantity } })),
      { id: "assembly-cancel", label: "Cancelar", prompt: "Cancelar esta montagem.", category: "inventory" as const },
    ], fallbackText: "Escolha a configuração física antes de continuar.",
  };
  return { message: block.fallbackText, structuredBlock: block };
}

function createPreview(
  target: AssistantConfigurationAssemblyTarget,
  quantity: number,
  context: { userId: string; profileName: string | null },
): AssistantChatSuccess {
  const projection = calculateConfigurationAssemblyProjection(target.currentStock, target.servo.currentStock,
    target.installationKit.currentStock, quantity);
  if (!projection.sufficient) {
    const overflow = projection.mountedStockAfter > 2_147_483_647;
    return answer(errorBlock(overflow ? "Quantidade acima do limite" : "Componentes insuficientes",
      overflow
        ? "A montagem solicitada excede o limite permitido. Nenhuma montagem foi executada."
        : `A capacidade atual é de ${projection.capacity} unidade${projection.capacity === 1 ? "" : "s"}. Nenhuma montagem foi executada.`));
  }
  const signed = createConfigurationAssemblyProposalToken({ userId: context.userId,
    commercialCodeId: target.commercialCodeId, configurationId: target.configurationId,
    quantity, idempotencyKey: randomUUID() }, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "");
  if (!signed) return answer(errorBlock("Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada."));
  const block: AssistantConfigurationAssemblyPreviewBlock = {
    kind: "configuration_assembly_preview", action: "configuration_assembly", state: "pending",
    title: "Confirmar montagem", message: "Os componentes e saldos serão relidos e validados pelo banco antes da montagem.",
    proposalToken: signed.token, expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(), target, quantity,
    mountedStockAfter: projection.mountedStockAfter, servoStockAfter: projection.servoStockAfter,
    installationKitStockAfter: projection.installationKitStockAfter, totalQuantity: quantity,
    confirmLabel: "Confirmar montagem", cancelLabel: "Cancelar",
    regeneratePrompt: `Monte ${quantity} unidade${quantity === 1 ? "" : "s"} do Cód. ${target.displayCode}.`,
  };
  return { message: block.message, structuredBlock: block, contextItemQuery: target.displayCode,
    contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

export async function createAssistantConfigurationAssemblyPreview(
  request: ConfigurationAssemblyRequest,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (!uuidPattern.test(context.userId) || !configurationAssemblyProfileHasName(context.profileName)) {
    return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma montagem."));
  }
  const supabase = await createClient();
  const resolved = await resolveConfigurationAssemblyTargets(supabase, request.targetQuery);
  if (resolved.failed) return answer(errorBlock("Consulta indisponível", "Não foi possível localizar a configuração agora."));
  if (!resolved.targets.length) return answer(errorBlock("Configuração não encontrada",
    `Não encontrei um Servo com kit ativo para ${request.targetQuery}. Nenhuma montagem foi executada.`));
  if (resolved.targets.length > 1) return createTargetClarification(request.quantity, resolved.targets);
  return createPreview(resolved.targets[0], request.quantity, context);
}

export async function createAssistantConfigurationAssemblyPreviewFromSelection(
  selection: AssistantConfigurationAssemblySelection,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (!uuidPattern.test(context.userId) || !configurationAssemblyProfileHasName(context.profileName)) {
    return answer(errorBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma montagem."));
  }
  const supabase = await createClient();
  const loaded = await loadConfigurationAssemblyTargetByCodeId(supabase, selection.commercialCodeId);
  if (loaded.failed || !loaded.target) return answer(errorBlock("Configuração indisponível",
    "O Servo com kit não está mais ativo. Gere uma nova prévia."));
  return createPreview(loaded.target, selection.quantity, context);
}

type RpcReceipt = {
  movement_batch_id?: unknown; operation_type?: unknown; configuration_id?: unknown; commercial_code?: unknown;
  quantity?: unknown; servo_id?: unknown; installation_kit_id?: unknown; servo_quantity_before?: unknown;
  servo_quantity_after?: unknown; kit_quantity_before?: unknown; kit_quantity_after?: unknown;
  configuration_quantity_before?: unknown; configuration_quantity_after?: unknown; operation_applied?: unknown;
};

function receiptInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function confirmAssistantConfigurationAssembly(
  proposalToken: string,
): Promise<AssistantConfigurationAssemblyConfirmationResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { block: errorBlock("Sessão expirada", "Entre novamente para confirmar a montagem."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).eq("is_active", true).maybeSingle();
  if (!profile || !configurationAssemblyProfileHasName(profile.name)) return { block: errorBlock("Perfil incompleto",
    "Seu perfil precisa ter um nome cadastrado antes de registrar uma montagem."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const verified = verifyConfigurationAssemblyProposalToken(proposalToken,
    process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "", userId);
  if (!verified.ok) {
    const expired = verified.reason === "expired";
    return { block: errorBlock(expired ? "Prévia expirada" : "Confirmação inválida",
      expired ? "Gere uma nova prévia com os saldos atuais." : "A confirmação não é válida para esta ação.",
      expired ? "expired" : "error"), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const payload = verified.payload;
  const loaded = await loadConfigurationAssemblyTargetByCodeId(supabase, payload.commercialCodeId);
  const target = loaded.target;
  if (loaded.failed || !target || target.configurationId !== payload.configurationId) return { block: errorBlock("Configuração indisponível",
    "O Servo com kit mudou ou não está mais ativo. Gere uma nova prévia."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const existingBatch = await supabase.from("movement_batches").select("id")
    .eq("user_id", userId).eq("idempotency_key", payload.idempotencyKey).maybeSingle();
  if (existingBatch.error) return { block: errorBlock("Consulta indisponível",
    "Não foi possível validar a confirmação agora. Tente novamente com a mesma prévia."), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const projection = calculateConfigurationAssemblyProjection(target.currentStock, target.servo.currentStock,
    target.installationKit.currentStock, payload.quantity);
  if (!existingBatch.data?.id && !projection.sufficient) return { block: errorBlock(
    projection.mountedStockAfter > 2_147_483_647 ? "Quantidade acima do limite" : "Componentes insuficientes",
    projection.mountedStockAfter > 2_147_483_647
      ? "A montagem solicitada excede o limite permitido. Gere uma nova prévia com outra quantidade."
      : "Os saldos mudaram e não atendem mais à montagem. Gere uma nova prévia.",
  ), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const { data, error } = await supabase.rpc("assemble_commercial_configuration", {
    p_configuration_id: payload.configurationId, p_quantity: payload.quantity,
    p_idempotency_key: payload.idempotencyKey, p_commercial_code: target.displayCode,
    p_description: ASSISTANT_CONFIGURATION_ASSEMBLY_DESCRIPTION,
  });
  if (error) {
    const message = error.message.toLowerCase();
    const safeMessage = message.includes("idempotency") || message.includes("different")
      ? "Esta chave já foi usada com dados diferentes. Gere uma nova prévia."
      : message.includes("insufficient") || message.includes("saldo") || message.includes("stock")
        ? "Os componentes disponíveis mudaram. Gere uma nova prévia."
        : message.includes("inactive") || message.includes("does not exist")
          ? "O Servo com kit não está mais disponível. Gere uma nova prévia."
          : "Não foi possível registrar a montagem agora.";
    return { block: errorBlock("Montagem não registrada", safeMessage), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const receipt = data as RpcReceipt;
  const reference = typeof receipt?.movement_batch_id === "string" && uuidPattern.test(receipt.movement_batch_id)
    ? receipt.movement_batch_id : null;
  const mountedBefore = receiptInteger(receipt?.configuration_quantity_before);
  const mountedAfter = receiptInteger(receipt?.configuration_quantity_after);
  const servoBefore = receiptInteger(receipt?.servo_quantity_before);
  const servoAfter = receiptInteger(receipt?.servo_quantity_after);
  const kitBefore = receiptInteger(receipt?.kit_quantity_before);
  const kitAfter = receiptInteger(receipt?.kit_quantity_after);
  const receiptValid = reference && receipt.operation_type === "ASSEMBLY" && receipt.configuration_id === payload.configurationId &&
    receipt.commercial_code === target.displayCode &&
    receipt.quantity === payload.quantity && receipt.servo_id === target.servo.id && receipt.installation_kit_id === target.installationKit.id &&
    mountedBefore !== null && mountedAfter === mountedBefore + payload.quantity && servoBefore !== null && servoAfter === servoBefore - payload.quantity &&
    kitBefore !== null && kitAfter === kitBefore - payload.quantity && receipt.operation_applied === true;
  const block: AssistantConfigurationAssemblyResultBlock = {
    kind: "configuration_assembly_result", action: "configuration_assembly", outcome: "success",
    title: "Montagem concluída", message: "O Servo com kit foi montado e os saldos foram atualizados.",
    target: receiptValid ? { ...target, currentStock: mountedBefore!, servo: { ...target.servo, currentStock: servoBefore! },
      installationKit: { ...target.installationKit, currentStock: kitBefore! }, capacity: Math.min(servoBefore!, kitBefore!) } : null,
    quantity: receiptValid ? payload.quantity : 0, mountedStockBefore: receiptValid ? mountedBefore : null,
    mountedStockAfter: receiptValid ? mountedAfter : null, servoStockBefore: receiptValid ? servoBefore : null,
    servoStockAfter: receiptValid ? servoAfter : null, installationKitStockBefore: receiptValid ? kitBefore : null,
    installationKitStockAfter: receiptValid ? kitAfter : null, occurredAt: null, reference,
    idempotentReplay: Boolean(existingBatch.data?.id && existingBatch.data.id === reference),
    actions: [{ kind: "link", label: "Abrir no Estoque", href: `/estoque?configuration=${payload.configurationId}` },
      { kind: "link", label: "Abrir Histórico", href: "/historico" }],
  };
  if (!receiptValid) {
    block.refreshWarning = true;
    block.message += " A operação foi concluída, mas os detalhes não puderam ser atualizados agora.";
    return { block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  try {
    const { data: batch, error: batchError } = await supabase.from("movement_batches").select("occurred_at").eq("id", reference).maybeSingle();
    if (batchError) throw new Error("refresh_failed");
    block.occurredAt = typeof batch?.occurred_at === "string" ? batch.occurred_at : null;
  } catch {
    block.refreshWarning = true;
    block.message += " A operação foi concluída, mas a data não pôde ser atualizada agora.";
  }
  return { block, contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
}

export function addConfigurationAssemblyRefreshWarning(result: AssistantConfigurationAssemblyConfirmationResult) {
  if (result.block.outcome !== "success") return result;
  return { ...result, block: { ...result.block, refreshWarning: true,
    message: `${result.block.message} Atualize a página para conferir os dados mais recentes.` } };
}
