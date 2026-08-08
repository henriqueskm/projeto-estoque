import type { SupplierOrderFinalizationRequest } from "./supplier-order-finalization-routing";
import type {
  AssistantChatSuccess,
  AssistantSupplierOrderCard,
  AssistantSupplierOrderFinalizationConfirmationResult,
  AssistantSupplierOrderFinalizationPreviewBlock,
  AssistantSupplierOrderFinalizationResultBlock,
} from "../assistant-types";
import type { SupplierOrderSummary } from "../supplier-orders-types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FinalizationActionResult =
  | { ok: true; receipt: { negotiationNumber: string } }
  | { ok: false; error: string; stale?: boolean };

export type SupplierOrderFinalizationProposalPayload = {
  version: 1;
  action: "supplier_order_finalization";
  userId: string;
  supplierOrderId: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
};

type SupplierOrderFinalizationTokenVerification =
  | { ok: true; payload: SupplierOrderFinalizationProposalPayload }
  | { ok: false; reason: "expired"; payload: SupplierOrderFinalizationProposalPayload }
  | { ok: false; reason: "configuration" | "invalid" | "user_mismatch" };

export type SupplierOrderFinalizationDependencies = {
  createIdempotencyKey: () => string;
  createProposal: (input: Omit<SupplierOrderFinalizationProposalPayload, "version" | "action" | "issuedAt" | "expiresAt">) => {
    payload: SupplierOrderFinalizationProposalPayload;
    token: string;
  } | null;
  verifyProposal: (proposalToken: string, expectedUserId: string) => SupplierOrderFinalizationTokenVerification;
  profileHasName: (name: unknown) => boolean;
  isOrderEligible: (order: SupplierOrderSummary) => boolean;
  loadOrdersByNegotiation: (negotiationNumber: string) => Promise<{
    failed: boolean;
    orders: SupplierOrderSummary[];
  }>;
  loadOrderById: (supplierOrderId: string) => Promise<{
    failed: boolean;
    order: SupplierOrderSummary | null;
  }>;
  getActiveProfile: () => Promise<{ userId: string; profileName: string | null } | null>;
  hasFinalizationEvent: (input: {
    supplierOrderId: string;
    idempotencyKey: string;
  }) => Promise<boolean>;
  finalize: (input: {
    supplier_order_id: string;
    expected_updated_at: string;
    finalization_note: null;
    idempotency_key: string;
  }) => Promise<FinalizationActionResult>;
};

function orderHref(order: SupplierOrderSummary) {
  return `/pedidos?view=${order.isInHistory ? "history" : "active"}&order=${encodeURIComponent(order.id)}`;
}

function toOrderCard(order: SupplierOrderSummary): AssistantSupplierOrderCard {
  return {
    id: order.id,
    negotiationNumber: order.negotiationNumber,
    orderDate: order.orderDate,
    status: order.status,
    closureKind: order.closureKind,
    lineCount: order.lineCount,
    orderedQuantity: order.orderedQuantity,
    pickedQuantity: order.pickedQuantity,
    waitingPickupQuantity: order.waitingPickupQuantity,
    stockedQuantity: order.stockedQuantity,
    waitingStockQuantity: order.waitingStockQuantity,
    href: orderHref(order),
  };
}

function createResult(
  outcome: AssistantSupplierOrderFinalizationResultBlock["outcome"],
  title: string,
  message: string,
  order: AssistantSupplierOrderCard | null = null,
): AssistantSupplierOrderFinalizationResultBlock {
  return {
    kind: "supplier_order_finalization_result",
    action: "supplier_order_finalization",
    outcome,
    title,
    message,
    order,
    occurredAt: null,
    idempotentReplay: false,
    actions: order ? [{ kind: "link", label: "Abrir Pedido", href: order.href }] : [],
  };
}

function answer(block: AssistantSupplierOrderFinalizationResultBlock): AssistantChatSuccess {
  return {
    message: block.message,
    structuredBlock: block,
    contextSupplierOrderId: block.order?.id ?? null,
    contextSupplierOrderCatalogCode: null,
  };
}

