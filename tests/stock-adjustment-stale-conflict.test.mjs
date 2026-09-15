import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { adjustInventoryStock } from "../app/(authenticated)/estoque/actions.ts";
import { runStockAdjustmentSubmission } from "../lib/stock-adjustment-stale-conflict.ts";

const userId = "58000000-0000-4000-8000-000000000001";
const itemId = "58000000-0000-4000-8000-000000000002";
const configurationId = "58000000-0000-4000-8000-000000000003";
const idempotencyKey = "58000000-0000-4000-8000-000000000004";
const staleMessage = "O estoque mudou desde que você abriu esta tela.";

const itemTarget = {
  kind: "ITEM",
  itemId,
  code: "NK58-ITEM",
  description: "Item de teste",
  itemType: "LOOSE_PART",
  looseQuantity: 10,
  mountedQuantity: 0,
  minimumStock: 0,
};

const configurationTarget = {
  kind: "CONFIGURATION",
  configurationId,
  commercialCodes: ["NK58-CFG"],
  commercialAliases: [],
  description: "Configuração de teste",
  isActive: true,
  assembledQuantity: 7,
  minimumStock: 0,
  servo: {
    id: itemId,
    code: "NK58-SERVO",
    description: "Servo de teste",
    isActive: true,
    looseQuantity: 10,
  },
  installationKit: {
    id: userId,
    code: "NK58-KIT",
    description: "Kit de teste",
    isActive: true,
    looseQuantity: 10,
  },
};

function createSupabaseClient(calls, rpcError) {
  return {
    auth: {
      async getClaims() {
        return { data: { claims: { sub: userId } }, error: null };
      },
    },
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        async maybeSingle() {
          return {
            data:
              table === "profiles"
                ? { id: userId }
                : table === "items"
                  ? { id: itemId, item_type: "LOOSE_PART" }
                  : { id: configurationId },
            error: null,
          };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: null, error: rpcError };
    },
  };
}

test("the active Server Action requires the displayed balance and calls only checked RPCs", async () => {
  const calls = [];
  globalThis.__nk58RevalidatedPaths = [];
  globalThis.__nk58SupabaseClient = createSupabaseClient(calls, {
    code: "40001",
    message: "stock_adjustment_quantity_conflict",
  });

  const results = await Promise.all([
    adjustInventoryStock({
      target_kind: "ITEM",
      target_id: itemId,
      counted_quantity: 12,
      expected_quantity: 10,
      reason: "Contagem física",
      idempotency_key: idempotencyKey,
    }),
    adjustInventoryStock({
      target_kind: "CONFIGURATION",
      target_id: configurationId,
      counted_quantity: 5,
      expected_quantity: 7,
      reason: "Contagem física",
      idempotency_key: idempotencyKey,
    }),
  ]);

  assert.deepEqual(calls.map(({ name }) => name), [
    "adjust_item_stock_checked",
    "adjust_configuration_stock_checked",
  ]);
  assert.equal(calls[0].args.p_expected_quantity, 10);
  assert.equal(calls[1].args.p_expected_quantity, 7);
  assert.equal(results.every((result) => !result.ok && result.stale), true);
  assert.equal(results.every((result) => result.error === staleMessage), true);
  assert.deepEqual(globalThis.__nk58RevalidatedPaths, []);
});

test("missing, negative, or noninteger expected balances fail before RPC", async () => {
  const calls = [];
  globalThis.__nk58RevalidatedPaths = [];
  globalThis.__nk58SupabaseClient = createSupabaseClient(calls, null);

  for (const expectedQuantity of [undefined, -1, 1.5]) {
    const input = {
      target_kind: "ITEM",
      target_id: itemId,
      counted_quantity: 12,
      reason: "Contagem física",
      idempotency_key: idempotencyKey,
      ...(expectedQuantity === undefined
        ? {}
        : { expected_quantity: expectedQuantity }),
    };
    const result = await adjustInventoryStock(input);
    assert.equal(result.ok, false);
  }

  assert.equal(calls.length, 0);
});

