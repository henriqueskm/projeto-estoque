import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cancelSupplierOrder,
  cancelSupplierOrderRemaining,
  markSupplierOrderAllPicked,
  setSupplierOrderItemPickedQuantity,
} from "../app/(authenticated)/pedidos/actions.ts";
import { runSupplierOrderConfirmationMutation } from "../lib/supplier-order-stale-conflict.ts";

const orderId = "57000000-0000-4000-8000-000000000001";
const lineId = "57000000-0000-4000-8000-000000000002";
const key = "57000000-0000-4000-8000-000000000003";
const version = "2026-09-14T01:02:03.123456+00:00";

test("ConfirmationDialog delegates the displayed order to the tested transition", () => {
  const workspace = readFileSync(
    new URL("../app/(authenticated)/pedidos/orders-workspace.tsx", import.meta.url),
    "utf8",
  );
  const confirmationDialog = workspace.slice(
    workspace.indexOf("function ConfirmationDialog"),
    workspace.indexOf("function FinalizationDialog"),
  );

  assert.match(
    confirmationDialog,
    /runSupplierOrderConfirmationMutation\(\{[\s\S]*supplierOrder: order,/,
  );
  assert.match(confirmationDialog, /closeConfirmation: onClose,/);
  assert.match(confirmationDialog, /isCurrentAttempt:/);
});

function createSupabaseClient(calls) {
  const profileQuery = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return {
        data: { id: orderId, name: "NK57 Test User" },
        error: null,
      };
    },
  };

  return {
    auth: {
      async getClaims() {
        return { data: { claims: { sub: orderId } }, error: null };
      },
    },
    from(table) {
      assert.equal(table, "profiles");
      return profileQuery;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: null,
        error: { code: "40001", message: "supplier_order_version_conflict" },
      };
    },
  };
}

test("all four application actions send the displayed version to checked RPCs", async () => {
  const calls = [];
  globalThis.__nk57RevalidatedPaths = [];
  globalThis.__nk57Pushes = [];
  globalThis.__nk57SupabaseClient = createSupabaseClient(calls);

  const results = await Promise.all([
    setSupplierOrderItemPickedQuantity({
      supplier_order_item_id: lineId,
      picked_quantity: 2,
      description: null,
      expected_updated_at: version,
      idempotency_key: key,
    }),
    markSupplierOrderAllPicked({
      supplier_order_id: orderId,
      description: null,
      expected_updated_at: version,
      idempotency_key: key,
    }),
    cancelSupplierOrder({
      supplier_order_id: orderId,
      cancellation_note: "Cancelamento total de teste",
      expected_updated_at: version,
      idempotency_key: key,
    }),
    cancelSupplierOrderRemaining({
      supplier_order_id: orderId,
      cancellation_note: "Cancelamento restante de teste",
      expected_updated_at: version,
      idempotency_key: key,
    }),
  ]);

  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      "set_supplier_order_item_picked_quantity_checked",
      "mark_supplier_order_all_picked_checked",
      "cancel_supplier_order_checked",
      "cancel_supplier_order_remaining_checked",
    ],
  );
  assert.equal(calls[0].args.p_expected_order_updated_at, version);
  assert.equal(calls[1].args.p_expected_order_updated_at, version);
  assert.equal(calls[2].args.p_expected_order_updated_at, version);
  assert.equal(calls[3].args.p_expected_order_updated_at, version);
  assert.equal(calls[0].args.p_target_picked_quantity, 2);
  assert.equal("p_picked_quantity" in calls[0].args, false);
  assert.equal(results.every((result) => !result.ok && result.stale), true);
  assert.deepEqual(globalThis.__nk57RevalidatedPaths, []);
  assert.deepEqual(globalThis.__nk57Pushes, []);
});

