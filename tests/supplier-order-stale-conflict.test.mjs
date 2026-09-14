import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelSupplierOrder,
  cancelSupplierOrderRemaining,
  markSupplierOrderAllPicked,
  setSupplierOrderItemPickedQuantity,
} from "../app/(authenticated)/pedidos/actions.ts";
import { handleSupplierOrderStaleConflict } from "../lib/supplier-order-stale-conflict.ts";

const orderId = "57000000-0000-4000-8000-000000000001";
const lineId = "57000000-0000-4000-8000-000000000002";
const key = "57000000-0000-4000-8000-000000000003";
const version = "2026-09-14T01:02:03.123456+00:00";

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

test("stale UI handling clears the attempt, reloads, and cannot fall through to success", () => {
  const effects = [];
  let successCount = 0;
  const handled = handleSupplierOrderStaleConflict(
    { ok: false, stale: true, error: "Revise o pedido recarregado." },
    {
      clearAttempt: () => effects.push("clear-attempt"),
      reload: (message) => effects.push(`reload:${message}`),
    },
  );

  if (!handled) successCount += 1;

  assert.equal(handled, true);
  assert.deepEqual(effects, [
    "clear-attempt",
    "reload:Revise o pedido recarregado.",
  ]);
  assert.equal(successCount, 0);
});

test("ordinary failures remain available to the dialog without clearing or reload", () => {
  const effects = [];
  const handled = handleSupplierOrderStaleConflict(
    { ok: false, error: "Corrija os dados." },
    {
      clearAttempt: () => effects.push("clear-attempt"),
      reload: () => effects.push("reload"),
    },
  );

  assert.equal(handled, false);
  assert.deepEqual(effects, []);
});
