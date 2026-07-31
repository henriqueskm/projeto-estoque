import "server-only";

import { randomUUID } from "node:crypto";
import {
  createSupplierOrderPickupProposalToken,
  verifySupplierOrderPickupProposalToken,
  type SupplierOrderPickupProposalPayload,
} from "@/lib/ai/assistant-action-token-core";
import {
  calculateSupplierOrderPickupTarget,
  createSupplierOrderPickupPrompt,
  summarizeSupplierOrderMarkAll,
  validateSupplierOrderPickupLine,
  type SupplierOrderPickupActionRequest,
} from "@/lib/ai/supplier-order-pickup-routing";
import {
  classifySupplierOrderPickupRpcFailure,
  createSupplierOrderPickupCheckedRpcCall,
  executeSupplierOrderPickupCheckedRpc,
  isSupplierOrderPickupActorAuthorized,
  parseSupplierOrderPickupRpcResult,
  type SupplierOrderPickupParsedRpcResult,
  type SupplierOrderPickupRpcFailureKind,
} from "@/lib/ai/supplier-order-pickup-execution";
import {
  addSupplierOrderPickupRefreshWarning,
  supplierOrderPickupRefreshWarning,
} from "@/lib/ai/supplier-order-pickup-result";
import type {
  AssistantChatSuccess,
  AssistantClarificationBlock,
  AssistantSupplierOrderCard,
  AssistantSupplierOrderPickupPreviewBlock,
  AssistantSupplierOrderPickupConfirmationResult,
  AssistantSupplierOrderPickupResultBlock,
} from "@/lib/assistant-types";
import {
  mapSupplierOrderItem,
  mapSupplierOrderSummary,
  supplierOrderItemSelect,
  supplierOrderSummarySelect,
  type SupplierOrderItemRow,
  type SupplierOrderSummaryRow,
} from "@/lib/supplier-orders-data";
import type {
  SupplierOrderItem,
  SupplierOrderSummary,
} from "@/lib/supplier-orders-types";
import { createClient } from "@/lib/supabase/server";

const maximumAmbiguityOptions = 6;
const maximumPreviewLines = 20;
const maximumTokenInputLength = 4096;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type PreviewContext = {
  userId: string;
  profileName: string | null;
  lastSupplierOrderId: string | null;
  selectedSupplierOrderItemId: string | null;
};

function normalizedCode(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR");
}

function displayCode(item: SupplierOrderItem) {
  return item.commercialCodeSnapshot ?? item.codeSnapshot;
}

function isEligibleOrder(order: SupplierOrderSummary) {
  return (
    order.isActiveOrder &&
    !order.isFinalized &&
    order.closureKind === null &&
    order.status !== "CANCELLED"
  );
}

function orderHref(order: SupplierOrderSummary) {
  return `/pedidos?view=${order.isInHistory ? "history" : "active"}&order=${encodeURIComponent(order.id)}`;
}