test("invalid or missing displayed versions fail before an RPC call", async () => {
  const calls = [];
  globalThis.__nk57RevalidatedPaths = [];
  globalThis.__nk57Pushes = [];
  globalThis.__nk57SupabaseClient = createSupabaseClient(calls);

  const result = await cancelSupplierOrder({
    supplier_order_id: orderId,
    cancellation_note: "Motivo válido",
    idempotency_key: key,
  });

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("ConfirmationDialog transition sends the displayed version and performs complete stale recovery", async () => {
  const effects = [];
  const payloads = [];
  let detailReloadKey = 7;
  let successCount = 0;
  const outcome = await runSupplierOrderConfirmationMutation({
    supplierOrder: { id: orderId, updatedAt: version },
    idempotencyKey: key,
    isCurrentAttempt: () => true,
    execute: async (payload) => {
      payloads.push(payload);
      return {
        ok: false,
        stale: true,
        error: "O pedido mudou. Revise os dados recarregados.",
      };
    },
    clearAttempt: () => effects.push("clear-attempt"),
    closeConfirmation: () => effects.push("close-confirmation"),
    onStale: (message, staleOrderId) => {
      effects.push(`message:${message}`);
      effects.push(`reload:${staleOrderId}`);
      detailReloadKey += 1;
    },
    onError: (message) => effects.push(`error:${message}`),
    onSuccess: () => {
      successCount += 1;
    },
  });

  assert.equal(outcome, "stale");
  assert.deepEqual(payloads, [
    { expected_updated_at: version, idempotency_key: key },
  ]);
  assert.deepEqual(effects, [
    "clear-attempt",
    "close-confirmation",
    "message:O pedido mudou. Revise os dados recarregados.",
    `reload:${orderId}`,
  ]);
  assert.equal(detailReloadKey, 8);
  assert.equal(successCount, 0);
});

test("failed stale refresh preserves the explicit message and never reports success", async () => {
  const effects = [];
  let successCount = 0;
  const outcome = await runSupplierOrderConfirmationMutation({
    supplierOrder: { id: orderId, updatedAt: version },
    idempotencyKey: key,
    isCurrentAttempt: () => true,
    execute: async () => ({
      ok: false,
      stale: true,
      error: "O pedido mudou. Revise os dados recarregados.",
    }),
    clearAttempt: () => effects.push("clear-attempt"),
    closeConfirmation: () => effects.push("close-confirmation"),
    onStale: async (message, staleOrderId) => {
      effects.push(`message:${message}`);
      effects.push(`reload:${staleOrderId}`);
      throw new Error("detail fetch failed");
    },
    onError: (message) => effects.push(`error:${message}`),
    onSuccess: () => {
      successCount += 1;
    },
  });

  assert.equal(outcome, "stale");
  assert.deepEqual(effects, [
    "clear-attempt",
    "close-confirmation",
    "message:O pedido mudou. Revise os dados recarregados.",
    `reload:${orderId}`,
  ]);
  assert.equal(successCount, 0);
});

test("a superseded callback cannot overwrite the latest stale recovery", async () => {
  const effects = [];
  const deferred = [];
  let currentAttempt = 1;
  let successCount = 0;

  function runAttempt(attempt) {
    return runSupplierOrderConfirmationMutation({
      supplierOrder: { id: orderId, updatedAt: version },
      idempotencyKey: key,
      isCurrentAttempt: () => currentAttempt === attempt,
      execute: () =>
        new Promise((resolve) => {
          deferred[attempt] = resolve;
        }),
      clearAttempt: () => effects.push(`clear:${attempt}`),
      closeConfirmation: () => effects.push(`close:${attempt}`),
      onStale: (message) => effects.push(`stale:${attempt}:${message}`),
      onError: (message) => effects.push(`error:${attempt}:${message}`),
      onSuccess: () => {
        successCount += 1;
      },
    });
  }

  const oldAttempt = runAttempt(1);
  currentAttempt = 2;
  const latestAttempt = runAttempt(2);
  deferred[2]({ ok: false, stale: true, error: "Recarregue o pedido." });
  assert.equal(await latestAttempt, "stale");
  deferred[1]({ ok: true, receipt: {} });
  assert.equal(await oldAttempt, "superseded");

  assert.deepEqual(effects, [
    "clear:2",
    "close:2",
    "stale:2:Recarregue o pedido.",
  ]);
  assert.equal(successCount, 0);
});

test("ordinary failures stay in the open confirmation without reload or success", async () => {
  const effects = [];
  const outcome = await runSupplierOrderConfirmationMutation({
    supplierOrder: { id: orderId, updatedAt: version },
    idempotencyKey: key,
    isCurrentAttempt: () => true,
    execute: async () => ({ ok: false, error: "Corrija os dados." }),
    clearAttempt: () => effects.push("clear-attempt"),
    closeConfirmation: () => effects.push("close-confirmation"),
    onStale: () => effects.push("reload"),
    onError: (message) => effects.push(`error:${message}`),
    onSuccess: () => effects.push("success"),
  });

  assert.equal(outcome, "error");
  assert.deepEqual(effects, ["error:Corrija os dados."]);
});
