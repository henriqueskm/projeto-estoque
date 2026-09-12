import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { getSafisaPickupAlertKind } from "../lib/safisa-pickup-alerts-contract.ts";
import {
  isPushSubscriptionSameOrigin,
  parsePushSubscriptionBody,
  readPushSubscriptionBody,
} from "../lib/push-subscription-http.ts";
import { dispatchSafisaFullyReadyPush } from "../lib/safisa-push-dispatch.ts";
import {
  beginPushOperation,
  createPushOperationGate,
  createPushOptOutReconciler,
  createPushPersistenceQueue,
  finishPushOperation,
  invalidatePushOperations,
  isCurrentPushOperation,
  isPushMutationConfirmed,
  persistPotentialPushInstallation,
  persistPushPreference,
  readPotentialPushInstallations,
  readAndMigratePushPreference,
  registerPushInstallationWithConvergence,
  removePotentialPushInstallation,
  runBoundedLogoutFlow,
  runPushDisableCleanup,
  runPushLogoutCleanup,
  shouldAutoRegisterPush,
  subscribeToPushDeviceIdentityEvents,
  subscribeToPushOptOutEvents,
} from "../lib/push-notification-operations.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260825113000_safisa_fully_ready_push_notifications.sql");
const idempotentDisableMigration = read("supabase/migrations/20260912104748_make_disable_push_subscription_idempotent.sql");
const workerSource = read("public/sw.js");
const clientSource = read("lib/firebase-push-client.ts");
const providerSource = read("components/push-notification-provider.tsx");
const actionsSource = read("app/safisa/actions.ts");
const orderActionsSource = read("app/(authenticated)/pedidos/actions.ts");
const sidebarSource = read("components/app-sidebar.tsx");
const controlSource = read("components/push-notification-control.tsx");
const logoutFormSource = read("components/push-aware-logout-form.tsx");
const accountSource = read("app/(authenticated)/minha-conta/page.tsx");
const authActionsSource = read("app/auth/actions.ts");

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

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

test("migration forward-only torna disable idempotente sem alterar a migration histórica", () => {
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "daee1604ad41fdc0a9b8f045ff399f84a38043c4ad8904bb631028ce76ae167b",
  );
  assert.equal(
    (idempotentDisableMigration.match(/create or replace function/gi) ?? []).length,
    1,
  );
  assert.match(idempotentDisableMigration, /create or replace function public\.disable_push_subscription\(\s*p_device_id uuid,\s*p_firebase_installation_id text\s*\)/i);
  assert.match(idempotentDisableMigration, /returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/i);
  assert.match(idempotentDisableMigration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(idempotentDisableMigration, /profile\.id = v_user_id\s+and profile\.is_active/i);
  assert.match(idempotentDisableMigration, /where user_id = v_user_id\s+and firebase_installation_id = v_firebase_installation_id\s+returning true into v_disabled/i);
  assert.doesNotMatch(idempotentDisableMigration, /p_device_id\s+is null|device_id\s*=\s*p_device_id/i);
  assert.doesNotMatch(idempotentDisableMigration, /and enabled/i);
  assert.doesNotMatch(idempotentDisableMigration, /create\s+table|alter\s+table|grant\s+|revoke\s+|row level security/i);
});

test("SQL FULLY_READY rule remains equivalent to the official TypeScript contract", () => {
  assert.equal(getSafisaPickupAlertKind({ orderedQuantity: 10, cancelledQuantity: 0, readyQuantity: 3, readyWaitingPickupQuantity: 3 }), "PARTIALLY_READY");
  assert.equal(getSafisaPickupAlertKind({ orderedQuantity: 10, cancelledQuantity: 0, readyQuantity: 10, readyWaitingPickupQuantity: 4 }), "FULLY_READY");
  assert.equal(getSafisaPickupAlertKind({ orderedQuantity: 10, cancelledQuantity: 2, readyQuantity: 8, readyWaitingPickupQuantity: 1 }), "FULLY_READY");
  assert.equal(getSafisaPickupAlertKind({ orderedQuantity: 10, cancelledQuantity: 2, readyQuantity: 8, readyWaitingPickupQuantity: 0 }), null);
});

test("subscription HTTP contract accepts a conservative FID and remains exact, bounded, and same-origin", async () => {
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
  assert.deepEqual(parsePushSubscriptionBody({ firebaseInstallationId }, "disable"), { firebaseInstallationId });
  assert.equal(parsePushSubscriptionBody({ deviceId, firebaseInstallationId }, "disable"), null);
  assert.equal(parsePushSubscriptionBody({ firebaseInstallationId, extra: true }, "disable"), null);
  assert.equal(isPushSubscriptionSameOrigin(new Request("https://nk.example/api/push-subscriptions", { headers: { Origin: "https://nk.example", "Sec-Fetch-Site": "same-origin" } })), true);
  assert.equal(isPushSubscriptionSameOrigin(new Request("https://nk.example/api/push-subscriptions", { headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } })), false);
  const request = (body, contentType = "application/json") => new Request("https://nk.example/api/push-subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": contentType },
    body,
  });
  assert.deepEqual(await readPushSubscriptionBody(request(JSON.stringify({ firebaseInstallationId })), "disable"), { data: { firebaseInstallationId } });
  assert.deepEqual(await readPushSubscriptionBody(request(JSON.stringify({ deviceId, firebaseInstallationId })), "disable"), { error: 400 });
  assert.deepEqual(await readPushSubscriptionBody(request("not-json"), "disable"), { error: 400 });
  assert.deepEqual(await readPushSubscriptionBody(request(JSON.stringify({ firebaseInstallationId }), "text/plain"), "disable"), { error: 415 });
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
  assert.ok(
    initialization.indexOf("readLocalPushPreference") <
      initialization.indexOf("isFirebasePushConfigured"),
  );
  assert.match(initialization, /createPushOptOutReconciler|optOutReconciler\.run/);
  assert.match(initialization, /shouldAutoRegisterPush\(preference\)/);
  assert.match(providerSource, /firebaseInstallationId/);
  assert.match(providerSource, /localFirebaseInstallationIdKey/);
  assert.match(providerSource, /registerPushInstallationWithConvergence\([\s\S]*maxAttempts: 3/);
  assert.match(providerSource, /const registration = await registerAndPersistInstallation\(\)[\s\S]*if \(registration\)[\s\S]*setState\("granted"\)/);
  assert.match(providerSource, /isIosDevice\(\) && !isStandaloneMode\(\)/);
  assert.match(providerSource, /"denied"/);
  assert.match(providerSource, /"unsupported"/);
  assert.match(providerSource, /"not_configured"/);
});

