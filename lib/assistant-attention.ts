export const assistantAttentionMaxItems = 5;
export const assistantAttentionDetailLineLimit = 5;

export type AssistantAttentionSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "INFO";

export type AssistantAttentionReplenishmentSnapshot = {
  targetKind: "item" | "commercial_configuration";
  targetId: string;
  primaryCode: string;
  currentStock: number;
  minimumStock: number | null;
  pendingPurchaseQuantity: number;
  remainingGap: number | null;
};

export type AssistantAttentionReadyPickupSnapshot = {
  supplierOrderId: string;
  negotiationNumber: string;
  readyWaitingPickupQuantity: number;
};

export type AssistantAttentionPendingStockSnapshot = {
  supplierOrderId: string;
  negotiationNumber: string;
  orderDate: string;
  waitingStockQuantity: number;
};

type AssistantAttentionDetail<TLine> = {
  lines: TLine[];
  remainingCount: number;
};

type AssistantAttentionBaseItem = {
  severity: AssistantAttentionSeverity;
  title: string;
  summary: string;
  count: number;
};

export type AssistantAttentionItem =
  | (AssistantAttentionBaseItem & {
      kind: "REPLENISHMENT_NEEDED";
      metadata: {
        uncoveredCount: number;
        partiallyCoveredCount: number;
        zeroStockCount: number;
      };
      detail: AssistantAttentionDetail<{
        code: string;
        currentStock: number;
        minimumStock: number;
        pendingPurchaseQuantity: number;
        remainingGap: number;
      }>;
    })
  | (AssistantAttentionBaseItem & {
      kind: "SAFISA_READY_PICKUP";
      metadata: {
        readyQuantity: number;
      };
      detail: AssistantAttentionDetail<{
        negotiationNumber: string;
        quantity: number;
      }>;
    })
  | (AssistantAttentionBaseItem & {
      kind: "SUPPLIER_ORDER_PENDING_STOCK";
      metadata: {
        waitingStockQuantity: number;
      };
      detail: AssistantAttentionDetail<{
        negotiationNumber: string;
        quantity: number;
      }>;
    });

export type AssistantAttentionSummary = {
  generatedAt: string;
  status: "HAS_ATTENTION" | "ALL_CLEAR";
  items: AssistantAttentionItem[];
};

export type AssistantAttentionInput = {
  purchaseRecommendations: AssistantAttentionReplenishmentSnapshot[];
  readyPickupOrders: AssistantAttentionReadyPickupSnapshot[];
  pendingStockOrders: AssistantAttentionPendingStockSnapshot[];
};

const severityRank: Record<AssistantAttentionSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  INFO: 3,
};

const kindRank: Record<AssistantAttentionItem["kind"], number> = {
  REPLENISHMENT_NEEDED: 0,
  SAFISA_READY_PICKUP: 1,
  SUPPLIER_ORDER_PENDING_STOCK: 2,
};

