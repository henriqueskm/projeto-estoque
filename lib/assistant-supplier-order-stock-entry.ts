import "server-only";

import { randomUUID } from "node:crypto";
import type {
  AssistantChatSuccess,
  AssistantSupplierOrderCard,
  AssistantSupplierOrderStockEntryConfirmationResult,
  AssistantSupplierOrderStockEntryPreviewBlock,
  AssistantSupplierOrderStockEntryResultBlock,
} from "@/lib/assistant-types";
import { createSupplierOrderStockEntryProposalToken, verifySupplierOrderStockEntryProposalToken } from "@/lib/ai/stock-entry-action-tokens";
import type { SupplierOrderStockEntryRequest } from "@/lib/ai/supplier-order-stock-entry-routing";
import { loadTargetsForSupplierOrderItems, resolveSupplierOrderLines } from "@/lib/assistant-stock-entry-data";
import { mapSupplierOrderItem, mapSupplierOrderSummary, supplierOrderItemSelect, supplierOrderSummarySelect, type SupplierOrderItemRow, type SupplierOrderSummaryRow } from "@/lib/supplier-orders-data";
import type { SupplierOrderItem, SupplierOrderSummary } from "@/lib/supplier-orders-types";
import { createClient } from "@/lib/supabase/server";

const maximumPreviewLines = 20;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function orderHref(order: SupplierOrderSummary) {
  return `/pedidos?view=${order.isInHistory ? "history" : "active"}&order=${encodeURIComponent(order.id)}`;
}
function orderCard(order: SupplierOrderSummary): AssistantSupplierOrderCard {
  return { id: order.id, negotiationNumber: order.negotiationNumber, orderDate: order.orderDate,
    status: order.status, closureKind: order.closureKind, lineCount: order.lineCount,
    orderedQuantity: order.orderedQuantity, pickedQuantity: order.pickedQuantity,
    waitingPickupQuantity: order.waitingPickupQuantity, stockedQuantity: order.stockedQuantity,
    waitingStockQuantity: order.waitingStockQuantity, href: orderHref(order) };
}
function resultBlock(title: string, message: string, outcome: AssistantSupplierOrderStockEntryResultBlock["outcome"], order: SupplierOrderSummary | null = null): AssistantSupplierOrderStockEntryResultBlock {
  return { kind: "supplier_order_stock_entry_result", action: "supplier_order_stock_entry", outcome,
    title, message, order: order ? orderCard(order) : null, lines: [], linesProcessed: 0,
    totalQuantity: 0, occurredAt: null, reference: null, idempotentReplay: false,
    actions: order ? [{ kind: "link", label: "Abrir Pedido", href: orderHref(order) }] : [] };
}
function response(block: AssistantSupplierOrderStockEntryResultBlock): AssistantChatSuccess {
  return { message: block.message, structuredBlock: block,
    contextSupplierOrderId: block.order?.id ?? null, contextSupplierOrderCatalogCode: null };
}
async function loadOrderByNegotiation(supabase: Awaited<ReturnType<typeof createClient>>, negotiation: string) {
  const result = await supabase.from("supplier_order_summaries").select(supplierOrderSummarySelect)
    .ilike("negotiation_number", negotiation).limit(3);
  if (result.error) return { order: null, ambiguous: false, failed: true };
  const normalized = negotiation.trim().toLocaleLowerCase("pt-BR");
  const orders = ((result.data ?? []) as SupplierOrderSummaryRow[]).map(mapSupplierOrderSummary)
    .filter((order): order is SupplierOrderSummary => Boolean(order) && order!.negotiationNumber.trim().toLocaleLowerCase("pt-BR") === normalized);
  return { order: orders.length === 1 ? orders[0] : null, ambiguous: orders.length > 1, failed: false };
}
async function loadOrderById(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const result = await supabase.from("supplier_order_summaries").select(supplierOrderSummarySelect).eq("id", id).maybeSingle();
  return { order: result.data ? mapSupplierOrderSummary(result.data as SupplierOrderSummaryRow) : null, failed: Boolean(result.error) };
}
async function loadLines(supabase: Awaited<ReturnType<typeof createClient>>, orderId: string) {
  const result = await supabase.from("supplier_order_item_details").select(supplierOrderItemSelect)
    .eq("supplier_order_id", orderId).order("position").limit(1001);
  return { items: ((result.data ?? []) as SupplierOrderItemRow[]).map(mapSupplierOrderItem).filter((item): item is SupplierOrderItem => Boolean(item)),
    failed: Boolean(result.error) || (result.data?.length ?? 0) > 1000 };
}