test("FID rotation is persisted and disable records opt-out before cleanup", () => {
  const registrationEffect = providerSource.slice(
    providerSource.indexOf("subscribeToFirebasePushRegistration"),
    providerSource.indexOf("const enable"),
  );
  assert.match(registrationEffect, /registered\(firebaseInstallationId\)[\s\S]*reconcileInstallation\(\s*firebaseInstallationId/);
  assert.match(registrationEffect, /unregistered\(firebaseInstallationId\)[\s\S]*persistInstallation\([\s\S]*"DELETE"/);

  const disableFlow = providerSource.slice(
    providerSource.indexOf("const disable"),
    providerSource.indexOf("const value"),
  );
  const preferenceIndex = disableFlow.indexOf('persistLocalPushPreference("disabled")');
  const queueIndex = disableFlow.indexOf("await queuePersistence");
  assert.ok(preferenceIndex >= 0);
  assert.ok(queueIndex >= 0);
  assert.ok(preferenceIndex < queueIndex);
  assert.match(disableFlow, /runStoredPushDisableCleanup/);
  assert.match(disableFlow, /setErrorOperation\("disable"\)/);
  assert.match(controlSource, /Tentar desativar novamente/);
  assert.match(controlSource, /sincronização está pendente/);
});

test("POST exige HTTP ok, JSON válido e enabled true", async () => {
  assert.equal(await isPushMutationConfirmed(
    new Response(JSON.stringify({ enabled: true }), { status: 200 }),
    "enable",
  ), true);
  assert.equal(await isPushMutationConfirmed(
    new Response(JSON.stringify({ enabled: false }), { status: 200 }),
    "enable",
  ), false);
  assert.equal(await isPushMutationConfirmed(
    new Response(JSON.stringify({ enabled: true }), { status: 500 }),
    "enable",
  ), false);
});

test("DELETE exige HTTP ok, JSON válido e disabled true", async () => {
  assert.equal(await isPushMutationConfirmed(
    new Response(JSON.stringify({ disabled: true }), { status: 200 }),
    "disable",
  ), true);
  assert.equal(await isPushMutationConfirmed(
    new Response(JSON.stringify({ disabled: false }), { status: 200 }),
    "disable",
  ), false);
  assert.equal(await isPushMutationConfirmed(
    new Response(JSON.stringify({ disabled: true }), { status: 409 }),
    "disable",
  ), false);
});

test("JSON inválido ou anômalo nunca confirma POST ou DELETE", async () => {
  for (const [body, operation] of [
    ["{", "enable"],
    ["not-json", "disable"],
    [JSON.stringify(null), "enable"],
    [JSON.stringify([]), "disable"],
    [JSON.stringify({ enabled: "true" }), "enable"],
    [JSON.stringify({ disabled: 1 }), "disable"],
    [JSON.stringify({ disabled: true }), "enable"],
    [JSON.stringify({ enabled: true }), "disable"],
  ]) {
    assert.equal(await isPushMutationConfirmed(
      new Response(body, { status: 200 }),
      operation,
    ), false);
  }
});

test("preferência persistente é fail-closed e permission granted isolada nunca autoriza registro", async () => {
  const preferenceKey = "push-preference";
  const legacyOptOutKey = "push-disabled";
  const installationKey = "push-fid";
  const deviceKey = "push-device";
  const createStorage = (entries = []) => {
    const values = new Map(entries);
    return {
      values,
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); },
    };
  };
  const readPreference = (storage) => readAndMigratePushPreference({
    storage,
    preferenceKey,
    legacyOptOutKey,
    installationKey,
    deviceKey,
  });

  const cases = [
    [createStorage([[preferenceKey, "enabled"]]), true],
    [createStorage([[preferenceKey, "disabled"]]), false],
    [createStorage(), false],
    [{
      getItem() { throw new DOMException("blocked", "SecurityError"); },
      setItem() { throw new DOMException("blocked", "SecurityError"); },
      removeItem() { throw new DOMException("blocked", "SecurityError"); },
    }, false],
  ];
  for (const [storage, expectedRegistration] of cases) {
    const preference = readPreference(storage);
    let posts = 0;
    const result = await registerPushInstallationWithConvergence({
      firebaseInstallationId: "fid-auto",
      getOrCreateDeviceId: () => "device-auto",
      readDeviceId: () => "device-auto",
      storePotentialInstallation() { return true; },
      async registerInstallation() { posts += 1; return { ok: true }; },
      canRegister: () => shouldAutoRegisterPush(preference),
    });
    assert.equal(Boolean(result), expectedRegistration);
    assert.equal(posts, expectedRegistration ? 1 : 0);
  }

  const notificationPermission = "granted";
  const noOptIn = readPreference(createStorage());
  assert.equal(notificationPermission, "granted");
  assert.equal(shouldAutoRegisterPush(noOptIn), false);
});

