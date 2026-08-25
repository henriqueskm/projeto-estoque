import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { getSafisaPickupAlertKind } from "../lib/safisa-pickup-alerts-contract.ts";
import {
  isPushSubscriptionSameOrigin,
  parsePushSubscriptionBody,
} from "../lib/push-subscription-http.ts";
import { dispatchSafisaFullyReadyPush } from "../lib/safisa-push-dispatch.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260825113000_safisa_fully_ready_push_notifications.sql");
const workerSource = read("public/sw.js");
const clientSource = read("lib/firebase-push-client.ts");
const providerSource = read("components/push-notification-provider.tsx");
const actionsSource = read("app/safisa/actions.ts");
const orderActionsSource = read("app/(authenticated)/pedidos/actions.ts");
const sidebarSource = read("components/app-sidebar.tsx");

const eventFixture = {
  id: "10000000-0000-4000-8000-000000000001",
  event_type: "SAFISA_FULLY_READY",
  supplier_order_id: "10000000-0000-4000-8000-000000000002",
  negotiation_number: "40959",
};

function subscription(index) {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    firebase_installation_id: `fid-${String(index).padStart(20, "x")}`,
    profiles: { is_active: true },
  };
}

function fakeAdmin({ event = eventFixture, subscriptions = [] } = {}) {
  const completed = [];
  const disabledIds = [];

  const client = {
    async rpc(name, args) {
      if (name === "claim_safisa_fully_ready_push_event") {
        return { data: event, error: null };
      }
      if (name === "complete_safisa_fully_ready_push_event") {
        completed.push(args);
        return { data: null, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      assert.equal(table, "push_subscriptions");
      const query = {
        select() { return query; },
        eq() { return query; },
        update() { return query; },
        in(_field, values) {
          disabledIds.push(...values);
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          return Promise.resolve({ data: subscriptions, error: null }).then(resolve);
        },
      };
      return query;
    },
  };

  return { client, completed, disabledIds };
}

function batch(responses) {
  return {
    responses,
    successCount: responses.filter((response) => response.success).length,
    failureCount: responses.filter((response) => !response.success).length,
  };
}

function loadServiceWorker() {
  const handlers = new Map();
  const notifications = [];
  const opened = [];
  const self = {
    location: { origin: "https://nk.example" },
    addEventListener(type, handler) { handlers.set(type, handler); },
    skipWaiting: async () => undefined,
    registration: {
      async showNotification(title, options) { notifications.push({ title, options }); },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [],
      async openWindow(url) { opened.push(url); },
    },
  };
  vm.runInNewContext(workerSource, { self, URL, encodeURIComponent }, { filename: "sw.js" });
  return { handlers, notifications, opened, self };
}

test("database contract isolates subscriptions and creates one transactional FULLY_READY event", () => {
  assert.match(migration, /create table public\.push_subscriptions/i);
  assert.match(migration, /firebase_installation_id text not null/i);
  assert.match(migration, /unique \(firebase_installation_id\)/i);
  assert.match(migration, /device_id uuid not null/i);
  assert.match(migration, /unique \(device_id\)/i);
  assert.match(migration, /references public\.profiles\(id\) on delete cascade/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.push_subscriptions\s+from public, anon, authenticated/i);
  assert.match(migration, /profile\.is_active/i);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /on conflict \(device_id\) do update\s+set user_id = excluded\.user_id/i);
  assert.match(migration, /unique \(supplier_order_id, event_type\)/i);
  assert.match(migration, /after update of ready_quantity, cancelled_quantity/i);
  assert.match(migration, /v_waiting_pickup_quantity > 0/i);
  assert.match(migration, /v_ready_quantity \+ v_cancelled_quantity = v_ordered_quantity/i);
  assert.match(migration, /v_previous_cancelled_quantity\s*:=\s*v_cancelled_quantity - new\.cancelled_quantity \+ old\.cancelled_quantity/i);
  assert.match(migration, /v_previous_ready_quantity \+ v_previous_cancelled_quantity = v_ordered_quantity/i);
  assert.match(migration, /on conflict \(supplier_order_id, event_type\) do nothing/i);
});

test("SQL FULLY_READY rule remains equivalent to the official TypeScript contract", () => {
  assert.equal(getSafisaPickupAlertKind({ orderedQuantity: 10, cancelledQuantity: 0, readyQuantity: 3, readyWaitingPickupQuantity: 3 }), "PARTIALLY_READY");
  assert.equal(getSafisaPickupAlertKind({ orderedQuantity: 10, cancelledQuantity: 0, readyQuantity: 10, readyWaitingPickupQuantity: 4 }), "FULLY_READY");
  assert.equal(getSafisaPickupAlertKind({ orderedQuantity: 10, cancelledQuantity: 2, readyQuantity: 8, readyWaitingPickupQuantity: 1 }), "FULLY_READY");
  assert.equal(getSafisaPickupAlertKind({ orderedQuantity: 10, cancelledQuantity: 2, readyQuantity: 8, readyWaitingPickupQuantity: 0 }), null);
});

test("subscription HTTP contract accepts a conservative FID and remains exact, bounded, and same-origin", () => {
  const firebaseInstallationId = "fid:abcdefghijklmnopqrstuvwxyz";
  const deviceId = "10000000-0000-4000-8000-000000000010";
  assert.deepEqual(
    parsePushSubscriptionBody({ deviceId, firebaseInstallationId }),
    { deviceId, firebaseInstallationId },
  );
  assert.equal(parsePushSubscriptionBody({ deviceId, firebaseInstallationId, userId: "forbidden" }), null);
  assert.equal(parsePushSubscriptionBody({ deviceId, fcmToken: firebaseInstallationId }), null);
  assert.equal(parsePushSubscriptionBody({ deviceId, firebaseInstallationId: "" }), null);
  assert.equal(parsePushSubscriptionBody({ deviceId, firebaseInstallationId: `fid\u0000invalid` }), null);
  assert.equal(parsePushSubscriptionBody({ deviceId, firebaseInstallationId: "x".repeat(513) }), null);
  assert.equal(isPushSubscriptionSameOrigin(new Request("https://nk.example/api/push-subscriptions", { headers: { Origin: "https://nk.example", "Sec-Fetch-Site": "same-origin" } })), true);
  assert.equal(isPushSubscriptionSameOrigin(new Request("https://nk.example/api/push-subscriptions", { headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } })), false);
});

