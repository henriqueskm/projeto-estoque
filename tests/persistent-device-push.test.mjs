import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getPushRegistrationAction, readConfirmedPushRegistration, persistPushPreference, readAndMigratePushPreference } from "../lib/push-notification-operations.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const userId = "85000000-0000-4000-8000-000000000001";
const otherUser = "85000000-0000-4000-8000-000000000002";
const deviceId = "85000000-0000-4000-8000-000000000003";
const confirmed = { version: 1, userId, deviceId, firebaseInstallationId: "sanitized-fid" };
const request = { confirmed, userId, deviceId, firebaseInstallationId: confirmed.firebaseInstallationId, explicitActivation: false };

test("same owner/device/FID login reuses acknowledgement, without POST or permission prompt", () => {
  assert.equal(getPushRegistrationAction(request), "reuse");
  assert.equal(getPushRegistrationAction({ ...request, explicitActivation: true }), "register");
});

test("login by B never reassigns A's subscription; explicit activation uses canonical registration", () => {
  assert.equal(getPushRegistrationAction({ ...request, userId: otherUser }), "require_activation");
  assert.equal(getPushRegistrationAction({ ...request, userId: otherUser, explicitActivation: true }), "register");
});

test("legacy or absent ownership does not infer consent from login/browser permission", () => {
  assert.equal(getPushRegistrationAction({ ...request, confirmed: null }), "require_activation");
  assert.equal(getPushRegistrationAction({ ...request, confirmed: null, explicitActivation: true }), "register");
});

test("FID or device rotation renews only the previously acknowledged owner", () => {
  for (const change of [{ firebaseInstallationId: "rotated-fid" }, { deviceId: otherUser }]) {
    assert.equal(getPushRegistrationAction({ ...request, ...change }), "register");
    assert.equal(getPushRegistrationAction({ ...request, ...change, userId: otherUser }), "require_activation");
  }
});

test("acknowledgement schema is bounded and fails closed; no credentials or user-scoped preference", () => {
  const storage = { getItem: () => JSON.stringify(confirmed) };
  assert.deepEqual(readConfirmedPushRegistration(storage, "ack"), confirmed);
  for (const invalid of [null, {}, { ...confirmed, version: 2 }, { ...confirmed, userId: "invalid" },
    { ...confirmed, deviceId: "invalid" }, { ...confirmed, firebaseInstallationId: "x".repeat(513) }]) {
    assert.equal(readConfirmedPushRegistration({ getItem: () => JSON.stringify(invalid) }, "ack"), null);
  }
  assert.equal(readConfirmedPushRegistration({ getItem() { throw Error("blocked"); } }, "ack"), null);
  assert.equal(readConfirmedPushRegistration({ getItem: () => "{" }, "ack"), null);
  assert.doesNotMatch(read("components/push-notification-provider.tsx"), /push-preference:\$|prepareForLogout|disablePushBeforeLogout/);
});

test("explicit disable survives logout/login and explicit enable restores device opt-in", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const input = { storage, preferenceKey: "device-preference", legacyOptOutKey: "disabled", installationKey: "fid", deviceKey: "device" };
  assert.equal(persistPushPreference({ ...input, preference: "enabled" }), true);
  assert.equal(readAndMigratePushPreference(input), "enabled");
  assert.equal(persistPushPreference({ ...input, preference: "disabled" }), true);
  for (let login = 0; login < 2; login++) assert.equal(readAndMigratePushPreference(input), "disabled");
  assert.equal(persistPushPreference({ ...input, preference: "enabled" }), true);
  assert.equal(readAndMigratePushPreference(input), "enabled");
});

test("bell is activation-only, disappears when granted; account retains full management", () => {
  const control = read("components/push-notification-control.tsx");
  assert.match(control, /mode = "full"/);
  assert.match(control, /mode === "activate-only" && state === "granted"\) return null/);
  assert.match(control, /showDisable = mode === "full"/);
  assert.match(control, /Desativar notificações/);
  assert.match(read("components/safisa-pickup-alerts.tsx"), /<PushNotificationControl mode="activate-only"/);
  assert.match(read("app/(authenticated)/minha-conta/page.tsx"), /<PushNotificationControl/);
});

test("only explicit disable owns DELETE/unregister; provider teardown/logout never opt out", () => {
  const provider = read("components/push-notification-provider.tsx");
  assert.equal((provider.match(/persistInstallation\(firebaseInstallationId, "DELETE"/g) ?? []).length, 1);
  assert.equal((provider.match(/unregisterInstallation: unregisterFirebasePushInstallation/g) ?? []).length, 1);
  assert.doesNotMatch(read("components/push-aware-logout-form.tsx"), /onSubmit|push-notification|prepareForLogout/);
  assert.match(provider, /version: 1, userId, \.\.\.registration/);
  assert.match(read("app/(authenticated)/layout.tsx"), /PushNotificationProvider key=\{profile.id\} userId=\{profile.id\}/);
});

test("current sidebar section cancels navigation and skips before-navigation cleanup", () => {
  assert.match(read("components/app-sidebar.tsx"), /isActive && event.button === 0[\s\S]*event.preventDefault\(\)/);
  assert.match(read("components/workspace-state-provider.tsx"), /data-nk-navigation[\s\S]*aria-current[\s\S]*=== "page"\) return/);
});

test("Safisa order list in chat reuses fresh canonical bulk action, never pending-stock action", () => {
  const source = read("components/assistant-structured-block.tsx");
  const orders = source.slice(source.indexOf("function AssistantAttentionOrders"), source.indexOf("function InventoryMultiItemSummary"));
  assert.match(orders, /block.alertKind === "SAFISA_READY_PICKUP"[\s\S]*<LiveSafisaBulkPickupAction/);
  assert.match(source, /hasConfirmedData && !error && alertCount > 0/);
  assert.match(source, /<SafisaBulkPickupAction enabled=\{liveHasPickup\}/);
  assert.doesNotMatch(orders, /enabled=\{block.orders/);
  assert.match(read("components/safisa-bulk-pickup-dialog.tsx"), /await previewSafisaBulkPickup\(\)/);
});