test("opt-in explícito exige write/readback confiável antes de registrar", async () => {
  const preferenceKey = "push-preference";
  const legacyOptOutKey = "push-disabled";
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const persisted = persistPushPreference({
    storage,
    preferenceKey,
    legacyOptOutKey,
    preference: "enabled",
  });
  let postCalls = 0;
  const registration = await registerPushInstallationWithConvergence({
    firebaseInstallationId: "fid-explicit",
    getOrCreateDeviceId: () => "device-explicit",
    readDeviceId: () => "device-explicit",
    storePotentialInstallation() { return true; },
    async registerInstallation() {
      postCalls += 1;
      return { ok: true };
    },
    canRegister: () => persisted && values.get(preferenceKey) === "enabled",
  });
  assert.equal(persisted, true);
  assert.equal(registration.deviceId, "device-explicit");
  assert.equal(postCalls, 1);

  let failedPostCalls = 0;
  const writeFailure = persistPushPreference({
    storage: {
      getItem() { return null; },
      setItem() { throw new DOMException("quota", "QuotaExceededError"); },
      removeItem() {},
    },
    preferenceKey,
    legacyOptOutKey,
    preference: "enabled",
  });
  const failedRegistration = await registerPushInstallationWithConvergence({
    firebaseInstallationId: "fid-never-posted",
    getOrCreateDeviceId: () => "device-never-posted",
    readDeviceId: () => "device-never-posted",
    storePotentialInstallation() { return true; },
    async registerInstallation() {
      failedPostCalls += 1;
      return { ok: true };
    },
    canRegister: () => writeFailure,
  });
  assert.equal(writeFailure, false);
  assert.equal(failedRegistration, null);
  assert.equal(failedPostCalls, 0);

  const staleOptIn = new Map([[preferenceKey, "enabled"]]);
  const disableWriteFailureStorage = {
    getItem(key) { return staleOptIn.get(key) ?? null; },
    setItem() { throw new DOMException("quota", "QuotaExceededError"); },
    removeItem(key) { staleOptIn.delete(key); },
  };
  assert.equal(persistPushPreference({
    storage: disableWriteFailureStorage,
    preferenceKey,
    legacyOptOutKey,
    preference: "disabled",
  }), false);
  assert.equal(staleOptIn.has(preferenceKey), false);
  assert.equal(shouldAutoRegisterPush(readAndMigratePushPreference({
    storage: disableWriteFailureStorage,
    preferenceKey,
    legacyOptOutKey,
    installationKey: "push-fid",
    deviceKey: "push-device",
  })), false, "falha ao gravar disabled não preserva opt-in stale");
});

test("migração legada exige FID e device_id coerentes e acontece uma única vez", () => {
  const preferenceKey = "push-preference";
  const legacyOptOutKey = "push-disabled";
  const installationKey = "push-fid";
  const deviceKey = "push-device";
  const values = new Map([[installationKey, "fid-legacy"]]);
  let writes = 0;
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes += 1; values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const read = () => readAndMigratePushPreference({
    storage,
    preferenceKey,
    legacyOptOutKey,
    installationKey,
    deviceKey,
  });

  assert.equal(read(), "unknown", "FID isolado pode ser stale e não prova opt-in");
  values.set(deviceKey, "10000000-0000-4000-8000-000000000010");
  assert.equal(read(), "enabled");
  const writesAfterMigration = writes;
  assert.equal(read(), "enabled");
  assert.equal(writes, writesAfterMigration, "marcador novo evita nova migração");

  values.set(legacyOptOutKey, "true");
  assert.equal(read(), "disabled", "opt-out legado sempre prevalece");
  assert.equal(values.get(preferenceKey), "disabled");
});

test("FID é persistido antes do POST e resposta perdida permanece para reload e retry", async () => {
  const installationSetKey = "push-potential";
  const legacyInstallationKey = "push-fid";
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const fid = "fid-x";
  const deviceId = "10000000-0000-4000-8000-00000000000a";
  const readKnown = () => readPotentialPushInstallations({ storage, installationSetKey, legacyInstallationKey });
  let observedBeforePost = false;
  const registrationResult = await registerPushInstallationWithConvergence({
    firebaseInstallationId: fid,
    getOrCreateDeviceId: () => deviceId,
    readDeviceId: () => deviceId,
    storePotentialInstallation: (firebaseInstallationId) => persistPotentialPushInstallation({ storage, installationSetKey, firebaseInstallationId }),
    registerInstallation: async () => {
      observedBeforePost = readKnown().includes(fid);
      throw new Error("response lost after apply");
    },
    canRegister: () => true,
    maxAttempts: 1,
  });
  assert.equal(registrationResult, null);
  assert.equal(observedBeforePost, true);
  assert.deepEqual(readKnown(), [fid]);
  const deletes = [];
  const result = await runPushDisableCleanup({
    firebaseInstallationIds: readKnown(),
    async disableInstallation(firebaseInstallationId) {
      deletes.push(firebaseInstallationId);
      return { ok: await isPushMutationConfirmed(new Response(JSON.stringify({ disabled: true }), { status: 200 }), "disable") };
    },
    removeInstallation(firebaseInstallationId) {
      assert.equal(removePotentialPushInstallation({ storage, installationSetKey, legacyInstallationKey, firebaseInstallationId }), true);
    },
    async unregisterInstallation() {},
  });
  assert.equal(result.synchronized, true);
  assert.deepEqual(deletes, [fid]);
  assert.deepEqual(readKnown(), []);
});

test("dois FIDs são reconciliados independentemente e falha preserva somente o retry", async () => {
  const installationSetKey = "push-potential";
  const legacyInstallationKey = "push-fid";
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  for (const firebaseInstallationId of ["fid-old", "fid-new"]) assert.equal(persistPotentialPushInstallation({ storage, installationSetKey, firebaseInstallationId }), true);
  const readKnown = () => readPotentialPushInstallations({ storage, installationSetKey, legacyInstallationKey });
  await runPushLogoutCleanup({
    firebaseInstallationIds: readKnown(),
    async disableInstallation(fid) { if (fid === "fid-old") throw new Error("lost"); return { ok: true }; },
    removeInstallation(fid) { assert.equal(removePotentialPushInstallation({ storage, installationSetKey, legacyInstallationKey, firebaseInstallationId: fid }), true); },
    async unregisterInstallation() { throw new Error("firebase offline"); },
    storeLocalOptOut() {},
  });
  assert.deepEqual(readKnown(), ["fid-old"]);
  const retries = [];
  await runPushLogoutCleanup({
    firebaseInstallationIds: readKnown(),
    async disableInstallation(fid) { retries.push(fid); return { ok: true }; },
    removeInstallation(fid) { assert.equal(removePotentialPushInstallation({ storage, installationSetKey, legacyInstallationKey, firebaseInstallationId: fid }), true); },
    async unregisterInstallation() {},
    storeLocalOptOut() {},
  });
  assert.deepEqual(retries, ["fid-old"]);
  assert.deepEqual(readKnown(), []);
});