function toOrderCard(
  order: SupplierOrderSummary,
): AssistantSupplierOrderCard {
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

function statusLabel(order: SupplierOrderSummary) {
  if (order.isFinalized) return "Finalizado";
  if (order.status === "CANCELLED") return "Cancelado";

  return {
    PENDING: "Pendente",
    PARTIAL: "Parcial",
    COMPLETED: "Concluído",
    CANCELLED: "Cancelado",
  }[order.status];
}

function createResultBlock({
  outcome,
  title,
  message,
  order = null,
  actions = [],
}: {
  outcome: AssistantSupplierOrderPickupResultBlock["outcome"];
  title: string;
  message: string;
  order?: AssistantSupplierOrderCard | null;
  actions?: AssistantSupplierOrderPickupResultBlock["actions"];
}): AssistantSupplierOrderPickupResultBlock {
  return {
    kind: "assistant_action_result",
    action: "supplier_order_pickup",
    outcome,
    title,
    message,
    order,
    idempotentReplay: false,
    actions,
  };
}

type SupplierOrderPickupDiagnosticStage =
  | "authentication_failed"
  | "token_rejected"
  | "token_validated"
  | "order_loaded"
  | "item_loaded"
  | "target_calculated"
  | "rpc_started"
  | "rpc_failed"
  | "rpc_succeeded"
  | "result_invalid"
  | "result_parsed";

function safeDiagnosticErrorCode(value: unknown) {
  return typeof value === "string" && /^[A-Z0-9_]{1,24}$/i.test(value)
    ? value
    : "unknown";
}

function logSupplierOrderPickupDiagnostic(
  stage: SupplierOrderPickupDiagnosticStage,
  startedAt: number,
  details: {
    mode?: SupplierOrderPickupProposalPayload["mode"];
    target?: number | null;
    rpcName?: string;
    errorCode?: unknown;
    errorKind?: SupplierOrderPickupRpcFailureKind;
    status?: number;
    hasDetails?: boolean;
    hasHint?: boolean;
    hasResponse?: boolean;
    rejectionReason?: string;
  } = {},
) {
  const entry = {
    scope: "assistant_supplier_order_pickup",
    stage,
    durationMs: Math.max(Date.now() - startedAt, 0),
    ...details,
    ...(details.errorCode === undefined
      ? {}
      : { errorCode: safeDiagnosticErrorCode(details.errorCode) }),
  };

  if (stage === "rpc_failed" || stage === "result_invalid") {
    console.error(entry);
    return;
  }

  console.info(entry);
}

function rpcFailurePresentation(kind: SupplierOrderPickupRpcFailureKind) {
  switch (kind) {
    case "version_conflict":
      return {
        title: "Pedido alterado",
        message:
          "Este Pedido foi alterado desde a prévia. Gere uma nova prévia com os valores atuais.",
      };
    case "permission_denied":
      return {
        title: "Retirada não autorizada",
        message:
          "Seu perfil não tem permissão para registrar esta retirada. O Pedido permanece sem alteração.",
      };
    case "rpc_not_found":
      return {
        title: "Operação indisponível",
        message:
          "A operação de retirada está temporariamente indisponível. O Pedido permanece sem alteração.",
      };
    case "invalid_quantity":
      return {
        title: "Quantidade inválida",
        message:
          "A quantidade desta retirada não é válida para o Pedido atual. O Pedido permanece sem alteração.",
      };
    case "incompatible_order":
      return {
        title: "Pedido incompatível",
        message:
          "O estado atual deste Pedido não permite a retirada solicitada. O Pedido permanece sem alteração.",
      };
    case "temporary":
      return {
        title: "Falha temporária",
        message:
          "Não foi possível registrar a retirada agora. O Pedido permanece sem alteração.",
      };
    default:
      return {
        title: "Retirada não registrada",
        message:
          "Não foi possível registrar a retirada. O Pedido permanece sem alteração.",
      };
  }
}

function actionErrorResponse(
  title: string,
  message: string,
  order: SupplierOrderSummary | null = null,
): AssistantChatSuccess {
  const block = createResultBlock({
    outcome: "error",
    title,
    message,
    order: order ? toOrderCard(order) : null,
    actions: order
      ? [
          {
            kind: "link",
            label: "Abrir Pedido",
            href: orderHref(order),
          },
        ]
      : [],
  });

  return {
    message: block.message,
    structuredBlock: block,
    contextItemQuery: null,
    contextSupplierOrderId: order?.id ?? null,
    contextSupplierOrderCatalogCode: null,
  };
}

function createModeClarification(
  request: {
    catalogCode: string;
    requestedQuantity: number;
    negotiationNumber: string | null;
  },
): AssistantClarificationBlock {
  const suffix = request.negotiationNumber
    ? ` no Pedido ${request.negotiationNumber}`
    : " deste Pedido";
  const quantityLabel = `${request.requestedQuantity} unidade${request.requestedQuantity === 1 ? "" : "s"}`;

  return {
    kind: "assistant_clarification",
    title: `O que deseja registrar para o Cód. ${request.catalogCode}?`,
    message:
      "Escolha se a quantidade deve ser acrescentada ao retirado atual ou se representa o novo total.",
    options: [
      {
        id: "pickup-increment",
        label: `Retirar mais ${quantityLabel}`,
        prompt: `Retire mais ${quantityLabel} do Cód. ${request.catalogCode}${suffix}.`,
        category: "supplier_orders",
      },
      {
        id: "pickup-set-total",
        label: `Definir o total como ${request.requestedQuantity}`,
        prompt: `Defina o total retirado do Cód. ${request.catalogCode} como ${request.requestedQuantity}${suffix}.`,
        category: "supplier_orders",
      },
      {
        id: "pickup-cancel",
        label: "Cancelar",
        prompt: "Cancelar esta retirada.",
        category: "supplier_orders",
      },
    ],
    fallbackText:
      "Escolha se deseja acrescentar a quantidade ou definir o total retirado.",
  };
}

export function createSupplierOrderPickupModeClarification(
  request: {
    catalogCode: string;
    requestedQuantity: number;
    negotiationNumber: string | null;
  },
): AssistantChatSuccess {
  const block = createModeClarification(request);

  return {
    message: block.fallbackText,
    structuredBlock: block,
  };
}

async function loadSummaryById(
  supabase: SupabaseServerClient,
  orderId: string,
) {
  const result = await supabase
    .from("supplier_order_summaries")
    .select(supplierOrderSummarySelect)
    .eq("id", orderId)
    .maybeSingle();

  if (result.error) {
    return { order: null, failed: true };
  }

  return {
    order: result.data
      ? mapSupplierOrderSummary(result.data as SupplierOrderSummaryRow)
      : null,
    failed: false,
  };
}

async function loadSummariesByNegotiation(
  supabase: SupabaseServerClient,
  negotiationNumber: string,
) {
  const result = await supabase
    .from("supplier_order_summaries")
    .select(supplierOrderSummarySelect)
    .ilike("negotiation_number", negotiationNumber)
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(maximumAmbiguityOptions + 1);

  if (result.error) {
    return { orders: [], failed: true };
  }

  return {
    orders: ((result.data ?? []) as SupplierOrderSummaryRow[])
      .map(mapSupplierOrderSummary)
      .filter((order): order is SupplierOrderSummary => Boolean(order)),
    failed: false,
  };
}

async function loadOrderItems(
  supabase: SupabaseServerClient,
  orderId: string,
) {
  const result = await supabase
    .from("supplier_order_item_details")
    .select(supplierOrderItemSelect)
    .eq("supplier_order_id", orderId)
    .order("position", { ascending: true })
    .limit(1001);

  if (result.error || (result.data?.length ?? 0) > 1000) {
    return { items: [], failed: true };
  }

  return {
    items: ((result.data ?? []) as SupplierOrderItemRow[])
      .map(mapSupplierOrderItem)
      .filter((item): item is SupplierOrderItem => Boolean(item)),
    failed: false,
  };
}

async function loadOrderItemById(
  supabase: SupabaseServerClient,
  orderId: string,
  itemId: string,
) {
  const result = await supabase
    .from("supplier_order_item_details")
    .select(supplierOrderItemSelect)
    .eq("supplier_order_id", orderId)
    .eq("id", itemId)
    .maybeSingle();

  if (result.error) {
    return { item: null, failed: true };
  }

  return {
    item: result.data
      ? mapSupplierOrderItem(result.data as SupplierOrderItemRow)
      : null,
    failed: false,
  };
}

async function loadItemsForOrders(
  supabase: SupabaseServerClient,
  orderIds: string[],
) {
  const uniqueOrderIds = Array.from(new Set(orderIds)).slice(
    0,
    maximumAmbiguityOptions + 1,
  );

  if (uniqueOrderIds.length === 0) {
    return {
      itemsByOrder: new Map<string, SupplierOrderItem[]>(),
      failed: false,
    };
  }

  const maximumRows = uniqueOrderIds.length * 1000;
  const result = await supabase
    .from("supplier_order_item_details")
    .select(supplierOrderItemSelect)
    .in("supplier_order_id", uniqueOrderIds)
    .order("supplier_order_id", { ascending: true })
    .order("position", { ascending: true })
    .limit(maximumRows + 1);

  if (result.error || (result.data?.length ?? 0) > maximumRows) {
    return {
      itemsByOrder: new Map<string, SupplierOrderItem[]>(),
      failed: true,
    };
  }

  const itemsByOrder = new Map<string, SupplierOrderItem[]>(
    uniqueOrderIds.map((orderId) => [orderId, []]),
  );

  ((result.data ?? []) as SupplierOrderItemRow[])
    .map(mapSupplierOrderItem)
    .filter((item): item is SupplierOrderItem => Boolean(item))
    .forEach((item) => {
      itemsByOrder.get(item.supplierOrderId)?.push(item);
    });

  return { itemsByOrder, failed: false };
}

async function findOrdersContainingCode(
  supabase: SupabaseServerClient,
  code: string,
) {
  const linesResult = await supabase
    .from("supplier_order_item_details")
    .select(supplierOrderItemSelect)
    .or(
      `code_snapshot.ilike.${code},commercial_code_snapshot.ilike.${code}`,
    )
    .limit(101);

  if (linesResult.error || (linesResult.data?.length ?? 0) > 100) {
    return { candidates: [], failed: true };
  }

  const lines = ((linesResult.data ?? []) as SupplierOrderItemRow[])
    .map(mapSupplierOrderItem)
    .filter(
      (item): item is SupplierOrderItem =>
        Boolean(item) && normalizedCode(displayCode(item!)) === code,
    );
  const orderIds = Array.from(
    new Set(lines.map((line) => line.supplierOrderId)),
  );

  if (orderIds.length === 0) {
    return { candidates: [], failed: false };
  }

  const summariesResult = await supabase
    .from("supplier_order_summaries")
    .select(supplierOrderSummarySelect)
    .in("id", orderIds)
    .order("order_date", { ascending: false })
    .limit(maximumAmbiguityOptions + 1);

  if (summariesResult.error) {
    return { candidates: [], failed: true };
  }

  const orders = (
    (summariesResult.data ?? []) as SupplierOrderSummaryRow[]
  )
    .map(mapSupplierOrderSummary)
    .filter(
      (order): order is SupplierOrderSummary =>
        Boolean(order) && isEligibleOrder(order!),
    );

  return {
    candidates: orders.map((order) => ({
      order,
      lines: lines.filter((line) => line.supplierOrderId === order.id),
    })),
    failed: false,
  };
}

function createOrderAmbiguity(
  request: SupplierOrderPickupActionRequest,
  candidates: Array<{
    order: SupplierOrderSummary;
    lines: SupplierOrderItem[];
  }>,
) {
  const options = candidates
    .slice(0, maximumAmbiguityOptions)
    .map(({ order, lines }, index) => {
      const orderedQuantity = lines.reduce(
        (total, line) => total + line.orderedQuantity,
        0,
      );
      const pickedQuantity = lines.reduce(
        (total, line) => total + line.pickedQuantity,
        0,
      );
      const waitingQuantity = lines.reduce(
        (total, line) => total + line.waitingPickupQuantity,
        0,
      );

      return {
        id: `pickup-order-${index + 1}`,
        label: `Pedido ${order.negotiationNumber}`,
        description: `${order.orderDate} · ${statusLabel(order)} · Solicitado ${orderedQuantity} · Retirado ${pickedQuantity} · Falta ${waitingQuantity}`,
        prompt: createSupplierOrderPickupPrompt({
          ...request,
          negotiationNumber: null,
        }),
        category: "supplier_orders" as const,
        contextSupplierOrderId: order.id,
      };
    });

  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification",
    title: "Em qual Pedido deseja registrar a retirada?",
    message:
      candidates.length > maximumAmbiguityOptions
        ? `Encontrei mais de ${maximumAmbiguityOptions} Pedidos elegíveis. Refine pela negociação.`
        : "Escolha o Pedido correto pela negociação, data e quantidades.",
    options,
    fallbackText:
      "Encontrei mais de um Pedido possível. Escolha o registro correto antes de continuar.",
  };

  return {
    message: block.fallbackText,
    structuredBlock: block,
    contextSupplierOrderId: null,
    contextSupplierOrderCatalogCode: request.catalogCode,
  } satisfies AssistantChatSuccess;
}