function safeQuantity(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function plural(value: number, singular: string, pluralForm: string) {
  return value === 1 ? singular : pluralForm;
}

function uniqueByOrderId<T extends { supplierOrderId: string }>(rows: T[]) {
  return Array.from(
    new Map(rows.map((row) => [row.supplierOrderId, row])).values(),
  );
}

function compareCodes(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function limitDetailLines<T>(lines: T[]) {
  return {
    lines: lines.slice(0, assistantAttentionDetailLineLimit),
    remainingCount: Math.max(0, lines.length - assistantAttentionDetailLineLimit),
  };
}

function buildReplenishmentItem(
  snapshots: AssistantAttentionReplenishmentSnapshot[],
): AssistantAttentionItem | null {
  const targets = Array.from(
    new Map(
      snapshots.map((snapshot) => [
        `${snapshot.targetKind}:${snapshot.targetId}`,
        snapshot,
      ]),
    ).values(),
  ).filter(
    (snapshot) =>
      snapshot.minimumStock !== null &&
      safeQuantity(snapshot.remainingGap ?? 0) > 0,
  );

  if (targets.length === 0) return null;

  const orderedTargets = targets.sort(
    (first, second) =>
      Number(first.currentStock !== 0) - Number(second.currentStock !== 0) ||
      safeQuantity(second.remainingGap ?? 0) -
        safeQuantity(first.remainingGap ?? 0) ||
      compareCodes(first.primaryCode, second.primaryCode) ||
      first.targetId.localeCompare(second.targetId),
  );

  const uncoveredCount = orderedTargets.filter(
    (target) => safeQuantity(target.pendingPurchaseQuantity) === 0,
  ).length;
  const partiallyCoveredCount = orderedTargets.length - uncoveredCount;
  const zeroStockCount = orderedTargets.filter(
    (target) => safeQuantity(target.currentStock) === 0,
  ).length;
  const details = [
    uncoveredCount > 0
      ? `${uncoveredCount} ${plural(uncoveredCount, "ainda está sem cobertura", "ainda estão sem cobertura")} em Pedidos.`
      : null,
    partiallyCoveredCount > 0
      ? `${partiallyCoveredCount} ${plural(partiallyCoveredCount, "tem cobertura parcial", "têm cobertura parcial")}.`
      : null,
  ].filter((detail): detail is string => Boolean(detail));

  return {
    kind: "REPLENISHMENT_NEEDED",
    severity: zeroStockCount > 0 ? "CRITICAL" : "HIGH",
    title: "Reposição necessária",
    summary: `${orderedTargets.length} ${plural(orderedTargets.length, "item precisa", "itens precisam")} de reposição. ${details.join(" ")}`.trim(),
    count: orderedTargets.length,
    metadata: {
      uncoveredCount,
      partiallyCoveredCount,
      zeroStockCount,
    },
    detail: limitDetailLines(
      orderedTargets.map((target) => ({
        code: target.primaryCode,
        currentStock: safeQuantity(target.currentStock),
        minimumStock: safeQuantity(target.minimumStock ?? 0),
        pendingPurchaseQuantity: safeQuantity(
          target.pendingPurchaseQuantity,
        ),
        remainingGap: safeQuantity(target.remainingGap ?? 0),
      })),
    ),
  };
}

function buildReadyPickupItem(
  snapshots: AssistantAttentionReadyPickupSnapshot[],
): AssistantAttentionItem | null {
  const orders = uniqueByOrderId(snapshots).filter(
    (order) => safeQuantity(order.readyWaitingPickupQuantity) > 0,
  );

  if (orders.length === 0) return null;

  const readyQuantity = orders.reduce(
    (total, order) => total + safeQuantity(order.readyWaitingPickupQuantity),
    0,
  );

  return {
    kind: "SAFISA_READY_PICKUP",
    severity: "MEDIUM",
    title: "Itens prontos na Safisa",
    summary: `${orders.length} ${plural(orders.length, "Pedido tem", "Pedidos têm")} ${readyQuantity} ${plural(readyQuantity, "unidade pronta", "unidades prontas")} para retirada.`,
    count: orders.length,
    metadata: { readyQuantity },
    detail: limitDetailLines(
      orders.map((order) => ({
        negotiationNumber: order.negotiationNumber,
        quantity: safeQuantity(order.readyWaitingPickupQuantity),
      })),
    ),
  };
}

function buildPendingStockItem(
  snapshots: AssistantAttentionPendingStockSnapshot[],
): AssistantAttentionItem | null {
  const orders = uniqueByOrderId(snapshots)
    .filter((order) => safeQuantity(order.waitingStockQuantity) > 0)
    .sort(
      (first, second) =>
        safeQuantity(second.waitingStockQuantity) -
          safeQuantity(first.waitingStockQuantity) ||
        second.orderDate.localeCompare(first.orderDate) ||
        compareCodes(first.negotiationNumber, second.negotiationNumber) ||
        first.supplierOrderId.localeCompare(second.supplierOrderId),
    );

  if (orders.length === 0) return null;

  const waitingStockQuantity = orders.reduce(
    (total, order) => total + safeQuantity(order.waitingStockQuantity),
    0,
  );

  return {
    kind: "SUPPLIER_ORDER_PENDING_STOCK",
    severity: "MEDIUM",
    title: "Entrada pendente",
    summary: `${orders.length} ${plural(orders.length, "Pedido possui", "Pedidos possuem")} ${waitingStockQuantity} ${plural(waitingStockQuantity, "unidade retirada aguardando", "unidades retiradas aguardando")} entrada no estoque.`,
    count: orders.length,
    metadata: { waitingStockQuantity },
    detail: limitDetailLines(
      orders.map((order) => ({
        negotiationNumber: order.negotiationNumber,
        quantity: safeQuantity(order.waitingStockQuantity),
      })),
    ),
  };
}

export function buildAssistantAttentionSummary(
  input: AssistantAttentionInput,
  generatedAt = new Date(),
): AssistantAttentionSummary {
  const items = [
    buildReplenishmentItem(input.purchaseRecommendations),
    buildReadyPickupItem(input.readyPickupOrders),
    buildPendingStockItem(input.pendingStockOrders),
  ]
    .filter((item): item is AssistantAttentionItem => Boolean(item))
    .sort(
      (first, second) =>
        severityRank[first.severity] - severityRank[second.severity] ||
        kindRank[first.kind] - kindRank[second.kind],
    )
    .slice(0, assistantAttentionMaxItems);

  return {
    generatedAt: generatedAt.toISOString(),
    status: items.length > 0 ? "HAS_ATTENTION" : "ALL_CLEAR",
    items,
  };
}