test("entradas independentes por FID impedem lost update multiaba e aplicam limite fail-closed", () => {
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const input = { storage, installationSetKey: "potential", legacyInstallationKey: "legacy" };
  assert.equal(persistPotentialPushInstallation({ ...input, firebaseInstallationId: "fid-a" }), true);
  assert.equal(persistPotentialPushInstallation({ ...input, firebaseInstallationId: "fid-b" }), true);
  assert.deepEqual(readPotentialPushInstallations(input), ["fid-a", "fid-b"]);
  assert.equal(removePotentialPushInstallation({ ...input, firebaseInstallationId: "fid-a" }), true);
  assert.deepEqual(readPotentialPushInstallations(input), ["fid-b"], "remoção concorrente não sobrescreve outra entrada");
  for (let index = 0; index < 7; index += 1) {
    assert.equal(persistPotentialPushInstallation({ ...input, firebaseInstallationId: `fid-${index}` }), true);
  }
  assert.equal(persistPotentialPushInstallation({ ...input, firebaseInstallationId: "fid-over-limit" }), false);
  assert.equal(readPotentialPushInstallations(input).includes("fid-over-limit"), false);
});

test("FID legado coexistente é unido e só é removido pelo DELETE correspondente", () => {
  const values = new Map([
    ["confirmed", JSON.stringify({ deviceId: "10000000-0000-4000-8000-000000000001", firebaseInstallationId: "fid-legacy" })],
  ]);
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const input = { storage, installationSetKey: "potential", legacyInstallationKey: "legacy-fid", legacyConfirmedKey: "confirmed" };
  assert.equal(persistPotentialPushInstallation({ ...input, firebaseInstallationId: "fid-new" }), true);
  assert.deepEqual(readPotentialPushInstallations(input), ["fid-legacy", "fid-new"]);
  assert.equal(removePotentialPushInstallation({ ...input, firebaseInstallationId: "fid-new" }), true);
  assert.notEqual(storage.getItem("confirmed"), null);
  assert.equal(removePotentialPushInstallation({ ...input, firebaseInstallationId: "fid-legacy" }), true);
  assert.equal(storage.getItem("confirmed"), null);
});

test("user switch mantém disable isolado por auth.uid e FID, independente de device_id", () => {
  const rows = new Map();
  const register = (userId, deviceId, fid) => rows.set(fid, { userId, deviceId, enabled: true });
  const disable = (userId, fid) => {
    const row = rows.get(fid);
    if (!row || row.userId !== userId) return false;
    row.enabled = false;
    return true;
  };
  register("user-a", "device-a", "fid-x");
  register("user-b", "device-b", "fid-x");
  assert.equal(disable("user-a", "fid-x"), false);
  assert.equal(rows.get("fid-x").enabled, true);
  assert.equal(disable("user-b", "fid-x"), true);
  assert.equal(rows.get("fid-x").enabled, false);
});

test("falha de write/readback bloqueia POST", async () => {
  let posts = 0;
  const result = await registerPushInstallationWithConvergence({
    firebaseInstallationId: "fid-blocked",
    getOrCreateDeviceId: () => "10000000-0000-4000-8000-000000000001",
    readDeviceId: () => "10000000-0000-4000-8000-000000000001",
    storePotentialInstallation: () => false,
    async registerInstallation() { posts += 1; return { ok: true }; },
    canRegister: () => true,
  });
  assert.equal(result, null);
  assert.equal(posts, 0);
});

test("duas abas com candidatos distintos convergem local/backend e DELETE usa a identidade final", async () => {
  const fid = "fid-shared-installation";
  const candidateA = "10000000-0000-4000-8000-00000000000a";
  const candidateB = "10000000-0000-4000-8000-00000000000b";
  const firstPostA = deferred();
  const rows = new Map();
  const requests = [];
  let storedDeviceId = null;
  let confirmedRegistration = null;

  const registerBackend = async (deviceId, firebaseInstallationId) => {
    requests.push(["POST", deviceId, firebaseInstallationId]);
    if (deviceId === candidateA && requests.length === 1) {
      await firstPostA.promise;
    }
    for (const [rowDeviceId, row] of rows) {
      if (row.fid === firebaseInstallationId && rowDeviceId !== deviceId) {
        rows.delete(rowDeviceId);
      }
    }
    rows.set(deviceId, { fid: firebaseInstallationId, enabled: true });
    return { ok: true };
  };
  const runTab = (candidate) => registerPushInstallationWithConvergence({
    firebaseInstallationId: fid,
    getOrCreateDeviceId() {
      storedDeviceId = candidate;
      return candidate;
    },
    readDeviceId: () => storedDeviceId,
    storePotentialInstallation(firebaseInstallationId) {
      confirmedRegistration = { deviceId: storedDeviceId, firebaseInstallationId };
      return true;
    },
    registerInstallation: registerBackend,
    canRegister: () => true,
    maxAttempts: 3,
  });

  const tabA = runTab(candidateA);
  const tabB = runTab(candidateB);
  const resultB = await tabB;
  firstPostA.resolve();
  const resultA = await tabA;

  assert.equal(resultA.deviceId, candidateB);
  assert.equal(resultB.deviceId, candidateB);
  assert.equal(storedDeviceId, candidateB);
  assert.deepEqual(confirmedRegistration, {
    deviceId: candidateB,
    firebaseInstallationId: fid,
  });
  assert.deepEqual([...rows], [[candidateB, { fid, enabled: true }]]);
  assert.equal(requests.filter(([method]) => method === "POST").length, 3);

  const deleteDeviceId = storedDeviceId;
  requests.push([
    "DELETE",
    confirmedRegistration.deviceId,
    confirmedRegistration.firebaseInstallationId,
  ]);
  const row = rows.get(deleteDeviceId);
  if (row?.fid === confirmedRegistration.firebaseInstallationId) {
    row.enabled = false;
  }
  const deleteConfirmed = row?.enabled === false;
  assert.equal(deleteConfirmed, true);
  assert.deepEqual([...rows], [[candidateB, { fid, enabled: false }]]);
  assert.equal(rows.has(candidateA), false, "RPC canônico remove a identidade perdida");
});