export async function createAssistantSupplierOrderStockEntryPreview(
  request: SupplierOrderStockEntryRequest,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  if (!uuidPattern.test(context.userId) || !context.profileName?.trim()) {
    return response(resultBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma entrada.", "error"));
  }
  const supabase = await createClient();
  const loadedOrder = await loadOrderByNegotiation(supabase, request.negotiationNumber);
  if (loadedOrder.failed) return response(resultBlock("Consulta indisponível", "Não foi possível carregar o Pedido agora.", "error"));
  if (loadedOrder.ambiguous || !loadedOrder.order) return response(resultBlock("Pedido não encontrado", "Não encontrei uma única negociação exata com esse número.", "error"));
  const order = loadedOrder.order;
  const loadedLines = await loadLines(supabase, order.id);
  if (loadedLines.failed) return response(resultBlock("Consulta indisponível", "Não foi possível carregar as linhas do Pedido agora.", "error", order));
  const available = loadedLines.items.filter((item) => item.waitingStockQuantity > 0);
  let selected: SupplierOrderItem[] = [];
  if (request.allAvailable && request.targetQueries.length === 0) selected = available;
  else {
    for (const query of request.targetQueries) {
      const matches = resolveSupplierOrderLines(loadedLines.items, query).filter((item) => item.waitingStockQuantity > 0);
      if (matches.length !== 1) {
        return response(resultBlock(matches.length ? "Item ambíguo" : "Item indisponível",
          matches.length ? `Mais de uma linha corresponde a ${query}. Abra o Pedido para escolher a linha exata.` : `Não encontrei ${query} com quantidade retirada aguardando entrada neste Pedido.`, "error", order));
      }
      selected.push(matches[0]);
    }
  }
  selected = Array.from(new Map(selected.map((item) => [item.id, item])).values()).sort((a, b) => a.id.localeCompare(b.id));
  if (!selected.length) return response(resultBlock("Nada aguardando entrada", "Este Pedido não possui unidades retiradas aguardando entrada no Estoque.", "error", order));
  if (selected.length > maximumPreviewLines) return response(resultBlock("Muitas linhas para confirmar", `Esta entrada possui mais de ${maximumPreviewLines} linhas. Abra o Pedido para revisar antes de registrar.`, "error", order));
  const targetsResult = await loadTargetsForSupplierOrderItems(supabase, selected);
  if (targetsResult.failed || selected.some((item) => !targetsResult.targets.has(item.id))) {
    return response(resultBlock("Alvo indisponível", "Um item do Pedido não está mais disponível para entrada.", "error", order));
  }
  const lines = selected.map((item) => {
    const entryQuantity = request.allAvailable ? item.waitingStockQuantity : request.quantity!;
    const target = targetsResult.targets.get(item.id)!;
    return { supplierOrderItemId: item.id, target, orderedQuantity: item.orderedQuantity,
      pickedQuantity: item.pickedQuantity, stockedQuantity: item.stockedQuantity,
      availableQuantity: item.waitingStockQuantity, entryQuantity,
      remainingQuantity: item.waitingStockQuantity - entryQuantity,
      estimatedStockAfter: target.currentStock + entryQuantity };
  });
  if (lines.some((line) => line.entryQuantity < 1 || line.entryQuantity > line.availableQuantity)) {
    return response(resultBlock("Quantidade indisponível", "A quantidade solicitada ultrapassa o que já foi retirado e ainda aguarda entrada.", "error", order));
  }
  const physicalTotals = new Map<string, number>();
  lines.forEach((line) => {
    const key = line.target.kind === "ITEM" ? `ITEM:${line.target.targetId}` : `CONFIG:${line.target.configurationId}`;
    physicalTotals.set(key, (physicalTotals.get(key) ?? 0) + line.entryQuantity);
  });
  lines.forEach((line) => {
    const key = line.target.kind === "ITEM" ? `ITEM:${line.target.targetId}` : `CONFIG:${line.target.configurationId}`;
    line.estimatedStockAfter = line.target.currentStock + (physicalTotals.get(key) ?? line.entryQuantity);
  });
  const signed = createSupplierOrderStockEntryProposalToken({ userId: context.userId, supplierOrderId: order.id,
    lines: lines.map((line) => ({ supplierOrderItemId: line.supplierOrderItemId, quantity: line.entryQuantity })),
    expectedUpdatedAt: order.updatedAt, idempotencyKey: randomUUID() }, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "");
  if (!signed) return response(resultBlock("Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada.", "error", order));
  const totalQuantity = lines.reduce((sum, line) => sum + line.entryQuantity, 0);
  const block: AssistantSupplierOrderStockEntryPreviewBlock = { kind: "supplier_order_stock_entry_preview",
    action: "supplier_order_stock_entry", state: "pending", title: "Confirmar entrada pelo Pedido",
    message: `Pedido ${order.negotiationNumber}. Os valores serão revalidados antes da entrada.`,
    proposalToken: signed.token, expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(), order: orderCard(order),
    lines, totalQuantity, confirmLabel: "Confirmar entrada", cancelLabel: "Cancelar",
    regeneratePrompt: request.allAvailable ? `Dê entrada em tudo que está disponível no Pedido ${order.negotiationNumber}.`
      : `Dê entrada em ${request.quantity} unidade${request.quantity === 1 ? "" : "s"} do ${request.targetQueries.join(" e ")} no Pedido ${order.negotiationNumber}.` };
  return { message: block.message, structuredBlock: block, contextSupplierOrderId: order.id, contextSupplierOrderCatalogCode: null };
}

type RpcReceipt = { supplier_order_stock_entry_id?: unknown; movement_batch_id?: unknown; stock_entry_line_count?: unknown; stock_entry_quantity?: unknown; stock_entry_created_at?: unknown };

export async function confirmAssistantSupplierOrderStockEntry(proposalToken: string): Promise<AssistantSupplierOrderStockEntryConfirmationResult> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { block: resultBlock("Sessão expirada", "Entre novamente para confirmar a entrada.", "error"), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).eq("is_active", true).maybeSingle();
  if (!profile || typeof profile.name !== "string" || !profile.name.trim()) {
    return { block: resultBlock("Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de registrar uma entrada.", "error"), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const verified = verifySupplierOrderStockEntryProposalToken(proposalToken, process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "", userId);
  if (!verified.ok) {
    const expired = verified.reason === "expired";
    return { block: resultBlock(expired ? "Prévia expirada" : "Confirmação inválida", expired ? "Gere uma nova prévia com os valores atuais." : "A confirmação não é válida para esta ação.", expired ? "expired" : "error"), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  }
  const payload = verified.payload;
  const [orderResult, linesResult] = await Promise.all([loadOrderById(supabase, payload.supplierOrderId), loadLines(supabase, payload.supplierOrderId)]);
  const order = orderResult.order;
  if (orderResult.failed || linesResult.failed || !order) return { block: resultBlock("Pedido indisponível", "Não foi possível revalidar o Pedido.", "error"), contextSupplierOrderId: null, contextSupplierOrderCatalogCode: null };
  if (order.updatedAt !== payload.expectedUpdatedAt) return { block: resultBlock("Pedido alterado", "Este Pedido mudou desde a prévia. Gere uma nova prévia.", "conflict", order), contextSupplierOrderId: order.id, contextSupplierOrderCatalogCode: null };
  const lineById = new Map(linesResult.items.map((item) => [item.id, item]));
  if (payload.lines.some((line) => { const item = lineById.get(line.supplierOrderItemId); return !item || line.quantity > item.waitingStockQuantity; })) {
    return { block: resultBlock("Disponibilidade alterada", "A quantidade aguardando entrada mudou. Gere uma nova prévia.", "conflict", order), contextSupplierOrderId: order.id, contextSupplierOrderCatalogCode: null };
  }
  const existingBatch = await supabase.from("movement_batches").select("id")
    .eq("user_id", userId).eq("idempotency_key", payload.idempotencyKey).maybeSingle();
  const { data, error } = await supabase.rpc("create_supplier_order_stock_entry", {
    p_supplier_order_id: payload.supplierOrderId,
    p_lines: payload.lines.map((line) => ({ supplier_order_item_id: line.supplierOrderItemId, quantity: line.quantity })),
    p_note: null, p_expected_updated_at: payload.expectedUpdatedAt, p_idempotency_key: payload.idempotencyKey,
  });
  if (error) {
    const conflict = error.code === "40001" || error.message.toLowerCase().includes("changed after");
    return { block: resultBlock(conflict ? "Pedido alterado" : "Entrada não registrada", conflict ? "Este Pedido mudou desde a prévia. Gere uma nova prévia." : "Não foi possível registrar a entrada agora.", conflict ? "conflict" : "error", order), contextSupplierOrderId: order.id, contextSupplierOrderCatalogCode: null };
  }
  const receipt = data as RpcReceipt;
  const entryId = typeof receipt?.supplier_order_stock_entry_id === "string" && uuidPattern.test(receipt.supplier_order_stock_entry_id) ? receipt.supplier_order_stock_entry_id : null;
  const batchId = typeof receipt?.movement_batch_id === "string" && uuidPattern.test(receipt.movement_batch_id) ? receipt.movement_batch_id : null;
  const occurredAt = typeof receipt?.stock_entry_created_at === "string" && !Number.isNaN(Date.parse(receipt.stock_entry_created_at)) ? receipt.stock_entry_created_at : null;
  const baseSuccess: AssistantSupplierOrderStockEntryResultBlock = { kind: "supplier_order_stock_entry_result", action: "supplier_order_stock_entry", outcome: "success",
    title: "Entrada concluída", message: `Entrada pelo Pedido ${order.negotiationNumber} registrada.`, order: orderCard(order), lines: [],
    linesProcessed: payload.lines.length, totalQuantity: payload.lines.reduce((sum, line) => sum + line.quantity, 0),
    occurredAt, reference: entryId, idempotentReplay: Boolean(existingBatch.data?.id && existingBatch.data.id === batchId), actions: [{ kind: "link", label: "Abrir Pedido", href: orderHref(order) }, { kind: "link", label: "Abrir Histórico", href: "/historico" }] };
  if (!entryId || !batchId) return { block: { ...baseSuccess, refreshWarning: true, message: `${baseSuccess.message} Atualize a página para conferir os detalhes.` }, contextSupplierOrderId: order.id, contextSupplierOrderCatalogCode: null };
  try {
    const [refreshedOrder, refreshedLines, stockMovements, configurationMovements] = await Promise.all([
      loadOrderById(supabase, order.id),
      loadLines(supabase, order.id),
      supabase.from("stock_movements").select("item_id, quantity_change, quantity_before, quantity_after, created_at").eq("batch_id", batchId),
      supabase.from("configuration_stock_movements").select("configuration_id, quantity_change, quantity_before, quantity_after, created_at").eq("batch_id", batchId),
    ]);
    if (refreshedOrder.failed || !refreshedOrder.order || refreshedLines.failed || stockMovements.error || configurationMovements.error) throw new Error("refresh_failed");
    baseSuccess.order = orderCard(refreshedOrder.order);
    const selected = payload.lines.map((line) => refreshedLines.items.find((item) => item.id === line.supplierOrderItemId)).filter((item): item is SupplierOrderItem => Boolean(item));
    const afterTargets = await loadTargetsForSupplierOrderItems(supabase, selected);
    const payloadById = new Map(payload.lines.map((line) => [line.supplierOrderItemId, line.quantity]));
    const movementByTarget = new Map<string, { quantity_before: number; quantity_after: number }>();
    ((stockMovements.data ?? []) as Array<{ item_id: string; quantity_before: number; quantity_after: number }>).forEach((row) => movementByTarget.set(`ITEM:${row.item_id}`, row));
    ((configurationMovements.data ?? []) as Array<{ configuration_id: string; quantity_before: number; quantity_after: number }>).forEach((row) => movementByTarget.set(`CONFIG:${row.configuration_id}`, row));
    baseSuccess.lines = selected.map((item) => { const after = afterTargets.targets.get(item.id)!; const quantity = payloadById.get(item.id)!;
      const key = after.kind === "ITEM" ? `ITEM:${after.targetId}` : `CONFIG:${after.configurationId}`;
      const movement = movementByTarget.get(key); if (!movement) throw new Error("refresh_mismatch");
      return { supplierOrderItemId: item.id, target: { ...after, currentStock: movement.quantity_after }, entryQuantity: quantity,
        totalStockedQuantity: item.stockedQuantity, remainingQuantity: item.waitingStockQuantity,
        previousStock: movement.quantity_before, currentStock: movement.quantity_after } });
  } catch {
    baseSuccess.refreshWarning = true;
    baseSuccess.message += " A operação foi concluída, mas os detalhes não puderam ser atualizados agora.";
  }
  return { block: baseSuccess, contextSupplierOrderId: order.id,
    contextSupplierOrderCatalogCode: baseSuccess.lines[0]?.target.displayCode ?? null };
}

export function addSupplierOrderStockEntryRefreshWarning(result: AssistantSupplierOrderStockEntryConfirmationResult) {
  if (result.block.outcome !== "success") return result;
  return { ...result, block: { ...result.block, refreshWarning: true,
    message: `${result.block.message} Atualize a página para conferir os dados mais recentes.` } };
}