function confirmationResult(
  block: AssistantSupplierOrderFinalizationResultBlock,
): AssistantSupplierOrderFinalizationConfirmationResult {
  return {
    block,
    contextSupplierOrderId: block.order?.id ?? null,
    contextSupplierOrderCatalogCode: null,
  };
}

function finalizationIneligibility(order: SupplierOrderSummary) {
  if (order.cancelledAt !== null || order.closureKind === "CANCELLED" || order.status === "CANCELLED") {
    return {
      title: "Pedido cancelado",
      message: "Pedidos cancelados já pertencem ao Histórico e não podem ser finalizados.",
    };
  }

  if (order.isFinalized || order.closureKind === "FINALIZED") {
    return {
      title: "Pedido já finalizado",
      message: "Este Pedido já foi finalizado. Nenhuma operação foi executada.",
    };
  }

  return {
    title: "Pedido ainda não concluído",
    message: "Somente Pedidos concluídos e sem retirada pendente podem ser finalizados.",
  };
}

function profileInvalid(context: { userId: string; profileName: string | null }) {
  return !uuidPattern.test(context.userId);
}

function executionInput(payload: SupplierOrderFinalizationProposalPayload): {
  supplier_order_id: string;
  expected_updated_at: string;
  finalization_note: null;
  idempotency_key: string;
} {
  return {
    supplier_order_id: payload.supplierOrderId,
    expected_updated_at: payload.expectedUpdatedAt,
    finalization_note: null,
    idempotency_key: payload.idempotencyKey,
  };
}