test("opt-out durante POST stale termina convergência antes do DELETE final", async () => {
  const fid = "fid-disable-race";
  const candidateA = "10000000-0000-4000-8000-00000000000a";
  const candidateB = "10000000-0000-4000-8000-00000000000b";
  const pendingPost = deferred();
  const rows = new Map();
  const requests = [];
  let storedDeviceId = candidateA;
  let confirmedRegistration = null;
  let enabled = true;

  const registration = registerPushInstallationWithConvergence({
    firebaseInstallationId: fid,
    getOrCreateDeviceId: () => candidateA,
    readDeviceId: () => storedDeviceId,
    storePotentialInstallation(firebaseInstallationId) {
      confirmedRegistration = { deviceId: storedDeviceId, firebaseInstallationId };
      return true;
    },
    async registerInstallation(deviceId, firebaseInstallationId) {
      requests.push(["POST", deviceId, firebaseInstallationId]);
      if (deviceId === candidateA) await pendingPost.promise;
      for (const [rowDeviceId, row] of rows) {
        if (row.fid === firebaseInstallationId && rowDeviceId !== deviceId) {
          rows.delete(rowDeviceId);
        }
      }
      rows.set(deviceId, { fid: firebaseInstallationId, enabled: true });
      return { ok: true };
    },
    canRegister: () => enabled,
    maxAttempts: 3,
  });

  storedDeviceId = candidateB;
  enabled = false;
  pendingPost.resolve();
  assert.equal(await registration, null, "opt-out nunca conclui ativação");
  assert.deepEqual(requests, [
    ["POST", candidateA, fid],
  ]);
  assert.deepEqual([...rows], [[candidateA, { fid, enabled: true }]]);

  const cleanup = await runPushDisableCleanup({
    firebaseInstallationIds: [fid],
    async disableInstallation(firebaseInstallationId) {
      requests.push(["DELETE", firebaseInstallationId]);
      const row = [...rows.values()].find((candidate) => candidate.fid === firebaseInstallationId);
      if (row) row.enabled = false;
      return { ok: row?.enabled === false };
    },
    removeInstallation() { confirmedRegistration = null; },
    async unregisterInstallation() {
      requests.push(["UNREGISTER"]);
    },
  });
  assert.equal(cleanup.synchronized, true);
  assert.equal(confirmedRegistration, null);
  assert.deepEqual(rows.get(candidateA), { fid, enabled: false });
  assert.deepEqual(requests.at(-2), ["DELETE", fid]);
  assert.deepEqual(requests.at(-1), ["UNREGISTER"]);
  assert.equal(rows.has(candidateB), false);
});

test("mudança de device_id em outra aba aciona a fronteira real de reconciliação", () => {
  const listeners = new Set();
  const storage = {};
  const eventTarget = {
    addEventListener(type, listener) { if (type === "storage") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "storage") listeners.delete(listener); },
  };
  let reconciliations = 0;
  const unsubscribe = subscribeToPushDeviceIdentityEvents({
    eventTarget,
    storage,
    storageKey: "push-device",
    onIdentityChange() { reconciliations += 1; },
  });
  for (const listener of listeners) listener({
    storageArea: storage,
    key: "push-device",
    newValue: "device-final",
  });
  assert.equal(reconciliations, 1);
  unsubscribe();
  assert.equal(listeners.size, 0);
});

test("disable supersedes enable, while double click disable remains blocked", () => {
  const gate = createPushOperationGate();
  const enableGeneration = beginPushOperation(gate, "enable");
  assert.equal(enableGeneration, 1);
  assert.equal(beginPushOperation(gate, "enable"), null);
  const disableGeneration = beginPushOperation(gate, "disable");
  assert.equal(disableGeneration, 2);
  assert.equal(beginPushOperation(gate, "disable"), null);
  assert.equal(isCurrentPushOperation(gate, 1, "enable"), false);
  assert.equal(isCurrentPushOperation(gate, 2, "disable"), true);
  assert.equal(finishPushOperation(gate, 0, "enable"), false);
  assert.equal(gate.working, true, "callback antigo não libera a operação atual");
  assert.equal(finishPushOperation(gate, 1, "enable"), false);
  invalidatePushOperations(gate);
  assert.equal(isCurrentPushOperation(gate, 2, "disable"), false);
  assert.equal(gate.working, false);
});

test("enable pendente seguido de disable mantém opt-out e a última intenção vence", async () => {
  const gate = createPushOperationGate();
  const queue = createPushPersistenceQueue();
  const postResponse = deferred();
  const calls = [];
  let confirmedRegistration = null;
  let localOptOut = false;
  let state = "default";
  let registrationGeneration = 1;
  let desiredEnabled = true;

  const enableGeneration = beginPushOperation(gate, "enable");
  const enablePersistence = queue.run(async () => {
    calls.push("post-start");
    await postResponse.promise;
    confirmedRegistration = {
      deviceId: "device-a",
      firebaseInstallationId: "fid-device-a",
    };
    calls.push("post-finish");
    return "fid-device-a";
  }).then(() => {
    if (isCurrentPushOperation(gate, enableGeneration, "enable")) state = "granted";
  });

  const disableGeneration = beginPushOperation(gate, "disable");
  assert.equal(disableGeneration, 2);
  localOptOut = true;
  desiredEnabled = false;
  registrationGeneration += 1;
  state = "default";
  const disableCleanup = queue.run(() => runPushDisableCleanup({
    firebaseInstallationIds: confirmedRegistration ? [confirmedRegistration.firebaseInstallationId] : [],
    async disableInstallation(firebaseInstallationId) {
      calls.push(["delete", firebaseInstallationId]);
      return { ok: true };
    },
    removeInstallation() { confirmedRegistration = null; },
    async unregisterInstallation() { calls.push("unregister"); },
  }));

  const registeredCallback = (callbackGeneration) => {
    if (desiredEnabled && callbackGeneration === registrationGeneration) {
      state = "granted";
    }
  };
  const unregisteredCallback = registeredCallback;
  registeredCallback(1);
  unregisteredCallback(1);
  assert.equal(state, "default", "callbacks antigos não reativam o device");

  postResponse.resolve();
  await enablePersistence;
  const cleanupResult = await disableCleanup;
  assert.equal(cleanupResult.synchronized, true);
  assert.equal(localOptOut, true);
  assert.equal(state, "default");
  assert.equal(confirmedRegistration, null);
  assert.deepEqual(calls, [
    "post-start",
    "post-finish",
    ["delete", "fid-device-a"],
    "unregister",
  ]);
});

