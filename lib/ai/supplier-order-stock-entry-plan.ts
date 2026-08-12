export type SupplierOrderStockEntryPlanLine = {
  id: string;
  waitingStockQuantity: number;
};

export type SupplierOrderStockEntryPlanRequest = {
  allAvailable: boolean;
  quantity: number | null;
  targetQueries: readonly string[];
};

export type SupplierOrderStockEntrySelection<T extends SupplierOrderStockEntryPlanLine> =
  | { kind: "ok"; lines: Array<{ item: T; quantity: number }> }
  | { kind: "none" }
  | { kind: "ambiguous"; query: string }
  | { kind: "unavailable"; query: string }
  | { kind: "quantity_invalid" };

export function toSafeWaitingStockQuantity(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

export function selectSupplierOrderStockEntryLines<T extends SupplierOrderStockEntryPlanLine>(
  request: SupplierOrderStockEntryPlanRequest,
  items: readonly T[],
  resolve: (query: string) => readonly T[],
): SupplierOrderStockEntrySelection<T> {
  const available = items.filter((item) => item.waitingStockQuantity > 0);

  if (request.allAvailable && request.targetQueries.length === 0) {
    return available.length
      ? {
          kind: "ok",
          lines: available
            .map((item) => ({ item, quantity: item.waitingStockQuantity }))
            .sort((first, second) => first.item.id.localeCompare(second.item.id)),
        }
      : { kind: "none" };
  }

  if (
    !Number.isSafeInteger(request.quantity) ||
    request.quantity === null ||
    request.quantity < 1
  ) {
    return { kind: "quantity_invalid" };
  }

  const selected = new Map<string, T>();

  for (const query of request.targetQueries) {
    const matches = resolve(query).filter(
      (item) => item.waitingStockQuantity > 0,
    );

    if (matches.length > 1) {
      return { kind: "ambiguous", query };
    }

    if (matches.length === 0) {
      return { kind: "unavailable", query };
    }

    const item = matches[0];

    if (request.quantity > item.waitingStockQuantity) {
      return { kind: "unavailable", query };
    }

    selected.set(item.id, item);
  }

  return selected.size
    ? {
        kind: "ok",
        lines: Array.from(selected.values())
          .sort((first, second) => first.id.localeCompare(second.id))
          .map((item) => ({ item, quantity: request.quantity! })),
      }
    : { kind: "none" };
}

export function validateSupplierOrderStockEntryConfirmation(
  expectedUpdatedAt: string,
  currentUpdatedAt: string,
  lines: readonly { supplierOrderItemId: string; quantity: number }[],
  items: readonly SupplierOrderStockEntryPlanLine[],
) {
  if (currentUpdatedAt !== expectedUpdatedAt) {
    return "order_changed" as const;
  }

  const itemById = new Map(items.map((item) => [item.id, item]));
  const hasInvalidLine = lines.some((line) => {
    const item = itemById.get(line.supplierOrderItemId);
    return (
      !item ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > item.waitingStockQuantity
    );
  });

  return hasInvalidLine ? ("availability_changed" as const) : ("ok" as const);
}
