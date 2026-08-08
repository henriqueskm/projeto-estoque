import "server-only";

import { randomUUID } from "node:crypto";
import { finalizeSupplierOrder } from "@/app/(authenticated)/pedidos/actions";
import type {
  AssistantChatSuccess,
  AssistantSupplierOrderCard,
  AssistantSupplierOrderFinalizationConfirmationResult,
  AssistantSupplierOrderFinalizationPreviewBlock,
  AssistantSupplierOrderFinalizationResultBlock,
} from "@/lib/assistant-types";
import {
  createSupplierOrderFinalizationProposalToken,
  verifySupplierOrderFinalizationProposalToken,
} from "@/lib/ai/supplier-order-finalization-action-token";
import {
  supplierOrderCanBeFinalized,
  supplierOrderFinalizationProfileHasName,
} from "@/lib/ai/supplier-order-finalization-contract";
import type { SupplierOrderFinalizationRequest } from "@/lib/ai/supplier-order-finalization-routing";
import {
  mapSupplierOrderSummary,
  supplierOrderSummarySelect,
  type SupplierOrderSummaryRow,
} from "@/lib/supplier-orders-data";
import type { SupplierOrderSummary } from "@/lib/supplier-orders-types";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function orderHref(order: SupplierOrderSummary) {
  return `/pedidos?view=${order.isInHistory ? "history" : "active"}&order=${encodeURIComponent(order.id)}`;
}

function toOrderCard(order: SupplierOrderSummary): AssistantSupplierOrderCard {
  return {
    id: order.id, negotiationNumber: order.negotiationNumber, orderDate: order.orderDate,
    status: order.status, closureKind: order.closureKind, lineCount: order.lineCount,
    orderedQuantity: order.orderedQuantity, pickedQuantity: order.pickedQuantity,
    waitingPickupQuantity: order.waitingPickupQuantity, stockedQuantity: order.stockedQuantity,
    waitingStockQuantity: order.waitingStockQuantity, href: orderHref(order),
  };
}

function createResult(
  outcome: AssistantSupplierOrderFinalizationResultBlock["outcome"],
  title: string,
  message: string,
  order: AssistantSupplierOrderCard | null = null,
): AssistantSupplierOrderFinalizationResultBlock {
  return { kind: "supplier_order_finalization_result", action: "supplier_order_finalization", outcome, title, message,
    order, occurredAt: null, idempotentReplay: false,
    actions: order ? [{ kind: "link", label: "Abrir Pedido", href: order.href }] : [] };
}

function answer(block: AssistantSupplierOrderFinalizationResultBlock): AssistantChatSuccess {
  return { message: block.message, structuredBlock: block, contextSupplierOrderId: block.order?.id ?? null,
    contextSupplierOrderCatalogCode: null };
}

function finalizationIneligibility(order: SupplierOrderSummary) {
  if (order.cancelledAt !== null || order.closureKind === "CANCELLED" || order.status === "CANCELLED") {
    return { title: "Pedido cancelado", message: "Pedidos cancelados já pertencem ao Histórico e não podem ser finalizados." };
  }
  if (order.isFinalized || order.closureKind === "FINALIZED") {
    return { title: "Pedido já finalizado", message: "Este Pedido já foi finalizado. Nenhuma operação foi executada." };
  }
  return { title: "Pedido ainda não concluído", message: "Somente Pedidos concluídos e sem retirada pendente podem ser finalizados." };
}

async function loadOrderById(supabase: SupabaseClient, id: string) {
  const result = await supabase.from("supplier_order_summaries").select(supplierOrderSummarySelect).eq("id", id).maybeSingle();
  return { failed: Boolean(result.error), order: result.data ? mapSupplierOrderSummary(result.data as SupplierOrderSummaryRow) : null };
}

async function loadOrdersByNegotiation(supabase: SupabaseClient, negotiationNumber: string) {
  const result = await supabase.from("supplier_order_summaries").select(supplierOrderSummarySelect)
    .eq("negotiation_number", negotiationNumber).limit(2);
  return { failed: Boolean(result.error), orders: (result.data ?? []).map((row) => mapSupplierOrderSummary(row as SupplierOrderSummaryRow)) };
}

function profileInvalid(context: { userId: string; profileName: string | null }) {
  return !uuidPattern.test(context.userId) || !supplierOrderFinalizationProfileHasName(context.profileName);
}