function createLineAmbiguity(
  request: SupplierOrderPickupActionRequest,
  order: SupplierOrderSummary,
  lines: SupplierOrderItem[],
) {
  const options = lines
    .slice(0, maximumAmbiguityOptions)
    .map((line, index) => ({
      id: `pickup-line-${index + 1}`,
      label: `Cód. ${displayCode(line)} · ${line.descriptionSnapshot}`,
      description: `Solicitado ${line.orderedQuantity} · Retirado ${line.pickedQuantity} · Falta ${line.waitingPickupQuantity}`,
      prompt: createSupplierOrderPickupPrompt({
        ...request,
        negotiationNumber: null,
      }),
      category: "supplier_orders" as const,
      contextSupplierOrderId: order.id,
      contextSupplierOrderItemId: line.id,
    }));
  const block: AssistantClarificationBlock = {
    kind: "assistant_clarification",
    title: `Qual linha do Cód. ${request.catalogCode} deseja alterar?`,
    message:
      lines.length > maximumAmbiguityOptions
        ? `O Pedido possui mais de ${maximumAmbiguityOptions} linhas com esse código. Abra o Pedido para revisar.`
        : "Escolha explicitamente pela descrição e pelas quantidades.",
    options,
    fallbackText:
      "O mesmo código aparece em mais de uma linha. Escolha a linha correta antes de continuar.",
  };

  return {
    message: block.fallbackText,
    structuredBlock: block,
    contextSupplierOrderId: order.id,
    contextSupplierOrderCatalogCode: request.catalogCode,
  } satisfies AssistantChatSuccess;
}