test("InventoryAdjustmentDialog is wired to the behavioral submission transition", () => {
  const source = readFileSync(
    new URL("../components/inventory-action-dialogs.tsx", import.meta.url),
    "utf8",
  );
  const dialog = source.slice(
    source.indexOf("export function InventoryAdjustmentDialog"),
    source.indexOf("export function MinimumStockDialog"),
  );

  assert.match(dialog, /runStockAdjustmentSubmission\(\{/);
  assert.match(dialog, /target,/);
  assert.match(dialog, /closeDialog: onClose,/);
  assert.match(dialog, /isCurrentAttempt:/);
});

test("item and configuration payloads use the balance displayed by their target", async () => {
  const payloads = [];
  for (const target of [itemTarget, configurationTarget]) {
    const outcome = await runStockAdjustmentSubmission({
      target,
      countedQuantity: 4,
      reason: "Contagem física",
      idempotencyKey,
      isCurrentAttempt: () => true,
      execute: async (payload) => {
        payloads.push(payload);
        return { ok: false, error: "Erro comum" };
      },
      clearAttempt: () => undefined,
      closeDialog: () => undefined,
      onStale: () => undefined,
      onError: () => undefined,
      onSuccess: () => undefined,
    });
    assert.equal(outcome, "error");
  }

  assert.equal(payloads[0].target_id, itemId);
  assert.equal(payloads[0].expected_quantity, 10);
  assert.equal(payloads[1].target_id, configurationId);
  assert.equal(payloads[1].expected_quantity, 7);
});

test("stale clears the attempt, closes, identifies the target, reloads once, and never succeeds", async () => {
  const effects = [];
  let executeCount = 0;
  let reloadCount = 0;
  let successCount = 0;
  const outcome = await runStockAdjustmentSubmission({
    target: itemTarget,
    countedQuantity: 12,
    reason: "Contagem física",
    idempotencyKey,
    isCurrentAttempt: () => true,
    execute: async () => {
      executeCount += 1;
      return { ok: false, error: staleMessage, stale: true };
    },
    clearAttempt: () => effects.push("clear-attempt"),
    closeDialog: () => effects.push("close-dialog"),
    onStale: (message, targetId) => {
      effects.push(`message:${message}`);
      effects.push(`reload:${targetId}`);
      reloadCount += 1;
    },
    onError: (message) => effects.push(`error:${message}`),
    onSuccess: () => {
      successCount += 1;
    },
  });

  assert.equal(outcome, "stale");
  assert.equal(executeCount, 1);
  assert.equal(reloadCount, 1);
  assert.equal(successCount, 0);
  assert.deepEqual(effects, [
    "clear-attempt",
    "close-dialog",
    `message:${staleMessage}`,
    `reload:${itemId}`,
  ]);
});

test("failed refresh preserves stale feedback without retry or false success", async () => {
  const effects = [];
  let executeCount = 0;
  const outcome = await runStockAdjustmentSubmission({
    target: configurationTarget,
    countedQuantity: 5,
    reason: "Contagem física",
    idempotencyKey,
    isCurrentAttempt: () => true,
    execute: async () => {
      executeCount += 1;
      return { ok: false, error: staleMessage, stale: true };
    },
    clearAttempt: () => effects.push("clear-attempt"),
    closeDialog: () => effects.push("close-dialog"),
    onStale: async (message, targetId) => {
      effects.push(`message:${message}`);
      effects.push(`reload:${targetId}`);
      throw new Error("refresh failed");
    },
    onError: (message) => effects.push(`error:${message}`),
    onSuccess: () => effects.push("success"),
  });

  assert.equal(outcome, "stale");
  assert.equal(executeCount, 1);
  assert.deepEqual(effects, [
    "clear-attempt",
    "close-dialog",
    `message:${staleMessage}`,
    `reload:${configurationId}`,
  ]);
});

test("a late superseded callback cannot reopen or report success", async () => {
  const effects = [];
  const deferred = [];
  let currentAttempt = 1;

  function runAttempt(attempt) {
    return runStockAdjustmentSubmission({
      target: itemTarget,
      countedQuantity: 12,
      reason: "Contagem física",
      idempotencyKey,
      isCurrentAttempt: () => currentAttempt === attempt,
      execute: () =>
        new Promise((resolve) => {
          deferred[attempt] = resolve;
        }),
      clearAttempt: () => effects.push(`clear:${attempt}`),
      closeDialog: () => effects.push(`close:${attempt}`),
      onStale: (message) => effects.push(`stale:${attempt}:${message}`),
      onError: (message) => effects.push(`error:${attempt}:${message}`),
      onSuccess: () => effects.push(`success:${attempt}`),
    });
  }

  const oldAttempt = runAttempt(1);
  currentAttempt = 2;
  const latestAttempt = runAttempt(2);
  deferred[2]({ ok: false, error: staleMessage, stale: true });
  assert.equal(await latestAttempt, "stale");
  deferred[1]({ ok: true, receipt: {} });
  assert.equal(await oldAttempt, "superseded");
  assert.deepEqual(effects, [
    "clear:2",
    "close:2",
    `stale:2:${staleMessage}`,
  ]);
});
