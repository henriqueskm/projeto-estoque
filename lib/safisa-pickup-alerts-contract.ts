export type SafisaPickupAlertKind = "FULLY_READY" | "PARTIALLY_READY";

export type SafisaPickupAlertLine = {
  supplierOrderId: string;
  negotiationNumber: string;
  orderDate: string;
  readyWaitingPickupQuantity: number;
};

export type SafisaPickupAlertOrderSummary = {
  supplierOrderId: string;
  negotiationNumber: string;
  orderDate: string;
  orderedQuantity: number;
  cancelledQuantity: number;
  readyQuantity: number;
  pickedQuantity: number;
  readyWaitingPickupQuantity: number;
  cancelledAt: string | null;
};

export type SafisaPickupAlert = {
  supplierOrderId: string;
  negotiationNumber: string;
  orderDate: string;
  kind: SafisaPickupAlertKind;
  readyWaitingPickupQuantity: number;
  validOrderedQuantity: number;
  readyQuantity: number;
};

function safeQuantity(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function compareAlerts(first: SafisaPickupAlert, second: SafisaPickupAlert) {
  if (first.kind !== second.kind) {
    return first.kind === "FULLY_READY" ? -1 : 1;
  }

  const firstDate = new Date(`${first.orderDate}T00:00:00`).getTime();
  const secondDate = new Date(`${second.orderDate}T00:00:00`).getTime();

  if (firstDate !== secondDate) {
    return secondDate - firstDate;
  }

  return (
    first.negotiationNumber.localeCompare(second.negotiationNumber, "pt-BR", {
      numeric: true,
      sensitivity: "base",
    }) || first.supplierOrderId.localeCompare(second.supplierOrderId)
  );
}

export function getSafisaPickupAlertKind({
  orderedQuantity,
  cancelledQuantity,
  readyQuantity,
  readyWaitingPickupQuantity,
}: Pick<
  SafisaPickupAlertOrderSummary,
  | "orderedQuantity"
  | "cancelledQuantity"
  | "readyQuantity"
  | "readyWaitingPickupQuantity"
>): SafisaPickupAlertKind | null {
  const ordered = safeQuantity(orderedQuantity);
  const cancelled = Math.min(safeQuantity(cancelledQuantity), ordered);
  const ready = safeQuantity(readyQuantity);
  const waitingPickup = safeQuantity(readyWaitingPickupQuantity);

  if (waitingPickup === 0) {
    return null;
  }

  return ready + cancelled === ordered
    ? "FULLY_READY"
    : "PARTIALLY_READY";
}

export function groupSafisaPickupAlertLines(
  lines: SafisaPickupAlertLine[],
  summaries: SafisaPickupAlertOrderSummary[],
): SafisaPickupAlert[] {
  const summaryByOrderId = new Map(
    summaries.map((summary) => [summary.supplierOrderId, summary]),
  );
  const lineOrderIds = new Set(lines.map((line) => line.supplierOrderId));

  return Array.from(lineOrderIds)
    .map((supplierOrderId) => summaryByOrderId.get(supplierOrderId))
    .filter(
      (summary): summary is SafisaPickupAlertOrderSummary =>
        summary !== undefined && summary.cancelledAt === null,
    )
    .map((summary) => {
      const kind = getSafisaPickupAlertKind(summary);
      const readyWaitingPickupQuantity = safeQuantity(
        summary.readyWaitingPickupQuantity,
      );

      if (!kind || readyWaitingPickupQuantity === 0) {
        return null;
      }

      const orderedQuantity = safeQuantity(summary.orderedQuantity);
      const cancelledQuantity = Math.min(
        safeQuantity(summary.cancelledQuantity),
        orderedQuantity,
      );

      return {
        supplierOrderId: summary.supplierOrderId,
        negotiationNumber: summary.negotiationNumber,
        orderDate: summary.orderDate,
        kind,
        readyWaitingPickupQuantity,
        validOrderedQuantity: Math.max(0, orderedQuantity - cancelledQuantity),
        readyQuantity: safeQuantity(summary.readyQuantity),
      };
    })
    .filter((alert): alert is SafisaPickupAlert => Boolean(alert))
    .sort(compareAlerts);
}