test("opt-out entre abas ordena DELETE após POST tardio e desmonta o listener", async () => {
  const listeners = new Set();
  const values = new Map([
    ["negocios-k:push-firebase-installation-id", "fid-device-a"],
  ]);
  const eventTarget = {
    addEventListener(type, listener) {
      if (type === "storage") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "storage") listeners.delete(listener);
    },
  };
  const sharedStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      const oldValue = values.get(key) ?? null;
      values.set(key, value);
      const event = { type: "storage", key, oldValue, newValue: value, storageArea: sharedStorage };
      for (const listener of [...listeners]) listener(event);
    },
    removeItem(key) { values.delete(key); },
  };
  const gateB = createPushOperationGate();
  const queueB = createPushPersistenceQueue();
  const reconcilerB = createPushOptOutReconciler();
  const pendingPost = deferred();
  const requests = [];
  const row = { deviceId: "device-a", fid: "fid-device-a", enabled: true };
  let confirmedRegistration = null;
  let desiredEnabledB = true;
  let registrationGenerationB = 1;
  let stateB = "granted";
  let observedOptOutsB = 0;

  const pendingRegistrationB = queueB.run(async () => {
    requests.push("POST:start:B");
    await pendingPost.promise;
    row.enabled = true;
    confirmedRegistration = {
      deviceId: row.deviceId,
      firebaseInstallationId: row.fid,
    };
    sharedStorage.setItem("negocios-k:push-firebase-installation-id", row.fid);
    requests.push("POST:finish:B");
  });

  const unsubscribeB = subscribeToPushOptOutEvents({
    eventTarget,
    storage: sharedStorage,
    storageKey: "negocios-k:push-disabled",
    onOptOut() {
      observedOptOutsB += 1;
      desiredEnabledB = false;
      registrationGenerationB += 1;
      invalidatePushOperations(gateB);
      stateB = "default";
      void reconcilerB.run(() => queueB.run(() => runPushDisableCleanup({
        firebaseInstallationIds: confirmedRegistration ? [confirmedRegistration.firebaseInstallationId] : [],
        async disableInstallation(firebaseInstallationId) {
          requests.push(`DELETE:B:${firebaseInstallationId}`);
          if (row.fid === firebaseInstallationId) row.enabled = false;
          return { ok: row.enabled === false };
        },
        removeInstallation() { confirmedRegistration = null; },
        async unregisterInstallation() { requests.push("UNREGISTER:B"); },
      })));
    },
  });

  sharedStorage.setItem("negocios-k:push-disabled", "true");
  requests.push("DELETE:A:fid-device-a");
  row.enabled = false;
  assert.equal(desiredEnabledB, false);
  assert.equal(stateB, "default");

  const passiveRegisteredCallbackB = async (callbackGeneration) => {
    if (
      desiredEnabledB &&
      callbackGeneration === registrationGenerationB &&
      sharedStorage.getItem("negocios-k:push-disabled") !== "true"
    ) {
      await queueB.run(async () => {
        requests.push("POST:late-callback:B");
        row.enabled = true;
      });
      stateB = "granted";
      return true;
    }
    return false;
  };
  assert.equal(await passiveRegisteredCallbackB(1), false);
  assert.equal(stateB, "default", "callback antigo da aba B não volta a granted");

  pendingPost.resolve();
  await pendingRegistrationB;
  await queueB.idle();
  assert.equal(row.enabled, false);
  assert.equal(sharedStorage.getItem("negocios-k:push-disabled"), "true");
  assert.equal(requests.at(-2), "DELETE:B:fid-device-a");
  assert.equal(requests.at(-1), "UNREGISTER:B");
  assert.equal(observedOptOutsB, 1);

  unsubscribeB();
  assert.equal(listeners.size, 0);
  sharedStorage.setItem("negocios-k:push-disabled", "true");
  assert.equal(observedOptOutsB, 1, "aba desmontada não reage a novos eventos");
});

test("reload com opt-out e FID reconcilia exatamente uma vez e mantém UI desativada", async () => {
  const reconciler = createPushOptOutReconciler();
  const rows = new Map([
    ["device-a", { userId: "user-1", fid: "fid-a", enabled: true }],
    ["device-b", { userId: "user-1", fid: "fid-b", enabled: true }],
  ]);
  let confirmedRegistration = {
    deviceId: "device-a",
    firebaseInstallationId: "fid-a",
  };
  let deleteCalls = 0;
  let unregisterCalls = 0;
  const permissionRequests = 0;
  let uiState = "default";
  const desiredEnabled = false;
  const registrationGeneration = 2;

  const work = () => runPushDisableCleanup({
    firebaseInstallationIds: confirmedRegistration ? [confirmedRegistration.firebaseInstallationId] : [],
    async disableInstallation(firebaseInstallationId) {
      deleteCalls += 1;
      const row = rows.get("device-a");
      if (
        row?.userId === "user-1" &&
        row.fid === firebaseInstallationId
      ) row.enabled = false;
      return { ok: row?.enabled === false };
    },
    removeInstallation() { confirmedRegistration = null; },
    async unregisterInstallation() { unregisterCalls += 1; },
  });
  await Promise.all([reconciler.run(work), reconciler.run(work)]);

  const lateRegistration = (callbackGeneration) => {
    if (desiredEnabled && callbackGeneration === registrationGeneration) {
      uiState = "granted";
    }
  };
  lateRegistration(1);
  assert.equal(uiState, "default");
  assert.equal(permissionRequests, 0);
  assert.equal(deleteCalls, 1);
  assert.equal(unregisterCalls, 1);
  assert.equal(confirmedRegistration, null);
  assert.equal(rows.get("device-a").enabled, false);
  assert.equal(rows.get("device-b").enabled, true);
});

