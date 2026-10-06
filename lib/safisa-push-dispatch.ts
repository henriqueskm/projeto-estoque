import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchResponse, Messaging } from "firebase-admin/messaging";
import { getFirebaseAdminMessaging } from "@/lib/firebase-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllSupabaseRows } from "@/lib/supabase-read-pagination";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const negotiationPattern = /^\d+$/;
const multicastLimit = 500;
const sendTimeoutMs = 8_000;

type PushEventBase = {
  id: string;
  supplierOrderId: string;
  negotiationNumber: string;
  attemptCount?: number;
};

type PushEvent = PushEventBase & (
  | { eventType: "SAFISA_FULLY_READY" }
  | { eventType: "SAFISA_ITEM_READY"; supplierOrderItemId: string;
      portalEventId: string; code: string; description: string; quantity: number }
);

type Subscription = {
  id: string;
  firebaseInstallationId: string;
};

export type SafisaPushDispatchResult =
  | "sent"
  | "no_recipients"
  | "not_configured"
  | "not_pending"
  | "failed";

export type SafisaPushDispatchDependencies = {
  adminClient: SupabaseClient;
  sendEachForMulticast: Messaging["sendEachForMulticast"];
  timeoutMs?: number;
};

function parsePushEvent(value: unknown): PushEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;

  if (
    typeof event.id !== "string" ||
    !uuidPattern.test(event.id) ||
    (event.event_type !== "SAFISA_FULLY_READY" && event.event_type !== "SAFISA_ITEM_READY") ||
    typeof event.supplier_order_id !== "string" ||
    !uuidPattern.test(event.supplier_order_id) ||
    typeof event.negotiation_number !== "string" ||
    !negotiationPattern.test(event.negotiation_number) || event.negotiation_number.length > 120 ||
    (event.attempt_count !== undefined &&
      (!Number.isInteger(event.attempt_count) || (event.attempt_count as number) < 1 || (event.attempt_count as number) > 3))
  ) {
    return null;
  }

  const base = {
    id: event.id,
    supplierOrderId: event.supplier_order_id,
    negotiationNumber: event.negotiation_number,
    attemptCount: event.attempt_count as number | undefined,
  };
  if (event.event_type === "SAFISA_FULLY_READY") return { ...base, eventType: "SAFISA_FULLY_READY" };
  if (typeof event.supplier_order_item_id !== "string" || !uuidPattern.test(event.supplier_order_item_id) ||
      typeof event.portal_event_id !== "string" || !uuidPattern.test(event.portal_event_id) ||
      typeof event.code_snapshot !== "string" || !event.code_snapshot.trim() ||
      typeof event.description_snapshot !== "string" || !event.description_snapshot.trim() ||
      !Number.isInteger(event.quantity_delta) || (event.quantity_delta as number) <= 0 ||
      (event.quantity_delta as number) > 2147483647 || base.attemptCount === undefined) return null;
  const code = notificationText(event.code_snapshot, 80);
  const description = notificationText(event.description_snapshot, 300);
  if (!code || !description) return null;
  return { ...base, eventType: "SAFISA_ITEM_READY", supplierOrderItemId: event.supplier_order_item_id,
    portalEventId: event.portal_event_id, code, description, quantity: event.quantity_delta as number };
}

function notificationText(value: string, limit: number) {
  return Array.from(value.replace(/<[^>]*>/g, "").replace(/[<>\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim()).slice(0, limit).join("");
}

function parseSubscriptions(value: unknown): Subscription[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return typeof record.id === "string" &&
      uuidPattern.test(record.id) &&
      typeof record.firebase_installation_id === "string" &&
      record.firebase_installation_id.trim().length > 0 &&
      record.firebase_installation_id.length <= 512 &&
      !/[\u0000-\u001f\u007f]/.test(record.firebase_installation_id)
      ? [{
          id: record.id,
          firebaseInstallationId: record.firebase_installation_id,
        }]
      : [];
  });
}

function chunks<T>(values: T[], size: number) {
  return Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );
}

function isUnregisteredInstallationCode(code: string | undefined) {
  return code === "messaging/registration-token-not-registered";
}

function sanitizedErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9_:-]/g, "_")
      .slice(0, 80);
    if (code) return code;
  }
  return "FCM_DELIVERY_FAILED";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject({ code: "FCM_TIMEOUT" }), timeoutMs);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function completeEvent(
  client: SupabaseClient,
  event: PushEvent,
  status: "SENT" | "FAILED" | "NO_RECIPIENTS",
  errorCode: string | null = null,
) {
  const { error } = await client.rpc(event.attemptCount === undefined
    ? "complete_safisa_fully_ready_push_event" : "complete_safisa_ready_push_event", {
    p_event_id: event.id,
    ...(event.attemptCount === undefined ? {} : { p_attempt_count: event.attemptCount }),
    p_status: status,
    p_last_error_code: errorCode,
  });
  if (error) throw new Error("Push completion failed.");
}