export async function createAssistantSupplierOrderFinalizationPreview(
  request: SupplierOrderFinalizationRequest,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (profileInvalid(context)) {
    return answer(createResult("error", "Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de finalizar um Pedido."));
  }
  const supabase = await createClient();
  const resolved = await loadOrdersByNegotiation(supabase, request.negotiationNumber);
  if (resolved.failed) return answer(createResult("error", "Consulta indisponível", "Não foi possível localizar o Pedido agora."));
  if (resolved.orders.length === 0) return answer(createResult("error", "Pedido não encontrado", "Não encontrei um único Pedido com esse número de negociação."));
  if (resolved.orders.length > 1) return answer(createResult("error", "Pedido ambíguo", "Encontrei mais de um Pedido com esse número. Abra a lista de Pedidos e informe a negociação exata."));
  const order = resolved.orders[0];
  if (!order) return answer(createResult("error", "Pedido não encontrado", "Não encontrei um único Pedido com esse número de negociação."));
  const card = toOrderCard(order);
  if (!supplierOrderCanBeFinalized(order)) {
    const message = finalizationIneligibility(order);
    return answer(createResult("error", message.title, message.message, card));
  }
  const signed = createSupplierOrderFinalizationProposalToken({ userId: context.userId, supplierOrderId: order.id,
    expectedUpdatedAt: order.updatedAt, idempotencyKey: randomUUID() }, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "");
  if (!signed) return answer(createResult("error", "Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada.", card));
  const block: AssistantSupplierOrderFinalizationPreviewBlock = {
    kind: "supplier_order_finalization_preview", action: "supplier_order_finalization", state: "pending",
    title: "Finalizar Pedido", message: "O Pedido será relido e validado antes da finalização.",
    proposalToken: signed.token, expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(), order: card,
    confirmLabel: "Confirmar finalização", cancelLabel: "Cancelar",
    regeneratePrompt: `Finalize o Pedido ${order.negotiationNumber}.`,
  };
  return { message: block.message, structuredBlock: block, contextSupplierOrderId: order.id, contextSupplierOrderCatalogCode: null };
}

function confirmationResult(block: AssistantSupplierOrderFinalizationResultBlock): AssistantSupplierOrderFinalizationConfirmationResult {
  return { block, contextSupplierOrderId: block.order?.id ?? null, contextSupplierOrderCatalogCode: null };
}

export async function confirmAssistantSupplierOrderFinalization(
  proposalToken: string,
): Promise<AssistantSupplierOrderFinalizationConfirmationResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return confirmationResult(createResult("error", "Sessão expirada", "Entre novamente para confirmar a finalização."));
  const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).eq("is_active", true).maybeSingle();
  if (!profile || !supplierOrderFinalizationProfileHasName(profile.name)) {
    return confirmationResult(createResult("error", "Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de finalizar um Pedido."));
  }
  const verified = verifySupplierOrderFinalizationProposalToken(proposalToken,
    process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "", userId);
  if (!verified.ok) {
    const expired = verified.reason === "expired";
    return confirmationResult(createResult(expired ? "expired" : "error", expired ? "Prévia expirada" : "Confirmação inválida",
      expired ? "Gere uma nova prévia com os dados atuais." : "Esta prévia não é válida para finalizar o Pedido."));
  }
  const payload = verified.payload;
  const loaded = await loadOrderById(supabase, payload.supplierOrderId);
  if (loaded.failed || !loaded.order) return confirmationResult(createResult("error", "Pedido não encontrado", "O Pedido desta prévia não está mais disponível."));
  const before = loaded.order;
  const card = toOrderCard(before);
  if (before.cancelledAt !== null || before.closureKind === "CANCELLED" || before.status === "CANCELLED") {
    return confirmationResult(createResult("error", "Pedido cancelado", "Pedidos cancelados já pertencem ao Histórico e não podem ser finalizados.", card));
  }
  const existingEvent = await supabase.from("supplier_order_events").select("id")
    .eq("supplier_order_id", payload.supplierOrderId).eq("event_type", "ORDER_FINALIZED")
    .eq("idempotency_key", payload.idempotencyKey).maybeSingle();
  const operation = await finalizeSupplierOrder({ supplier_order_id: payload.supplierOrderId,
    expected_updated_at: payload.expectedUpdatedAt, finalization_note: null, idempotency_key: payload.idempotencyKey });
  if (!operation.ok) {
    return confirmationResult(createResult(operation.stale ? "conflict" : "error",
      operation.stale ? "Pedido alterado" : "Finalização não registrada", operation.error, card));
  }
  const refreshed = await loadOrderById(supabase, payload.supplierOrderId);
  if (refreshed.failed || !refreshed.order) {
    const block = createResult("success", "Pedido finalizado", `O Pedido ${operation.receipt.negotiationNumber} foi finalizado com sucesso.`, card);
    block.refreshWarning = true;
    block.message += " A atualização visual pode exigir recarregar a página.";
    block.idempotentReplay = Boolean(existingEvent.data);
    return confirmationResult(block);
  }
  const finalOrder = refreshed.order;
  const block = createResult("success", "Pedido finalizado", `O Pedido ${finalOrder.negotiationNumber} foi finalizado com sucesso.`, toOrderCard(finalOrder));
  block.occurredAt = finalOrder.finalizedAt;
  block.idempotentReplay = Boolean(existingEvent.data);
  return confirmationResult(block);
}

export function addSupplierOrderFinalizationRefreshWarning(result: AssistantSupplierOrderFinalizationConfirmationResult) {
  if (result.block.outcome !== "success") return result;
  return { ...result, block: { ...result.block, refreshWarning: true,
    message: `${result.block.message} A atualização visual pode exigir recarregar a página.` } };
}
