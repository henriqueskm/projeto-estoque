import type {
  PurchaseRecommendationCatalogTarget,
  PurchaseRecommendationItem,
  PurchaseRecommendationPendingLine,
  PurchaseRecommendationTargetKind,
  PurchaseRecommendationsData,
} from "@/lib/purchase-recommendation-types";

function compareCodes(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function targetKey(
  targetKind: PurchaseRecommendationTargetKind,
  targetId: string,
) {
  return `${targetKind}:${targetId}`;
}

function safeAdd(first: number, second: number) {
  const result = first + second;

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Invalid purchase recommendation quantity.");
  }

  return result;
}

function compareOrders(
  first: PurchaseRecommendationPendingLine,
  second: PurchaseRecommendationPendingLine,
) {
  return (
    second.orderDate.localeCompare(first.orderDate) ||
    compareCodes(first.negotiationNumber, second.negotiationNumber) ||
    first.orderId.localeCompare(second.orderId) ||
    compareCodes(first.codeSnapshot, second.codeSnapshot)
  );
}

/**
 * Ordering is stable and operational:
 * - buy now: largest recommendation, zero stock first on ties, then code;
 * - already ordered: insufficient coverage first, largest remaining gap, code;
 * - missing minimum: zero stock first, lowest current stock, then code.
 */
export function buildPurchaseRecommendations(
  catalog: PurchaseRecommendationCatalogTarget[],
  pendingLines: PurchaseRecommendationPendingLine[],
): PurchaseRecommendationsData {
  const pendingByTarget = new Map<
    string,
    {
      quantity: number;
      lines: PurchaseRecommendationPendingLine[];
    }
  >();

  pendingLines.forEach((line) => {
    const waitingPickup = line.waitingPickupQuantity;
    const waitingStock = line.waitingStockQuantity;

    if (
      !Number.isSafeInteger(waitingPickup) ||
      waitingPickup < 0 ||
      !Number.isSafeInteger(waitingStock) ||
      waitingStock < 0
    ) {
      throw new Error("Invalid supplier order pending quantity.");
    }

    const pendingQuantity = safeAdd(waitingPickup, waitingStock);

    if (pendingQuantity === 0) {
      return;
    }

    const key = targetKey(line.targetKind, line.targetId);
    const current = pendingByTarget.get(key) ?? {
      quantity: 0,
      lines: [],
    };
    current.quantity = safeAdd(current.quantity, pendingQuantity);
    current.lines.push(line);
    pendingByTarget.set(key, current);
  });

  const allItems = catalog.map<PurchaseRecommendationItem>((target) => {
    if (
      !Number.isSafeInteger(target.currentStock) ||
      target.currentStock < 0 ||
      !Number.isSafeInteger(target.minimumStock) ||
      target.minimumStock < 0
    ) {
      throw new Error("Invalid stock recommendation input.");
    }

    const pending = pendingByTarget.get(
      targetKey(target.targetKind, target.targetId),
    );
    const pendingQuantity = pending?.quantity ?? 0;
    const minimumStock =
      target.minimumStock > 0 ? target.minimumStock : null;
    const shortfall =
      minimumStock === null
        ? null
        : Math.max(minimumStock - target.currentStock, 0);
    const projectedStock =
      minimumStock === null
        ? null
        : safeAdd(target.currentStock, pendingQuantity);
    const remainingGap =
      minimumStock === null || projectedStock === null
        ? null
        : Math.max(minimumStock - projectedStock, 0);
    const belowMinimum = shortfall !== null && shortfall > 0;
    const group =
      minimumStock === null
        ? "MISSING_MINIMUM"
        : !belowMinimum
          ? "NO_ACTION"
          : pendingQuantity > 0
            ? "ALREADY_ORDERED"
            : "BUY_NOW";

    return {
      ...target,
      aliases: [...target.aliases].sort(compareCodes),
      minimumStock,
      pendingPurchaseQuantity: pendingQuantity,
      projectedStock,
      shortfall,
      recommendedQuantity:
        group === "BUY_NOW" ? shortfall : minimumStock === null ? null : 0,
      remainingGap,
      coverage:
        group === "ALREADY_ORDERED"
          ? remainingGap === 0
            ? "SUFFICIENT"
            : "INSUFFICIENT"
          : null,
      group,
      relatedOrders: (pending?.lines ?? [])
        .sort(compareOrders)
        .map((line) => ({
          orderId: line.orderId,
          negotiationNumber: line.negotiationNumber,
          orderDate: line.orderDate,
          status: line.status,
          closureKind: line.closureKind,
          codeSnapshot: line.codeSnapshot,
          pendingQuantity: safeAdd(
            line.waitingPickupQuantity,
            line.waitingStockQuantity,
          ),
          href: `/pedidos?view=${
            line.isInHistory ? "history" : "active"
          }&order=${line.orderId}`,
        })),
    };
  });
  const buyNow = allItems
    .filter((item) => item.group === "BUY_NOW")
    .sort(
      (first, second) =>
        (second.recommendedQuantity ?? 0) -
          (first.recommendedQuantity ?? 0) ||
        Number(first.currentStock !== 0) -
          Number(second.currentStock !== 0) ||
        compareCodes(first.primaryCode, second.primaryCode) ||
        first.targetId.localeCompare(second.targetId),
    );
  const alreadyOrdered = allItems
    .filter((item) => item.group === "ALREADY_ORDERED")
    .sort(
      (first, second) =>
        Number(first.coverage === "SUFFICIENT") -
          Number(second.coverage === "SUFFICIENT") ||
        (second.remainingGap ?? 0) - (first.remainingGap ?? 0) ||
        compareCodes(first.primaryCode, second.primaryCode) ||
        first.targetId.localeCompare(second.targetId),
    );
  const missingMinimum = allItems
    .filter((item) => item.group === "MISSING_MINIMUM")
    .sort(
      (first, second) =>
        Number(first.currentStock !== 0) -
          Number(second.currentStock !== 0) ||
        first.currentStock - second.currentStock ||
        compareCodes(first.primaryCode, second.primaryCode) ||
        first.targetId.localeCompare(second.targetId),
    );

  return {
    buyNow,
    alreadyOrdered,
    missingMinimum,
    allItems,
    summary: {
      buyNowCount: buyNow.length,
      alreadyOrderedCount: alreadyOrdered.length,
      missingMinimumCount: missingMinimum.length,
    },
  };
}

function normalizeCode(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR");
}

export function findPurchaseRecommendationItemsByCode(
  data: PurchaseRecommendationsData,
  code: string,
) {
  const normalizedCode = normalizeCode(code);

  return data.allItems.filter(
    (item) =>
      normalizeCode(item.primaryCode) === normalizedCode ||
      item.aliases.some(
        (alias) => normalizeCode(alias) === normalizedCode,
      ),
  );
}