async function sendBatch(
  sender: Messaging["sendEachForMulticast"],
  event: PushEvent,
  subscriptions: Subscription[],
  timeoutMs: number,
) {
  return withTimeout(
    sender({
      fids: subscriptions.map(
        (subscription) => subscription.firebaseInstallationId,
      ),
      data: event.eventType === "SAFISA_ITEM_READY" ? {
        type: event.eventType,
        eventId: event.id,
        title: `Item pronto no pedido ${event.negotiationNumber} ✅`,
        body: `Cód. ${event.code} — ${event.description} — ${event.quantity} ${event.quantity === 1 ? "unidade pronta" : "unidades prontas"}.`,
        url: `/pedidos?order=${event.supplierOrderId}`,
        supplierOrderId: event.supplierOrderId,
        supplierOrderItemId: event.supplierOrderItemId,
        negotiationNumber: event.negotiationNumber,
        code: event.code,
        description: event.description,
        quantity: String(event.quantity),
      } : {
        type: event.eventType,
        title: "Pedido pronto para retirada ✅",
        body: `Pedido ${event.negotiationNumber} está completamente pronto na Safisa.`,
        url: `/pedidos?order=${event.supplierOrderId}`,
        supplierOrderId: event.supplierOrderId,
        negotiationNumber: event.negotiationNumber,
      },
      webpush: {
        headers: { Urgency: "high" },
      },
    }),
    timeoutMs,
  );
}

export async function dispatchSafisaFullyReadyPush(
  supplierOrderId: string,
  suppliedDependencies?: SafisaPushDispatchDependencies,
): Promise<SafisaPushDispatchResult> {
  return dispatchSafisaPush(supplierOrderId, undefined, suppliedDependencies);
}

export async function dispatchSafisaReadyPush(
  supplierOrderId: string,
  portalEventId: string,
  suppliedDependencies?: SafisaPushDispatchDependencies,
): Promise<SafisaPushDispatchResult> {
  if (!uuidPattern.test(portalEventId)) return "failed";
  return dispatchSafisaPush(supplierOrderId, portalEventId, suppliedDependencies);
}

async function dispatchSafisaPush(
  supplierOrderId: string,
  portalEventId: string | undefined,
  suppliedDependencies?: SafisaPushDispatchDependencies,
): Promise<SafisaPushDispatchResult> {
  if (!uuidPattern.test(supplierOrderId)) return "failed";

  try {
    const adminClient = suppliedDependencies?.adminClient ?? createAdminClient();
    const messaging = suppliedDependencies ? null : getFirebaseAdminMessaging();
    const sendEachForMulticast = suppliedDependencies?.sendEachForMulticast ??
      messaging?.sendEachForMulticast.bind(messaging);

    if (!adminClient || !sendEachForMulticast) return "not_configured";

    const { data: claimedData, error: claimError } = await adminClient.rpc(
      portalEventId ? "claim_safisa_ready_push_event" : "claim_safisa_fully_ready_push_event",
      { p_supplier_order_id: supplierOrderId, ...(portalEventId ? { p_portal_event_id: portalEventId } : {}) },
    );
    if (claimError) return "failed";

    const event = parsePushEvent(claimedData);
    if (!event) return claimedData === null ? "not_pending" : "failed";
    if (event.supplierOrderId !== supplierOrderId ||
        (portalEventId && event.attemptCount === undefined) ||
        (!portalEventId && event.eventType !== "SAFISA_FULLY_READY") ||
        (event.eventType === "SAFISA_ITEM_READY" && event.portalEventId !== portalEventId)) return "failed";

    const {
      data: subscriptionData,
      error: subscriptionError,
    } = await fetchAllSupabaseRows<Record<string, unknown>>(
      (from, to) => adminClient
        .from("push_subscriptions")
        .select("id, firebase_installation_id, profiles!inner(is_active)")
        .eq("enabled", true)
        .eq("profiles.is_active", true)
        .order("id")
        .range(from, to),
      (row) => typeof row.id === "string" ? row.id : "",
    );

    if (subscriptionError) {
      await completeEvent(adminClient, event, "FAILED", "SUBSCRIPTION_READ_FAILED");
      return "failed";
    }

    const subscriptions = parseSubscriptions(subscriptionData);
    if (subscriptions.length === 0) {
      await completeEvent(adminClient, event, "NO_RECIPIENTS");
      return "no_recipients";
    }

    let successCount = 0;
    const invalidSubscriptionIds: string[] = [];
    let lastErrorCode: string | null = null;

    for (const subscriptionChunk of chunks(subscriptions, multicastLimit)) {
      let response: BatchResponse;
      try {
        response = await sendBatch(
          sendEachForMulticast,
          event,
          subscriptionChunk,
          suppliedDependencies?.timeoutMs ?? sendTimeoutMs,
        );
      } catch (error) {
        lastErrorCode = sanitizedErrorCode(error);
        continue;
      }

      successCount += response.successCount;
      response.responses.forEach((result, index) => {
        if (result.success) return;
        const code = result.error?.code;
        if (isUnregisteredInstallationCode(code)) {
          invalidSubscriptionIds.push(subscriptionChunk[index].id);
        } else if (code) {
          lastErrorCode = sanitizedErrorCode({ code });
        }
      });
    }

    if (invalidSubscriptionIds.length > 0) {
      await adminClient
        .from("push_subscriptions")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .in("id", invalidSubscriptionIds);
    }

    if (successCount > 0) {
      await completeEvent(adminClient, event, "SENT");
      return "sent";
    }

    await completeEvent(
      adminClient,
      event,
      "FAILED",
      lastErrorCode ??
        (invalidSubscriptionIds.length
          ? "ALL_INSTALLATIONS_UNREGISTERED"
          : "FCM_DELIVERY_FAILED"),
    );
    return "failed";
  } catch {
    return "failed";
  }
}