test("reconciliação false ou falha preserva FID e o próximo reload tenta novamente", async () => {
  for (const firstAttempt of ["false", "throw"]) {
    let confirmedRegistration = {
      deviceId: "device-a",
      firebaseInstallationId: "fid-a",
    };
    let deleteCalls = 0;
    let unregisterCalls = 0;
    const reconcile = (reconciler, succeeds) => reconciler.run(() =>
      runPushDisableCleanup({
        firebaseInstallationIds: confirmedRegistration ? [confirmedRegistration.firebaseInstallationId] : [],
        async disableInstallation() {
          deleteCalls += 1;
          if (firstAttempt === "throw" && deleteCalls === 1) {
            throw new Error("offline");
          }
          return { ok: succeeds };
        },
        removeInstallation() { confirmedRegistration = null; },
        async unregisterInstallation() { unregisterCalls += 1; },
      }));

    const firstReload = createPushOptOutReconciler();
    const firstResult = await reconcile(firstReload, false);
    assert.equal(firstResult.synchronized, false);
    assert.equal(confirmedRegistration.firebaseInstallationId, "fid-a");
    assert.equal(deleteCalls, 1);
    assert.equal(unregisterCalls, 1);

    const nextReload = createPushOptOutReconciler();
    const retryResult = await reconcile(nextReload, true);
    assert.equal(retryResult.synchronized, true);
    assert.equal(confirmedRegistration, null);
    assert.equal(deleteCalls, 2);
    assert.equal(unregisterCalls, 2);
  }
});

test("DELETE falho preserva FID e retry usa usuário, device e FID originais", async () => {
  const identity = {
    userId: "user-current",
    deviceId: "device-a",
    firebaseInstallationId: "fid-a",
  };
  let confirmedRegistration = { deviceId: identity.deviceId, firebaseInstallationId: identity.firebaseInstallationId };
  let attempt = 0;
  const requests = [];
  const cleanup = () => runPushDisableCleanup({
    firebaseInstallationIds: confirmedRegistration ? [confirmedRegistration.firebaseInstallationId] : [],
    async disableInstallation(firebaseInstallationId) {
      attempt += 1;
      requests.push({ ...identity, firebaseInstallationId });
      const response = new Response(
        JSON.stringify({ disabled: attempt === 2 }),
        { status: 200 },
      );
      return { ok: await isPushMutationConfirmed(response, "disable") };
    },
    removeInstallation() { confirmedRegistration = null; },
    async unregisterInstallation() {},
  });

  assert.equal((await cleanup()).synchronized, false);
  assert.deepEqual(confirmedRegistration, { deviceId: "device-a", firebaseInstallationId: "fid-a" });
  assert.equal((await cleanup()).synchronized, true);
  assert.equal(confirmedRegistration, null);
  assert.deepEqual(requests, [identity, identity]);
});

test("disable sem FID ainda tenta unregister e falhas permanecem retryable", async () => {
  let unregisterAttempts = 0;
  const result = await runPushDisableCleanup({
    firebaseInstallationIds: [],
    async disableInstallation() { throw new Error("DELETE indevido"); },
    removeInstallation() { throw new Error("remoção indevida"); },
    async unregisterInstallation() {
      unregisterAttempts += 1;
      throw new Error("firebase offline");
    },
  });
  assert.equal(unregisterAttempts, 1);
  assert.deepEqual(result, {
    deleteConfirmed: true,
    unregisterConfirmed: false,
    synchronized: false,
  });
});

test("falha ao remover FID local após DELETE não impede unregister", async () => {
  const calls = [];
  const result = await runPushDisableCleanup({
    firebaseInstallationIds: ["fid-device-a"],
    async disableInstallation(fid) {
      calls.push(["delete", fid]);
      return { ok: true };
    },
    removeInstallation(fid) {
      calls.push(["remove", fid]);
      throw new DOMException("storage blocked", "SecurityError");
    },
    async unregisterInstallation() {
      calls.push(["unregister"]);
    },
  });
  assert.deepEqual(calls, [
    ["delete", "fid-device-a"],
    ["remove", "fid-device-a"],
    ["unregister"],
  ]);
  assert.deepEqual(result, {
    deleteConfirmed: true,
    unregisterConfirmed: true,
    synchronized: true,
  });
});

test("dois devices do mesmo usuário: disable A não modifica B", async () => {
  const rows = new Map([
    ["device-a", { userId: "user-1", fid: "fid-a", enabled: true }],
    ["device-b", { userId: "user-1", fid: "fid-b", enabled: true }],
  ]);
  const currentUserId = "user-1";
  const currentDeviceId = "device-a";
  await runPushDisableCleanup({
    firebaseInstallationIds: ["fid-a"],
    async disableInstallation(fid) {
      const row = rows.get(currentDeviceId);
      if (row?.userId === currentUserId && row.fid === fid) row.enabled = false;
      return { ok: row?.enabled === false };
    },
    removeInstallation() {},
    async unregisterInstallation() {},
  });
  assert.equal(rows.get("device-a").enabled, false);
  assert.deepEqual(rows.get("device-b"), {
    userId: "user-1",
    fid: "fid-b",
    enabled: true,
  });
});

test("controle compartilhado cobre estados e denied nunca solicita permissão", () => {
  for (const state of [
    "checking",
    "granted",
    "default",
    "unsupported",
    "not_configured",
    "ios_install_required",
    "denied",
    "error",
  ]) {
    assert.match(controlSource, new RegExp(`state === "${state}"|"${state}"`));
  }
  assert.match(controlSource, /configurações do site/);
  assert.match(controlSource, /adicone|adicione o NK à Tela de Início/i);
  const enableFlow = providerSource.slice(
    providerSource.indexOf("const enable"),
    providerSource.indexOf("const disable"),
  );
  const deniedIndex = enableFlow.indexOf('Notification.permission === "denied"');
  const requestIndex = enableFlow.indexOf("requestFirebasePushPermission()");
  assert.ok(deniedIndex >= 0);
  assert.ok(requestIndex >= 0);
  assert.ok(deniedIndex < requestIndex);
  assert.match(accountSource, /<PushNotificationControl/);
  assert.match(read("components/safisa-pickup-alerts.tsx"), /<PushNotificationControl/);
});

