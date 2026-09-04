import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  groupSafisaPickupAlertLines,
  type SafisaPickupAlertLine,
  type SafisaPickupAlertOrderSummary,
} from "@/lib/safisa-pickup-alerts-contract";
import {
  safisaPickupAlertUnavailableMessage,
  type SafisaPickupAlertLoadResult,
  type SafisaPickupAlertsData,
} from "@/lib/safisa-pickup-alert-state";

type JsonRecord = Record<string, unknown>;

export type SafisaPickupAlertsResult = SafisaPickupAlertLoadResult;

const emptyAlerts: SafisaPickupAlertsData = {
  alerts: [],
  alertCount: 0,
  isComplete: true,
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseAlertLines(value: unknown): {
  lines: SafisaPickupAlertLine[];
  total: number;
} | null {
  if (!isRecord(value) || !Array.isArray(value.alerts)) {
    return null;
  }

  const total = integerValue(value.total);
  if (total === null) {
    return null;
  }

  const parsedLines = value.alerts.map((entry): SafisaPickupAlertLine | null => {
    if (!isRecord(entry)) return null;
    const supplierOrderId = stringValue(entry.supplier_order_id);
    const negotiationNumber = stringValue(entry.negotiation_number);
    const orderDate = stringValue(entry.order_date);
    const readyWaitingPickupQuantity = integerValue(
      entry.ready_waiting_pickup_quantity,
    );

    if (
      !supplierOrderId ||
      !negotiationNumber ||
      !orderDate ||
      readyWaitingPickupQuantity === null
    ) {
      return null;
    }

    return {
      supplierOrderId,
      negotiationNumber,
      orderDate,
      readyWaitingPickupQuantity,
    };
  });

  if (parsedLines.some((line) => line === null)) {
    return null;
  }

  return { lines: parsedLines as SafisaPickupAlertLine[], total };
}

function toSafeQuantity(value: unknown) {
  return integerValue(value) ?? 0;
}

function parseOrderSummary(value: unknown): SafisaPickupAlertOrderSummary | null {
  if (!isRecord(value)) return null;

  const supplierOrderId = stringValue(value.id);
  const negotiationNumber = stringValue(value.negotiation_number);
  const orderDate = stringValue(value.order_date);

  if (!supplierOrderId || !negotiationNumber || !orderDate) {
    return null;
  }

  return {
    supplierOrderId,
    negotiationNumber,
    orderDate,
    orderedQuantity: toSafeQuantity(value.ordered_quantity),
    cancelledQuantity: toSafeQuantity(value.cancelled_quantity),
    readyQuantity: toSafeQuantity(value.ready_quantity),
    pickedQuantity: toSafeQuantity(value.picked_quantity),
    readyWaitingPickupQuantity: toSafeQuantity(
      value.ready_waiting_pickup_quantity,
    ),
    cancelledAt:
      typeof value.cancelled_at === "string" ? value.cancelled_at : null,
  };
}

export async function loadSafisaPickupAlerts(
  suppliedClient?: SupabaseClient,
): Promise<SafisaPickupAlertsResult> {
  const supabase = suppliedClient ?? (await createClient());
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "list_safisa_ready_pickup_alerts",
    { p_limit: 500 },
  );

  if (rpcError) {
    return {
      data: emptyAlerts,
      error: safisaPickupAlertUnavailableMessage,
    };
  }

  const parsed = parseAlertLines(rpcData);
  if (!parsed) {
    return {
      data: emptyAlerts,
      error: safisaPickupAlertUnavailableMessage,
    };
  }

  const orderIds = Array.from(
    new Set(parsed.lines.map((line) => line.supplierOrderId)),
  );

  if (orderIds.length === 0) {
    return { data: emptyAlerts, error: null };
  }

  // The official reader is line-oriented. This one batched view read supplies
  // the order-level aggregate required to distinguish full from partial readiness.
  const { data: summariesData, error: summariesError } = await supabase
    .from("supplier_order_summaries")
    .select(
      "id, negotiation_number, order_date, ordered_quantity, cancelled_quantity, ready_quantity, picked_quantity, ready_waiting_pickup_quantity, cancelled_at",
    )
    .in("id", orderIds);

  if (summariesError) {
    return {
      data: emptyAlerts,
      error: safisaPickupAlertUnavailableMessage,
    };
  }

  const alerts = groupSafisaPickupAlertLines(
    parsed.lines,
    (summariesData ?? [])
      .map(parseOrderSummary)
      .filter(
        (summary): summary is SafisaPickupAlertOrderSummary =>
          Boolean(summary),
      ),
  );

  return {
    data: {
      alerts,
      alertCount: alerts.length,
      isComplete: parsed.total <= parsed.lines.length,
    },
    error: null,
  };
}

export const loadCurrentSafisaPickupAlerts = cache(() =>
  loadSafisaPickupAlerts(),
);

export type { SafisaPickupAlert, SafisaPickupAlertKind } from "@/lib/safisa-pickup-alerts-contract";