function createCanonicalRegeneratePrompt(
  request: SupplierOrderPickupActionRequest,
  order: SupplierOrderSummary,
) {
  return createSupplierOrderPickupPrompt({
    ...request,
    negotiationNumber: order.negotiationNumber,
  });
}

function createNoChangeBlock(
  request: SupplierOrderPickupActionRequest,
  order: SupplierOrderSummary,
  item: SupplierOrderItem | null,
): AssistantChatSuccess {
  const block = createResultBlock({
    outcome: "no_change",
    title:
      request.mode === "mark_all"
        ? "Retirada já concluída"
        : "Nenhuma alteração necessária",
    message:
      request.mode === "mark_all"
        ? "Todos os itens disponíveis deste Pedido já foram retirados."
        : `O Cód. ${item ? displayCode(item) : request.catalogCode} já está com o total retirado informado.`,
    order: toOrderCard(order),
    actions: [
      {
        kind: "link",
        label: "Abrir Pedido",
        href: orderHref(order),
      },
    ],
  });

  return {
    message: block.message,
    structuredBlock: block,
    contextItemQuery: null,
    contextSupplierOrderId: order.id,
    contextSupplierOrderCatalogCode:
      item ? displayCode(item) : request.catalogCode,
  };
}

function createPreviewToken(
  request: SupplierOrderPickupActionRequest,
  order: SupplierOrderSummary,
  item: SupplierOrderItem | null,
  userId: string,
  targetPickedQuantity: number | null,
) {
  const secret = process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "";

  return createSupplierOrderPickupProposalToken(
    {
      mode: request.mode,
      userId,
      supplierOrderId: order.id,
      supplierOrderItemId: item?.id ?? null,
      requestedQuantity: request.requestedQuantity,
      targetPickedQuantity,
      expectedOrderUpdatedAt: order.updatedAt,
      idempotencyKey: randomUUID(),
    },
    secret,
  );
}

function buildPreview(
  request: SupplierOrderPickupActionRequest,
  order: SupplierOrderSummary,
  items: SupplierOrderItem[],
  selectedItem: SupplierOrderItem | null,
  userId: string,
): AssistantChatSuccess {
  const itemTarget =
    selectedItem && request.mode !== "mark_all"
      ? calculateSupplierOrderPickupTarget(
          request.mode,
          selectedItem.pickedQuantity,
          request.requestedQuantity!,
        )
      : null;
  const signedProposal = createPreviewToken(
    request,
    order,
    selectedItem,
    userId,
    itemTarget?.targetPickedQuantity ?? null,
  );

  if (!signedProposal) {
    return actionErrorResponse(
      "Ação indisponível",
      "A confirmação operacional da Assistente ainda não está configurada. Procure o administrador.",
      order,
    );
  }

  const base = {
    kind: "assistant_action_preview" as const,
    action: "supplier_order_pickup" as const,
    mode: request.mode,
    state: "pending" as const,
    title:
      request.mode === "mark_all"
        ? "Confirmar retirada de todos os itens"
        : "Confirmar retirada",
    message: `Pedido ${order.negotiationNumber} · ${statusLabel(order)}`,
    proposalToken: signedProposal.token,
    expiresAt: new Date(
      signedProposal.payload.expiresAt * 1000,
    ).toISOString(),
    order: toOrderCard(order),
    warnings: [] as string[],
    confirmLabel: "Confirmar retirada" as const,
    cancelLabel: "Cancelar" as const,
    regeneratePrompt: createCanonicalRegeneratePrompt(request, order),
  };
  let block: AssistantSupplierOrderPickupPreviewBlock;

  if (request.mode === "mark_all") {
    const lines = items.map((item) => {
      const targetPickedQuantity =
        item.orderedQuantity - item.cancelledQuantity;
      const addedQuantity = Math.max(
        targetPickedQuantity - item.pickedQuantity,
        0,
      );

      return {
        id: item.id,
        displayCode: displayCode(item),
        description: item.descriptionSnapshot,
        currentPickedQuantity: item.pickedQuantity,
        targetPickedQuantity,
        addedQuantity,
        alreadyComplete: addedQuantity === 0,
      };
    });
    const changedLines = lines.filter(
      (line) => !line.alreadyComplete,
    ).length;
    const addedPickedQuantity = lines.reduce(
      (total, line) => total + line.addedQuantity,
      0,
    );

    block = {
      ...base,
      mode: "mark_all",
      markAll: {
        changedLines,
        addedPickedQuantity,
        items: lines.slice(0, maximumPreviewLines),
        hiddenItemCount: Math.max(0, lines.length - maximumPreviewLines),
      },
    };
  } else {
    const item = selectedItem!;
    const target = itemTarget!;

    block = {
      ...base,
      mode: request.mode,
      item: {
        id: item.id,
        displayCode: displayCode(item),
        description: item.descriptionSnapshot,
        orderedQuantity: item.orderedQuantity,
        cancelledQuantity: item.cancelledQuantity,
        stockedQuantity: item.stockedQuantity,
        currentPickedQuantity: item.pickedQuantity,
        requestedQuantity: request.requestedQuantity!,
        addedQuantity: target.addedQuantity,
        targetPickedQuantity: target.targetPickedQuantity,
        remainingAfter:
          item.orderedQuantity -
          item.cancelledQuantity -
          target.targetPickedQuantity,
      },
    };
  }

  return {
    message: block.message,
    structuredBlock: block,
    contextItemQuery: null,
    contextSupplierOrderId: order.id,
    contextSupplierOrderCatalogCode:
      selectedItem ? displayCode(selectedItem) : null,
  };
}