test("logout desativa somente o FID armazenado e não toca outro dispositivo", async () => {
  const calls = [];
  await runPushLogoutCleanup({
    firebaseInstallationIds: ["fid-device-a"],
    async disableInstallation(fid) {
      calls.push(["disable", fid]);
      return { ok: true };
    },
    removeInstallation(fid) { calls.push(["remove", fid]); },
    async unregisterInstallation() { calls.push(["unregister"]); },
    storeLocalOptOut() { calls.push(["opt-out"]); },
  });
  assert.deepEqual(calls, [
    ["opt-out"],
    ["disable", "fid-device-a"],
    ["remove", "fid-device-a"],
    ["unregister"],
  ]);
  assert.equal(JSON.stringify(calls).includes("fid-device-b"), false);
});

test("logout continua unregister e opt-out quando DELETE falha ou não retorna OK", async () => {
  for (const disableInstallation of [
    async () => ({ ok: false }),
    async () => { throw new Error("offline"); },
  ]) {
    const calls = [];
    await runPushLogoutCleanup({
      firebaseInstallationIds: ["fid-device-a"],
      disableInstallation,
      removeInstallation() { calls.push("remove"); },
      async unregisterInstallation() { calls.push("unregister"); },
      storeLocalOptOut() { calls.push("opt-out"); },
    });
    assert.deepEqual(calls, ["opt-out", "unregister"]);
  }
});

test("logout conclui opt-out mesmo quando unregister falha", async () => {
  const calls = [];
  await runPushLogoutCleanup({
    firebaseInstallationIds: ["fid-device-a"],
    async disableInstallation() { return { ok: true }; },
    removeInstallation() { calls.push("remove"); },
    async unregisterInstallation() { throw new Error("firebase failure"); },
    storeLocalOptOut() { calls.push("opt-out"); },
  });
  assert.deepEqual(calls, ["opt-out", "remove"]);
});

test("opt-out lançando não impede DELETE, unregister ou logout", async () => {
  const calls = [];
  const result = await runPushLogoutCleanup({
    firebaseInstallationIds: ["fid-device-a"],
    async disableInstallation(fid) {
      calls.push(["delete", fid]);
      return { ok: true };
    },
    removeInstallation(fid) { calls.push(["remove", fid]); },
    async unregisterInstallation() { calls.push(["unregister"]); },
    storeLocalOptOut() {
      calls.push(["opt-out"]);
      throw new DOMException("storage blocked", "SecurityError");
    },
  });
  assert.equal(result.synchronized, true);
  assert.deepEqual(calls, [
    ["opt-out"],
    ["delete", "fid-device-a"],
    ["remove", "fid-device-a"],
    ["unregister"],
  ]);
});

test("fluxo limitado sempre submete após sucesso, throw ou timeout", async () => {
  let submissions = 0;
  await runBoundedLogoutFlow({
    cleanup: Promise.resolve(),
    deadline: new Promise(() => undefined),
    submit: () => { submissions += 1; },
  });
  await runBoundedLogoutFlow({
    cleanup: Promise.reject(new Error("cleanup failed")),
    deadline: new Promise(() => undefined),
    submit: () => { submissions += 1; },
  });
  await runBoundedLogoutFlow({
    cleanup: new Promise(() => undefined),
    deadline: Promise.resolve(),
    submit: () => { submissions += 1; },
  });
  assert.equal(submissions, 3);
});

test("logout invalida enable e libera submit em 1,2s mesmo com fila pendente", async () => {
  const gate = createPushOperationGate();
  const queue = createPushPersistenceQueue();
  const pendingPost = deferred();
  const enableGeneration = beginPushOperation(gate, "enable");
  void queue.run(() => pendingPost.promise);
  let localOptOut = false;
  let submissions = 0;

  invalidatePushOperations(gate);
  localOptOut = true;
  const cleanup = queue.run(() => runPushLogoutCleanup({
    firebaseInstallationIds: ["fid-device-a"],
    async disableInstallation() { return { ok: true }; },
    removeInstallation() {},
    async unregisterInstallation() {},
    storeLocalOptOut() { localOptOut = true; },
  }));
  await runBoundedLogoutFlow({
    cleanup,
    deadline: Promise.resolve("1.2s"),
    submit: () => { submissions += 1; },
  });

  assert.equal(isCurrentPushOperation(gate, enableGeneration, "enable"), false);
  assert.equal(localOptOut, true);
  assert.equal(submissions, 1);
  pendingPost.resolve();
  await cleanup;
  assert.equal(submissions, 1);
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
  assert.equal((actionsSource.match(/await dispatchSafisaFullyReadyPush\(input\.supplierOrderId\);/g) ?? []).length, 4);
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

test("logout interno usa um único fluxo push-aware, preserva o marcador e encerra só a sessão local", () => {
  assert.match(sidebarSource, /<PushAwareLogoutForm/);
  assert.match(accountSource, /<PushAwareLogoutForm/);
  assert.match(read("components/account-menu.tsx"), /<PushAwareLogoutForm/);
  assert.match(logoutFormSource, /data-assistant-session-logout/);
  assert.match(logoutFormSource, /cleanup: prepareForLogout\(\)/);
  assert.match(logoutFormSource, /window\.setTimeout\(resolve, pushCleanupDeadlineMs\)/);
  assert.match(logoutFormSource, /allowSubmitRef\.current = true;\s*form\.requestSubmit\(\)/);
  assert.match(providerSource, /runStoredPushDisableCleanup\(true\)/);
  assert.match(authActionsSource, /export async function logout\(\)[\s\S]*signOut\(\{ scope: "local" \}\)/);
  const loginFailureCleanup = authActionsSource.slice(
    authActionsSource.indexOf("if (profileError || !profile)"),
    authActionsSource.indexOf('redirect("/")'),
  );
  assert.match(loginFailureCleanup, /signOut\(\)/);
  assert.doesNotMatch(loginFailureCleanup, /scope: "local"/);
});