export function createSupplierOrderFinalizationOperations(
  dependencies: SupplierOrderFinalizationDependencies,
) {
  async function createPreview(
    request: SupplierOrderFinalizationRequest,
    context: { userId: string; profileName: string | null },
  ): Promise<AssistantChatSuccess> {
    if (profileInvalid(context) || !dependencies.profileHasName(context.profileName)) {
      return answer(createResult("error", "Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de finalizar um Pedido."));
    }

    const resolved = await dependencies.loadOrdersByNegotiation(request.negotiationNumber);
    if (resolved.failed) return answer(createResult("error", "Consulta indisponível", "Não foi possível localizar o Pedido agora."));
    if (resolved.orders.length === 0) return answer(createResult("error", "Pedido não encontrado", "Não encontrei um único Pedido com esse número de negociação."));
    if (resolved.orders.length > 1) return answer(createResult("error", "Pedido ambíguo", "Encontrei mais de um Pedido com esse número. Abra a lista de Pedidos e informe a negociação exata."));

    const order = resolved.orders[0];
    if (!order) return answer(createResult("error", "Pedido não encontrado", "Não encontrei um único Pedido com esse número de negociação."));

    const card = toOrderCard(order);
    if (!dependencies.isOrderEligible(order)) {
      const message = finalizationIneligibility(order);
      return answer(createResult("error", message.title, message.message, card));
    }

    const signed = dependencies.createProposal(
      {
        userId: context.userId,
        supplierOrderId: order.id,
        expectedUpdatedAt: order.updatedAt,
        idempotencyKey: dependencies.createIdempotencyKey(),
      },
    );
    if (!signed) return answer(createResult("error", "Ação indisponível", "A confirmação operacional da Assistente ainda não está configurada.", card));

    const block: AssistantSupplierOrderFinalizationPreviewBlock = {
      kind: "supplier_order_finalization_preview",
      action: "supplier_order_finalization",
      state: "pending",
      title: "Finalizar Pedido",
      message: "O Pedido será relido e validado antes da finalização.",
      proposalToken: signed.token,
      expiresAt: new Date(signed.payload.expiresAt * 1000).toISOString(),
      order: card,
      confirmLabel: "Confirmar finalização",
      cancelLabel: "Cancelar",
      regeneratePrompt: `Finalize o Pedido ${order.negotiationNumber}.`,
    };
    return {
      message: block.message,
      structuredBlock: block,
      contextSupplierOrderId: order.id,
      contextSupplierOrderCatalogCode: null,
    };
  }

  async function confirm(proposalToken: string): Promise<AssistantSupplierOrderFinalizationConfirmationResult> {
    const context = await dependencies.getActiveProfile();
    if (!context || profileInvalid(context) || !dependencies.profileHasName(context.profileName)) {
      return confirmationResult(createResult("error", "Perfil incompleto", "Seu perfil precisa ter um nome cadastrado antes de finalizar um Pedido."));
    }

    const verified = dependencies.verifyProposal(proposalToken, context.userId);
    if (!verified.ok) {
      const expired = verified.reason === "expired";
      return confirmationResult(createResult(
        expired ? "expired" : "error",
        expired ? "Prévia expirada" : "Confirmação inválida",
        expired ? "Gere uma nova prévia com os dados atuais." : "Esta prévia não é válida para finalizar o Pedido.",
      ));
    }

    const payload = verified.payload;
    const loaded = await dependencies.loadOrderById(payload.supplierOrderId);
    if (loaded.failed || !loaded.order) {
      return confirmationResult(createResult("error", "Pedido não encontrado", "O Pedido desta prévia não está mais disponível."));
    }

    const order = loaded.order;
    const card = toOrderCard(order);
    if (order.cancelledAt !== null || order.closureKind === "CANCELLED" || order.status === "CANCELLED") {
      return confirmationResult(createResult("error", "Pedido cancelado", "Pedidos cancelados já pertencem ao Histórico e não podem ser finalizados.", card));
    }

    const idempotentReplay = await dependencies.hasFinalizationEvent({
      supplierOrderId: payload.supplierOrderId,
      idempotencyKey: payload.idempotencyKey,
    });
    const alreadyFinalized = order.isFinalized || order.closureKind === "FINALIZED";
    if (alreadyFinalized && !idempotentReplay) {
      return confirmationResult(createResult("error", "Pedido já finalizado", "Este Pedido já foi finalizado. Nenhuma operação foi executada.", card));
    }

    if (!alreadyFinalized && (!dependencies.isOrderEligible(order) || order.updatedAt !== payload.expectedUpdatedAt)) {
      return confirmationResult(createResult("conflict", "Pedido alterado", "Este Pedido mudou desde a prévia. Gere uma nova prévia antes de finalizar.", card));
    }

    let operation: FinalizationActionResult;
    try {
      operation = await dependencies.finalize(executionInput(payload));
    } catch {
      return confirmationResult(createResult("error", "Finalização não registrada", "Não foi possível registrar a finalização agora. Confira o Pedido antes de tentar novamente.", card));
    }

    if (!operation.ok) {
      return confirmationResult(createResult(
        operation.stale ? "conflict" : "error",
        operation.stale ? "Pedido alterado" : "Finalização não registrada",
        operation.error,
        card,
      ));
    }

    const refreshed = await dependencies.loadOrderById(payload.supplierOrderId);
    if (refreshed.failed || !refreshed.order) {
      const block = createResult("success", "Pedido finalizado", `O Pedido ${operation.receipt.negotiationNumber} foi finalizado com sucesso.`, card);
      block.refreshWarning = true;
      block.message += " A atualização visual pode exigir recarregar a página.";
      block.idempotentReplay = idempotentReplay;
      return confirmationResult(block);
    }

    const block = createResult(
      "success",
      "Pedido finalizado",
      `O Pedido ${refreshed.order.negotiationNumber} foi finalizado com sucesso.`,
      toOrderCard(refreshed.order),
    );
    block.occurredAt = refreshed.order.finalizedAt;
    block.idempotentReplay = idempotentReplay;
    return confirmationResult(block);
  }

  return { createPreview, confirm };
}

export function addSupplierOrderFinalizationRefreshWarning(result: AssistantSupplierOrderFinalizationConfirmationResult) {
  if (result.block.outcome !== "success") return result;
  return {
    ...result,
    block: {
      ...result.block,
      refreshWarning: true,
      message: `${result.block.message} A atualização visual pode exigir recarregar a página.`,
    },
  };
}
