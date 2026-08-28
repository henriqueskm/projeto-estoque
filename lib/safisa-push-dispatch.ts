import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchResponse, Messaging } from "firebase-admin/messaging";
import { getFirebaseAdminMessaging } from "@/lib/firebase-admin";
import { createAdminClient } from "@/lib/supabase/admin";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const negotiationPattern = /^\d+$/;
const multicastLimit = 500;
const sendTimeoutMs = 8_000;

type PushEvent = {
  id: string;
  eventType: "SAFISA_FULLY_READY";
  supplierOrderId: string;
  negotiationNumber: string;
};

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
    event.event_type !== "SAFISA_FULLY_READY" ||
    typeof event.supplier_order_id !== "string" ||
    !uuidPattern.test(event.supplier_order_id) ||
    typeof event.negotiation_number !== "string" ||
    !negotiationPattern.test(event.negotiation_number)
  ) {
    return null;
  }

  return {
    id: event.id,
    eventType: "SAFISA_FULLY_READY",
    supplierOrderId: event.supplier_order_id,
    negotiationNumber: event.negotiation_number,
  };
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
  eventId: string,
  status: "SENT" | "FAILED" | "NO_RECIPIENTS",
  errorCode: string | null = null,
) {
  await client.rpc("complete_safisa_fully_ready_push_event", {
    p_event_id: eventId,
    p_status: status,
    p_last_error_code: errorCode,
  });
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
      data: {
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
  if (!uuidPattern.test(supplierOrderId)) return "failed";

  try {
    const adminClient = suppliedDependencies?.adminClient ?? createAdminClient();
    const messaging = suppliedDependencies ? null : getFirebaseAdminMessaging();
    const sendEachForMulticast = suppliedDependencies?.sendEachForMulticast ??
      messaging?.sendEachForMulticast.bind(messaging);

    if (!adminClient || !sendEachForMulticast) return "not_configured";

    const { data: claimedData, error: claimError } = await adminClient.rpc(
      "claim_safisa_fully_ready_push_event",
      { p_supplier_order_id: supplierOrderId },
    );
    if (claimError) return "failed";

    const event = parsePushEvent(claimedData);
    if (!event) return claimedData === null ? "not_pending" : "failed";

    const { data: subscriptionData, error: subscriptionError } = await adminClient
      .from("push_subscriptions")
      .select("id, firebase_installation_id, profiles!inner(is_active)")
      .eq("enabled", true)
      .eq("profiles.is_active", true);

    if (subscriptionError) {
      await completeEvent(adminClient, event.id, "FAILED", "SUBSCRIPTION_READ_FAILED");
      return "failed";
    }

    const subscriptions = parseSubscriptions(subscriptionData);
    if (subscriptions.length === 0) {
      await completeEvent(adminClient, event.id, "NO_RECIPIENTS");
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
      await completeEvent(adminClient, event.id, "SENT");
      return "sent";
    }

    await completeEvent(
      adminClient,
      event.id,
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