test("client registers through FID callbacks using the existing worker and asks permission only in the explicit enable flow", () => {
  assert.match(clientSource, /getRegistration\("\/"\)/);
  assert.match(clientSource, /register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(clientSource, /serviceWorkerRegistration: context\.registration/);
  assert.match(clientSource, /onRegistered\(messaging, listeners\.registered\)/);
  assert.match(clientSource, /onUnregistered\(/);
  assert.match(clientSource, /await register\(context\.messaging/);
  assert.match(clientSource, /await unregister\(context\.messaging\)/);
  assert.doesNotMatch(clientSource, /\bgetToken\b|\bdeleteToken\b/);
  assert.doesNotMatch(clientSource, /firebase-messaging-sw\.js/);
  const requestFunction = clientSource.slice(clientSource.indexOf("export async function requestFirebasePushPermission"));
  assert.match(requestFunction, /Notification\.requestPermission\(\)/);
  const initialization = providerSource.slice(providerSource.indexOf("async function initialize"), providerSource.indexOf("const enable"));
  assert.doesNotMatch(initialization, /requestFirebasePushPermission\(/);
  assert.match(providerSource, /firebaseInstallationId/);
  assert.match(providerSource, /localFirebaseInstallationIdKey/);
  assert.match(providerSource, /const response = await persistInstallation[\s\S]*if \(!response\.ok\)[\s\S]*setState\("granted"\)/);
  assert.match(providerSource, /isIosDevice\(\) && !isStandaloneMode\(\)/);
  assert.match(providerSource, /"denied"/);
  assert.match(providerSource, /"unsupported"/);
  assert.match(providerSource, /"not_configured"/);
});

test("FID rotation is persisted and disable updates the backend before unregistering", () => {
  const registrationEffect = providerSource.slice(
    providerSource.indexOf("subscribeToFirebasePushRegistration"),
    providerSource.indexOf("const enable"),
  );
  assert.match(registrationEffect, /registered\(firebaseInstallationId\)[\s\S]*persistInstallation\([\s\S]*"POST"/);
  assert.match(registrationEffect, /unregistered\(firebaseInstallationId\)[\s\S]*persistInstallation\([\s\S]*"DELETE"/);

  const disableFlow = providerSource.slice(
    providerSource.indexOf("const disable"),
    providerSource.indexOf("const value"),
  );
  assert.ok(
    disableFlow.indexOf('persistInstallation(') <
      disableFlow.indexOf('unregisterFirebasePushInstallation()'),
  );
  assert.match(disableFlow, /if \(!response\.ok\) \{[\s\S]*setState\("error"\);[\s\S]*return;/);
});

test("service worker displays the approved push and derives an internal Pedido URL", async () => {
  const { handlers, notifications } = loadServiceWorker();
  let pending;
  handlers.get("push")({
    data: { json: () => ({ data: { type: "SAFISA_FULLY_READY", supplierOrderId: eventFixture.supplier_order_id, negotiationNumber: "40959", url: "https://evil.example" } }) },
    waitUntil(value) { pending = value; },
  });
  await pending;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "Pedido pronto para retirada ✅");
  assert.equal(notifications[0].options.data.url, `/pedidos?order=${eventFixture.supplier_order_id}`);
  assert.equal(notifications[0].options.icon, "/icons/nk-app-icon-192.png");
});

test("notification click rejects external URLs and opens only the validated same-origin path", async () => {
  const { handlers, opened } = loadServiceWorker();
  let waited = false;
  handlers.get("notificationclick")({
    notification: { data: { url: "https://evil.example/pedidos?order=10000000-0000-4000-8000-000000000002" }, close() {} },
    waitUntil() { waited = true; },
  });
  assert.equal(waited, false);
  assert.deepEqual(opened, []);

  let pending;
  handlers.get("notificationclick")({
    notification: { data: { url: `/pedidos?order=${eventFixture.supplier_order_id}` }, close() {} },
    waitUntil(value) { pending = value; },
  });
  await pending;
  assert.deepEqual(opened, [`/pedidos?order=${eventFixture.supplier_order_id}`]);
});

test("server dispatch succeeds once and records SENT", async () => {
  const admin = fakeAdmin({ subscriptions: [subscription(1), subscription(2)] });
  const messages = [];
  const result = await dispatchSafisaFullyReadyPush(eventFixture.supplier_order_id, {
    adminClient: admin.client,
    async sendEachForMulticast(message) {
      messages.push(message);
      return batch([{ success: true }, { success: true }]);
    },
  });
  assert.equal(result, "sent");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].fids.length, 2);
  assert.equal("tokens" in messages[0], false);
  assert.equal(messages[0].data.type, "SAFISA_FULLY_READY");
  assert.equal(admin.completed.at(-1).p_status, "SENT");
});

test("server dispatch limits each multicast request to 500 FIDs", async () => {
  const subscriptions = Array.from({ length: 501 }, (_, index) => subscription(index + 1));
  const admin = fakeAdmin({ subscriptions });
  const batchSizes = [];
  const result = await dispatchSafisaFullyReadyPush(eventFixture.supplier_order_id, {
    adminClient: admin.client,
    async sendEachForMulticast(message) {
      batchSizes.push(message.fids.length);
      return batch(message.fids.map(() => ({ success: true })));
    },
  });

  assert.equal(result, "sent");
  assert.deepEqual(batchSizes, [500, 1]);
});

test("server dispatch handles no recipients, unregistered FIDs, partial multicast, failure, and timeout", async () => {
  let admin = fakeAdmin();
  assert.equal(await dispatchSafisaFullyReadyPush(eventFixture.supplier_order_id, {
    adminClient: admin.client,
    async sendEachForMulticast() { throw new Error("must not send"); },
  }), "no_recipients");
  assert.equal(admin.completed.at(-1).p_status, "NO_RECIPIENTS");

  admin = fakeAdmin({ subscriptions: [subscription(1), subscription(2)] });
  assert.equal(await dispatchSafisaFullyReadyPush(eventFixture.supplier_order_id, {
    adminClient: admin.client,
    async sendEachForMulticast() {
      return batch([
        { success: true },
        { success: false, error: { code: "messaging/registration-token-not-registered" } },
      ]);
    },
  }), "sent");
  assert.deepEqual(admin.disabledIds, [subscription(2).id]);

  admin = fakeAdmin({ subscriptions: [subscription(5)] });
  assert.equal(await dispatchSafisaFullyReadyPush(eventFixture.supplier_order_id, {
    adminClient: admin.client,
    async sendEachForMulticast() {
      return batch([
        { success: false, error: { code: "messaging/invalid-argument" } },
      ]);
    },
  }), "failed");
  assert.deepEqual(admin.disabledIds, [], "INVALID_ARGUMENT alone never deletes a FID");

  admin = fakeAdmin({ subscriptions: [subscription(3)] });
  assert.equal(await dispatchSafisaFullyReadyPush(eventFixture.supplier_order_id, {
    adminClient: admin.client,
    async sendEachForMulticast() { throw { code: "messaging/internal-error" }; },
  }), "failed");
  assert.equal(admin.completed.at(-1).p_status, "FAILED");
  assert.equal(admin.completed.at(-1).p_last_error_code, "MESSAGING_INTERNAL-ERROR");

  admin = fakeAdmin({ subscriptions: [subscription(4)] });
  assert.equal(await dispatchSafisaFullyReadyPush(eventFixture.supplier_order_id, {
    adminClient: admin.client,
    sendEachForMulticast: () => new Promise(() => undefined),
    timeoutMs: 5,
  }), "failed");
  assert.equal(admin.completed.at(-1).p_last_error_code, "FCM_TIMEOUT");
});

test("Safisa mutations keep their own success result independent from push delivery", () => {
  assert.equal((actionsSource.match(/await dispatchSafisaFullyReadyPush\(input\.supplierOrderId\);/g) ?? []).length, 3);
  assert.doesNotMatch(actionsSource, /const\s+\w+\s*=\s*await dispatchSafisaFullyReadyPush/);
  assert.match(actionsSource, /await dispatchSafisaFullyReadyPush\(input\.supplierOrderId\);\s*revalidatePath\("\/safisa"\);\s*return \{ status: "success"/);
});

test("dispatcher contains configuration initialization inside its best-effort boundary", () => {
  const dispatcherSource = read("lib/safisa-push-dispatch.ts");
  const functionBody = dispatcherSource.slice(
    dispatcherSource.indexOf("export async function dispatchSafisaFullyReadyPush"),
  );
  assert.match(functionBody, /try \{\s*const adminClient = suppliedDependencies\?\.adminClient \?\? createAdminClient\(\)/);
  assert.match(functionBody, /catch \{\s*return "failed"/);
});

test("successful internal cancellation actions drain a possible event without changing RPC success", () => {
  const cancellationWorker = orderActionsSource.slice(
    orderActionsSource.indexOf("async function cancelSupplierOrderWithRpc"),
    orderActionsSource.indexOf("export async function cancelSupplierOrder"),
  );
  assert.match(cancellationWorker, /if \(error\) return mapRpcError\(error\.code, error\.message\)/);
  assert.match(cancellationWorker, /await dispatchSafisaFullyReadyPush\(normalized\.supplier_order_id\);\s*return finishMutation\(data\)/);
});

test("logout always proceeds after a bounded best-effort push cleanup", () => {
  assert.match(sidebarSource, /Promise\.race\(\[disablePushBeforeLogout\(\), cleanupDeadline\]\)/);
  assert.match(sidebarSource, /window\.setTimeout\(resolve, 1_200\)/);
  assert.match(sidebarSource, /allowSubmitRef\.current = true;\s*form\.requestSubmit\(\)/);
});