export async function createAssistantSupplierOrderPickupPreview(
  request: SupplierOrderPickupActionRequest,
  context: PreviewContext,
): Promise<AssistantChatSuccess> {
  if (
    !context.profileName?.trim() ||
    !uuidPattern.test(context.userId)
  ) {
    return actionErrorResponse(
      "Perfil incompleto",
      "Seu perfil precisa estar ativo e com o nome cadastrado para registrar uma retirada.",
    );
  }

  const supabase = await createClient();
  let orderCandidates: SupplierOrderSummary[] = [];
  let candidateLines = new Map<string, SupplierOrderItem[]>();

  if (request.negotiationNumber) {
    const result = await loadSummariesByNegotiation(
      supabase,
      request.negotiationNumber,
    );

    if (result.failed) {
      return actionErrorResponse(
        "Consulta indisponível",
        "Não foi possível localizar o Pedido agora. Tente novamente.",
      );
    }

    orderCandidates = result.orders;
  } else if (context.lastSupplierOrderId) {
    const result = await loadSummaryById(
      supabase,
      context.lastSupplierOrderId,
    );

    if (result.failed) {
      return actionErrorResponse(
        "Consulta indisponível",
        "Não foi possível carregar o Pedido atual. Tente novamente.",
      );
    }

    orderCandidates = result.order ? [result.order] : [];
  } else if (request.catalogCode) {
    const result = await findOrdersContainingCode(
      supabase,
      request.catalogCode,
    );

    if (result.failed) {
      return actionErrorResponse(
        "Consulta indisponível",
        "Não foi possível localizar os Pedidos agora. Tente novamente.",
      );
    }

    orderCandidates = result.candidates.map(
      (candidate) => candidate.order,
    );
    candidateLines = new Map(
      result.candidates.map((candidate) => [
        candidate.order.id,
        candidate.lines,
      ]),
    );
  } else {
    const block: AssistantClarificationBlock = {
      kind: "assistant_clarification",
      title: "Qual é o Pedido?",
      message:
        "Informe o número da negociação antes de preparar a retirada total.",
      options: [
        {
          id: "pickup-inform-order",
          label: "Informar negociação",
          prompt: "Quero informar o número do Pedido para a retirada.",
          category: "supplier_orders",
        },
      ],
      fallbackText:
        "Informe o número da negociação do Pedido que deseja alterar.",
    };

    return {
      message: block.fallbackText,
      structuredBlock: block,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (orderCandidates.length === 0) {
    return actionErrorResponse(
      "Pedido não encontrado",
      request.negotiationNumber
        ? `Não encontrei um Pedido com a negociação “${request.negotiationNumber}”.`
        : request.catalogCode
          ? `Não encontrei um Pedido ativo com uma linha registrada como Cód. ${request.catalogCode}.`
          : "Não encontrei o Pedido informado.",
    );
  }

  const eligibleOrders = orderCandidates.filter(isEligibleOrder);

  if (eligibleOrders.length === 0) {
    return actionErrorResponse(
      "Pedido indisponível",
      "O Pedido está cancelado ou finalizado e não pode receber novas retiradas.",
      orderCandidates[0],
    );
  }

  if (eligibleOrders.length > 1) {
    const ordersWithoutLines = eligibleOrders.filter(
      (order) => !candidateLines.has(order.id),
    );
    const batchItems = await loadItemsForOrders(
      supabase,
      ordersWithoutLines.map((order) => order.id),
    );

    if (batchItems.failed) {
      return actionErrorResponse(
        "Consulta indisponível",
        "Não foi possível carregar as linhas dos Pedidos agora.",
      );
    }

    batchItems.itemsByOrder.forEach((items, orderId) => {
      candidateLines.set(
        orderId,
        request.mode === "mark_all"
          ? items
          : items.filter(
              (item) =>
                normalizedCode(displayCode(item)) ===
                request.catalogCode,
            ),
      );
    });

    return createOrderAmbiguity(
      request,
      eligibleOrders.map((order) => ({
        order,
        lines: candidateLines.get(order.id) ?? [],
      })),
    );
  }

  const order = eligibleOrders[0];
  const itemsResult = await loadOrderItems(supabase, order.id);

  if (itemsResult.failed) {
    return actionErrorResponse(
      "Consulta indisponível",
      "Não foi possível carregar os itens deste Pedido agora.",
      order,
    );
  }

  if (request.mode === "mark_all") {
    const markAllSummary = summarizeSupplierOrderMarkAll(
      itemsResult.items,
    );

    if (markAllSummary.addedPickedQuantity === 0) {
      return createNoChangeBlock(request, order, null);
    }

    return buildPreview(
      request,
      order,
      itemsResult.items,
      null,
      context.userId,
    );
  }

  const matchingLines = itemsResult.items.filter(
    (item) =>
      normalizedCode(displayCode(item)) === request.catalogCode,
  );

  if (matchingLines.length === 0) {
    return actionErrorResponse(
      "Linha não encontrada",
      `O Pedido não possui uma linha registrada como Cód. ${request.catalogCode}.`,
      order,
    );
  }

  const selectedLine = context.selectedSupplierOrderItemId
    ? matchingLines.find(
        (line) => line.id === context.selectedSupplierOrderItemId,
      ) ?? null
    : null;

  if (matchingLines.length > 1 && !selectedLine) {
    return createLineAmbiguity(request, order, matchingLines);
  }

  const item = selectedLine ?? matchingLines[0];
  const validation = validateSupplierOrderPickupLine(
    request.mode,
    request.requestedQuantity!,
    item,
  );

  if (validation.kind === "invalid") {
    return actionErrorResponse(
      "Quantidade inválida",
      "Informe uma quantidade inteira positiva dentro do limite permitido.",
      order,
    );
  }

  if (validation.kind === "reduction") {
    return actionErrorResponse(
      "Redução não disponível",
      "Nesta fase a Assistente não reduz quantidades já retiradas.",
      order,
    );
  }

  if (validation.kind === "no_change") {
    return createNoChangeBlock(request, order, item);
  }

  if (validation.kind === "above_limit") {
    return actionErrorResponse(
      "Quantidade acima do limite",
      `O máximo retirável do Cód. ${displayCode(item)} neste Pedido é ${validation.pickupLimit}.`,
      order,
    );
  }

  if (validation.kind === "below_stocked") {
    return actionErrorResponse(
      "Quantidade inválida",
      "O total retirado não pode ficar abaixo do que já entrou no estoque.",
      order,
    );
  }

  return buildPreview(
    request,
    order,
    itemsResult.items,
    item,
    context.userId,
  );
}

function proposalPrompt(
  payload: SupplierOrderPickupProposalPayload,
  order: SupplierOrderSummary,
  item: SupplierOrderItem | null,
) {
  return createSupplierOrderPickupPrompt({
    mode: payload.mode,
    catalogCode: item ? displayCode(item) : null,
    requestedQuantity: payload.requestedQuantity,
    negotiationNumber: order.negotiationNumber,
  });
}

function conflictResult(
  order: SupplierOrderSummary,
  prompt: string,
): AssistantSupplierOrderPickupConfirmationResult {
  return {
    block: createResultBlock({
      outcome: "conflict",
      title: "Pedido alterado",
      message:
        "Este Pedido foi alterado desde a prévia. Gere uma nova prévia com os valores atuais.",
      order: toOrderCard(order),
      actions: [
        {
          kind: "prompt",
          label: "Gerar nova prévia",
          prompt,
        },
        {
          kind: "link",
          label: "Abrir Pedido",
          href: orderHref(order),
        },
      ],
    }),
    contextSupplierOrderId: order.id,
    contextSupplierOrderCatalogCode: null,
  };
}

function confirmedPickupWithRefreshWarning(
  parsedRpcResult: SupplierOrderPickupParsedRpcResult,
  order: SupplierOrderSummary,
  item: SupplierOrderItem | null,
): AssistantSupplierOrderPickupConfirmationResult {
  const actions: AssistantSupplierOrderPickupResultBlock["actions"] = [
    {
      kind: "link",
      label: "Abrir Pedido",
      href: orderHref(order),
    },
  ];
  let block: AssistantSupplierOrderPickupResultBlock;

  if (parsedRpcResult.mode === "mark_all") {
    block = {
      ...createResultBlock({
        outcome: "success",
        title: "Retirada registrada",
        message: supplierOrderPickupRefreshWarning,
        order: toOrderCard(order),
        actions,
      }),
      idempotentReplay: parsedRpcResult.value.idempotentReplay,
      markAll: {
        changedLines: parsedRpcResult.value.changedLineCount,
        addedPickedQuantity:
          parsedRpcResult.value.addedPickedQuantity,
      },
    };
  } else {
    const fallbackItem = item!;
    const previousPickedQuantity =
      parsedRpcResult.value.previousPickedQuantity;
    const currentPickedQuantity =
      parsedRpcResult.value.newPickedQuantity;
    const addedPickedQuantity =
      parsedRpcResult.value.pickedQuantityDelta;

    block = {
      ...createResultBlock({
        outcome: "success",
        title: "Retirada registrada",
        message: supplierOrderPickupRefreshWarning,
        order: toOrderCard(order),
        actions,
      }),
      idempotentReplay: parsedRpcResult.value.idempotentReplay,
      item: {
        id: fallbackItem.id,
        displayCode: displayCode(fallbackItem),
        description: fallbackItem.descriptionSnapshot,
        previousPickedQuantity,
        addedPickedQuantity,
        currentPickedQuantity,
        remainingPickupQuantity: Math.max(
          fallbackItem.orderedQuantity -
            fallbackItem.cancelledQuantity -
            currentPickedQuantity,
          0,
        ),
      },
    };
  }

  return addSupplierOrderPickupRefreshWarning({
    block,
    contextSupplierOrderId: order.id,
    contextSupplierOrderCatalogCode: item
      ? displayCode(item)
      : null,
  });
}

async function authenticateConfirmation() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId || !uuidPattern.test(userId)) {
    return { supabase, userId: null, profileName: null };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();
  const profileName =
    typeof profile?.name === "string" ? profile.name.trim() : "";

  return {
    supabase,
    userId:
      !profileError && profile && profileName ? userId : null,
    profileName: profileName || null,
  };
}

function invalidConfirmationResult(
  title: string,
  message: string,
  outcome: "error" | "expired" = "error",
): AssistantSupplierOrderPickupConfirmationResult {
  return {
    block: createResultBlock({
      outcome,
      title,
      message,
    }),
    contextSupplierOrderId: null,
    contextSupplierOrderCatalogCode: null,
  };
}

export async function confirmAssistantSupplierOrderPickup(
  proposalToken: unknown,
): Promise<AssistantSupplierOrderPickupConfirmationResult> {
  const diagnosticStartedAt = Date.now();

  if (
    typeof proposalToken !== "string" ||
    !proposalToken ||
    proposalToken.length > maximumTokenInputLength
  ) {
    logSupplierOrderPickupDiagnostic(
      "token_rejected",
      diagnosticStartedAt,
      { rejectionReason: "invalid_input" },
    );
    return invalidConfirmationResult(
      "Prévia inválida",
      "Solicite uma nova prévia antes de confirmar a retirada.",
    );
  }

  const authentication = await authenticateConfirmation();

  if (
    !authentication.userId ||
    !authentication.profileName ||
    !isSupplierOrderPickupActorAuthorized(
      authentication.userId,
      authentication.profileName,
    )
  ) {
    logSupplierOrderPickupDiagnostic(
      "authentication_failed",
      diagnosticStartedAt,
    );
    return invalidConfirmationResult(
      "Acesso indisponível",
      "Sua sessão, perfil ativo ou nome cadastrado não está disponível.",
    );
  }

  const secret =
    process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "";
  const verification = verifySupplierOrderPickupProposalToken(
    proposalToken,
    secret,
    authentication.userId,
  );

  if (!verification.ok) {
    logSupplierOrderPickupDiagnostic(
      "token_rejected",
      diagnosticStartedAt,
      { rejectionReason: verification.reason },
    );

    if (verification.reason === "configuration") {
      return invalidConfirmationResult(
        "Ação indisponível",
        "A confirmação operacional da Assistente ainda não está configurada.",
      );
    }

    if (verification.reason === "expired") {
      return invalidConfirmationResult(
        "Prévia expirada",
        "Solicite novamente a retirada para confirmar com os valores atuais.",
        "expired",
      );
    }

    return invalidConfirmationResult(
      "Prévia inválida",
      "Esta prévia não pode ser confirmada. Solicite uma nova retirada.",
    );
  }

  const payload = verification.payload;
  logSupplierOrderPickupDiagnostic(
    "token_validated",
    diagnosticStartedAt,
    { mode: payload.mode },
  );
  const orderResult = await loadSummaryById(
    authentication.supabase,
    payload.supplierOrderId,
  );

  if (orderResult.failed || !orderResult.order) {
    return invalidConfirmationResult(
      "Pedido não encontrado",
      "O Pedido desta prévia não está mais disponível.",
    );
  }

  const order = orderResult.order;
  logSupplierOrderPickupDiagnostic(
    "order_loaded",
    diagnosticStartedAt,
    { mode: payload.mode },
  );
  const itemResult = payload.supplierOrderItemId
    ? await loadOrderItemById(
        authentication.supabase,
        order.id,
        payload.supplierOrderItemId,
      )
    : { item: null, failed: false };

  if (itemResult.failed) {
    return invalidConfirmationResult(
      "Consulta indisponível",
      "Não foi possível revalidar a linha do Pedido agora.",
    );
  }

  const item = itemResult.item;
  logSupplierOrderPickupDiagnostic(
    "item_loaded",
    diagnosticStartedAt,
    { mode: payload.mode },
  );
  const prompt = proposalPrompt(payload, order, item);

  if (!isEligibleOrder(order)) {
    return {
      block: createResultBlock({
        outcome: "error",
        title: "Pedido indisponível",
        message:
          "O Pedido foi cancelado ou finalizado e não pode receber novas retiradas.",
        order: toOrderCard(order),
        actions: [
          {
            kind: "prompt",
            label: "Gerar nova prévia",
            prompt,
          },
          {
            kind: "link",
            label: "Abrir Pedido",
            href: orderHref(order),
          },
        ],
      }),
      contextSupplierOrderId: order.id,
      contextSupplierOrderCatalogCode: item
        ? displayCode(item)
        : null,
    };
  }

  if (payload.mode !== "mark_all" && !item) {
    return {
      block: createResultBlock({
        outcome: "error",
        title: "Linha não encontrada",
        message:
          "A linha desta prévia não está mais disponível no Pedido.",
        order: toOrderCard(order),
      }),
      contextSupplierOrderId: order.id,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (payload.mode !== "mark_all") {
    const targetPickedQuantity = payload.targetPickedQuantity;
    const pickupLimit =
      item!.orderedQuantity - item!.cancelledQuantity;

    if (
      targetPickedQuantity === null ||
      targetPickedQuantity < item!.pickedQuantity ||
      targetPickedQuantity > pickupLimit ||
      targetPickedQuantity < item!.stockedQuantity
    ) {
      return conflictResult(order, prompt);
    }

  }

  logSupplierOrderPickupDiagnostic(
    "target_calculated",
    diagnosticStartedAt,
    {
      mode: payload.mode,
      target: payload.targetPickedQuantity,
    },
  );
  const rpcCall = createSupplierOrderPickupCheckedRpcCall(payload);

  if (!rpcCall) {
    return invalidConfirmationResult(
      "Prévia inválida",
      "A quantidade desta prévia não pôde ser validada. Solicite uma nova retirada.",
    );
  }

  logSupplierOrderPickupDiagnostic(
    "rpc_started",
    diagnosticStartedAt,
    {
      mode: payload.mode,
      target: payload.targetPickedQuantity,
      rpcName: rpcCall.name,
    },
  );
  const rpcResult = await executeSupplierOrderPickupCheckedRpc(
    authentication.supabase,
    payload,
  );

  if (rpcResult.error) {
    const failureKind =
      classifySupplierOrderPickupRpcFailure(rpcResult);
    const presentation = rpcFailurePresentation(failureKind);

    logSupplierOrderPickupDiagnostic(
      "rpc_failed",
      diagnosticStartedAt,
      {
        mode: payload.mode,
        target: payload.targetPickedQuantity,
        rpcName: rpcCall.name,
        errorCode: rpcResult.error.code,
        errorKind: failureKind,
        status: rpcResult.status,
        hasDetails: Boolean(rpcResult.error.details),
        hasHint: Boolean(rpcResult.error.hint),
        hasResponse: true,
      },
    );

    if (failureKind === "version_conflict") {
      return conflictResult(order, prompt);
    }

    return {
      block: createResultBlock({
        outcome: "error",
        title: presentation.title,
        message: presentation.message,
        order: toOrderCard(order),
        actions: [
          {
            kind: "link",
            label: "Abrir Pedido",
            href: orderHref(order),
          },
        ],
      }),
      contextSupplierOrderId: order.id,
      contextSupplierOrderCatalogCode: item
        ? displayCode(item)
        : null,
    };
  }

  logSupplierOrderPickupDiagnostic(
    "rpc_succeeded",
    diagnosticStartedAt,
    {
      mode: payload.mode,
      target: payload.targetPickedQuantity,
      rpcName: rpcCall.name,
      status: rpcResult.status,
      hasResponse: rpcResult.data !== null,
    },
  );
  const parsedRpcResult = parseSupplierOrderPickupRpcResult(
    rpcResult.data,
    payload.mode,
  );

  logSupplierOrderPickupDiagnostic(
    parsedRpcResult ? "result_parsed" : "result_invalid",
    diagnosticStartedAt,
    {
      mode: payload.mode,
      target: payload.targetPickedQuantity,
      rpcName: rpcCall.name,
      status: rpcResult.status,
      hasResponse: rpcResult.data !== null,
    },
  );

  if (!parsedRpcResult) {
    return {
      block: createResultBlock({
        outcome: "error",
        title: "Resultado não confirmado",
        message:
          "A operação respondeu, mas o resultado não pôde ser validado. Confira o Pedido antes de realizar qualquer nova tentativa.",
        order: toOrderCard(order),
        actions: [
          {
            kind: "link",
            label: "Abrir Pedido",
            href: orderHref(order),
          },
        ],
      }),
      contextSupplierOrderId: order.id,
      contextSupplierOrderCatalogCode: item
        ? displayCode(item)
        : null,
    };
  }

  let finalOrderResult: Awaited<ReturnType<typeof loadSummaryById>>;
  let finalItemResult:
    | Awaited<ReturnType<typeof loadOrderItemById>>
    | { item: null; failed: false };

  try {
    [finalOrderResult, finalItemResult] = await Promise.all([
      loadSummaryById(authentication.supabase, order.id),
      item
        ? loadOrderItemById(
            authentication.supabase,
            order.id,
            item.id,
          )
        : Promise.resolve({ item: null, failed: false } as const),
    ]);
  } catch {
    return confirmedPickupWithRefreshWarning(
      parsedRpcResult,
      order,
      item,
    );
  }

  const finalOrder = finalOrderResult.order;
  const finalItem = finalItemResult.item;

  if (
    finalOrderResult.failed ||
    !finalOrder ||
    finalItemResult.failed ||
    (item && !finalItem)
  ) {
    return confirmedPickupWithRefreshWarning(
      parsedRpcResult,
      order,
      item,
    );
  }

  const idempotentReplay =
    parsedRpcResult.value.idempotentReplay;
  const baseActions: AssistantSupplierOrderPickupResultBlock["actions"] =
    [
      {
        kind: "link",
        label: "Abrir Pedido",
        href: orderHref(finalOrder),
      },
      {
        kind: "prompt",
        label: "Ver o que ainda falta retirar",
        prompt: item
          ? `Quanto falta retirar do Cód. ${displayCode(item)} no Pedido ${finalOrder.negotiationNumber}?`
          : `Quais itens ainda faltam retirar do Pedido ${finalOrder.negotiationNumber}?`,
      },
    ];
  let block: AssistantSupplierOrderPickupResultBlock;

  if (payload.mode === "mark_all") {
    if (parsedRpcResult.mode !== "mark_all") {
      return invalidConfirmationResult(
        "Resultado não confirmado",
        "O retorno da operação não corresponde à retirada solicitada. Confira o Pedido antes de realizar qualquer nova tentativa.",
      );
    }

    const changedLines =
      parsedRpcResult.value.changedLineCount;
    const addedPickedQuantity =
      parsedRpcResult.value.addedPickedQuantity;

    block = {
      ...createResultBlock({
        outcome:
          changedLines === 0 && !idempotentReplay
            ? "no_change"
            : "success",
        title:
          changedLines === 0 && !idempotentReplay
            ? "Nenhuma alteração necessária"
            : "Retirada registrada",
        message:
          changedLines === 0 && !idempotentReplay
            ? "Todos os itens disponíveis deste Pedido já estavam retirados."
            : `${addedPickedQuantity} ${
                addedPickedQuantity === 1
                  ? "unidade adicional marcada como retirada"
                  : "unidades adicionais marcadas como retiradas"
              }.`,
        order: toOrderCard(finalOrder),
        actions: baseActions,
      }),
      idempotentReplay,
      markAll: {
        changedLines,
        addedPickedQuantity,
      },
    };
  } else {
    if (parsedRpcResult.mode !== "line") {
      return invalidConfirmationResult(
        "Resultado não confirmado",
        "O retorno da operação não corresponde à retirada solicitada. Confira o Pedido antes de realizar qualquer nova tentativa.",
      );
    }

    const previousPickedQuantity =
      parsedRpcResult.value.previousPickedQuantity;
    const currentPickedQuantity =
      parsedRpcResult.value.newPickedQuantity;
    const addedPickedQuantity =
      parsedRpcResult.value.pickedQuantityDelta;

    block = {
      ...createResultBlock({
        outcome: "success",
        title: "Retirada registrada",
        message: `Cód. ${displayCode(finalItem!)} atualizado no Pedido ${finalOrder.negotiationNumber}.`,
        order: toOrderCard(finalOrder),
        actions: baseActions,
      }),
      idempotentReplay,
      item: {
        id: finalItem!.id,
        displayCode: displayCode(finalItem!),
        description: finalItem!.descriptionSnapshot,
        previousPickedQuantity,
        addedPickedQuantity,
        currentPickedQuantity,
        remainingPickupQuantity:
          finalItem!.waitingPickupQuantity,
      },
    };
  }

  return {
    block,
    contextSupplierOrderId: finalOrder.id,
    contextSupplierOrderCatalogCode: finalItem
      ? displayCode(finalItem)
      : null,
  };
}
