import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PostgrestClient } from "@supabase/postgrest-js";
import {
  beginSafisaLogicalAttempt,
  canonicalSafisaAttemptPayload,
  markSafisaAttemptResultUnknown,
  restoreSafisaLogicalAttempt,
  serializeSafisaLogicalAttempt,
} from "../lib/safisa-logical-attempt.ts";
import {
  classifySafisaMutationResponse,
  mapSafisaMutationError,
  runSafisaMutation,
} from "../lib/safisa-action-errors.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const portal = read("components/safisa-portal.tsx");
const actions = read("app/safisa/actions.ts");
const migration = read(
  "supabase/migrations/20260807235900_automatic_safisa_order_lifecycle.sql",
);

const orderId = "11111111-1111-4111-8111-111111111111";
const lineId = "22222222-2222-4222-8222-222222222222";

function keyFactory() {
  let sequence = 0;
  return () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

function incrementPayload(overrides = {}) {
  return {
    kind: "INCREMENT_READY_QUANTITY",
    supplierOrderId: orderId,
    supplierOrderItemId: lineId,
    incrementQuantity: 2,
    ...overrides,
  };
}

function createReceiptBackend() {
  let readyQuantity = 0;
  const receipts = new Map();

  return {
    get readyQuantity() {
      return readyQuantity;
    },
    execute(attempt) {
      const existing = receipts.get(attempt.idempotencyKey);
      if (existing) {
        if (existing.canonicalPayload !== attempt.canonicalPayload) {
          throw new Error("idempotency payload conflict");
        }
        return { ...existing.result, idempotentReplay: true };
      }

      readyQuantity += attempt.payload.incrementQuantity;
      const result = { readyQuantity, idempotentReplay: false };
      receipts.set(attempt.idempotencyKey, {
        canonicalPayload: attempt.canonicalPayload,
        result,
      });
      return result;
    },
  };
}

test("commit followed by a lost response retries the same receipt exactly once", () => {
  const nextKey = keyFactory();
  const backend = createReceiptBackend();
  let attempt = beginSafisaLogicalAttempt(null, incrementPayload(), nextKey);

  backend.execute(attempt);
  attempt = markSafisaAttemptResultUnknown(attempt);

  const retry = beginSafisaLogicalAttempt(attempt, incrementPayload(), nextKey);
  const result = backend.execute(retry);

  assert.equal(retry.idempotencyKey, attempt.idempotencyKey);
  assert.equal(result.idempotentReplay, true);
  assert.equal(backend.readyQuantity, 2);
});

test("postgrest status 0 after commit stays unknown and retries the same receipt", async () => {
  const nextKey = keyFactory();
  const backend = createReceiptBackend();
  let attempt = beginSafisaLogicalAttempt(null, incrementPayload(), nextKey);

  backend.execute(attempt);
  const postgrest = new PostgrestClient("https://example.test/rest/v1", {
    fetch: async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
      });
    },
  });
  const transportResponse = await postgrest.rpc("increment_safisa_ready_quantity", {
    p_supplier_order_item_id: lineId,
    p_increment_quantity: 2,
    p_idempotency_key: attempt.idempotencyKey,
  });

  assert.equal(transportResponse.status, 0);
  assert.equal(transportResponse.statusText, "");
  assert.equal(transportResponse.error?.code, "");

  const actionResult = await runSafisaMutation(() =>
    Promise.resolve(transportResponse),
  );

  assert.equal(actionResult?.status, "unknown");
  attempt = markSafisaAttemptResultUnknown(attempt);

  const retry = beginSafisaLogicalAttempt(attempt, incrementPayload(), nextKey);
  const replay = backend.execute(retry);

  assert.equal(retry.idempotencyKey, attempt.idempotencyKey);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(backend.readyQuantity, 2);
});

test("a timeout or transport failure before commit preserves the key until retry", () => {
  const nextKey = keyFactory();
  const backend = createReceiptBackend();
  const first = beginSafisaLogicalAttempt(null, incrementPayload(), nextKey);
  const unknown = markSafisaAttemptResultUnknown(first);
  const retry = beginSafisaLogicalAttempt(unknown, incrementPayload(), nextKey);

  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.equal(backend.execute(retry).idempotentReplay, false);
  assert.equal(backend.readyQuantity, 2);
});

test("canonical payload identity is stable across property order", () => {
  const payload = incrementPayload();
  const reordered = {
    incrementQuantity: 2,
    supplierOrderItemId: lineId,
    supplierOrderId: orderId,
    kind: "INCREMENT_READY_QUANTITY",
  };

  assert.equal(
    canonicalSafisaAttemptPayload(payload),
    canonicalSafisaAttemptPayload(reordered),
  );
});

test("an unknown attempt survives reopening the portal in validated local storage form", () => {
  const attempt = markSafisaAttemptResultUnknown(
    beginSafisaLogicalAttempt(null, incrementPayload(), keyFactory()),
  );
  const restored = restoreSafisaLogicalAttempt(serializeSafisaLogicalAttempt(attempt));

  assert.deepEqual(restored, attempt);
  assert.equal(restoreSafisaLogicalAttempt("not-json"), null);
  assert.match(portal, /localStorage\.setItem/);
  assert.match(portal, /localStorage\.getItem/);
});

test("a submitting attempt restores as unknown if the page unloads mid-request", () => {
  const submitting = beginSafisaLogicalAttempt(null, incrementPayload(), keyFactory());
  const restored = restoreSafisaLogicalAttempt(serializeSafisaLogicalAttempt(submitting));

  assert.equal(restored.idempotencyKey, submitting.idempotencyKey);
  assert.equal(restored.state, "RESULT_UNKNOWN");
  assert.match(portal, /persistAttempt\(attempt\)/);
});

test("double submit of one pending intention keeps one logical key", () => {
  const nextKey = keyFactory();
  const first = beginSafisaLogicalAttempt(null, incrementPayload(), nextKey);
  const second = beginSafisaLogicalAttempt(first, incrementPayload(), nextKey);

  assert.equal(second.idempotencyKey, first.idempotencyKey);
  assert.match(portal, /if \(isPending \|\| operationLock\.current\) return/);
});

test("changed quantity, changed item, and a new completed intention receive new keys", () => {
  const nextKey = keyFactory();
  const first = beginSafisaLogicalAttempt(null, incrementPayload(), nextKey);
  const changedQuantity = beginSafisaLogicalAttempt(
    markSafisaAttemptResultUnknown(first),
    incrementPayload({ incrementQuantity: 3 }),
    nextKey,
  );
  const changedItem = beginSafisaLogicalAttempt(
    markSafisaAttemptResultUnknown(changedQuantity),
    incrementPayload({ supplierOrderItemId: "33333333-3333-4333-8333-333333333333" }),
    nextKey,
  );
  const newIntention = beginSafisaLogicalAttempt(null, incrementPayload(), nextKey);

  assert.notEqual(changedQuantity.idempotencyKey, first.idempotencyKey);
  assert.notEqual(changedItem.idempotencyKey, changedQuantity.idempotencyKey);
  assert.notEqual(newIntention.idempotencyKey, first.idempotencyKey);
});

test("authoritative validation, membership, session, and idempotency errors end as rejections", () => {
  assert.equal(mapSafisaMutationError({ code: "22023" }).status, "error");
  assert.equal(mapSafisaMutationError({ code: "42501" }).status, "error");
  assert.equal(mapSafisaMutationError({ code: "28000" }).status, "error");
  assert.equal(
    mapSafisaMutationError({
      code: "22023",
      message: "p_idempotency_key has already been used with a different Safisa portal request.",
    }).status,
    "conflict",
  );
});

test("real PostgREST response shapes separate authoritative errors from unknown outcomes", async () => {
  const abortedPostgrest = new PostgrestClient("https://example.test/rest/v1", {
    fetch: async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    },
  });
  const abortedResponse = await abortedPostgrest.rpc("probe_rpc", { value: 1 });

  assert.equal(abortedResponse.status, 0);
  assert.equal(abortedResponse.statusText, "");
  assert.equal(
    classifySafisaMutationResponse(abortedResponse)?.status,
    "unknown",
  );
  assert.equal(
    classifySafisaMutationResponse({
      error: { code: "22023", message: "invalid quantity" },
      status: 400,
      statusText: "Bad Request",
    })?.status,
    "error",
  );
  assert.equal(
    classifySafisaMutationResponse({
      error: { code: "42501", message: "permission denied" },
      status: 403,
      statusText: "Forbidden",
    })?.status,
    "error",
  );
  assert.equal(
    classifySafisaMutationResponse({
      error: { code: "40001", message: "version_conflict" },
      status: 500,
      statusText: "Internal Server Error",
    })?.status,
    "conflict",
  );
  assert.equal(
    classifySafisaMutationResponse({
      error: { code: "22023", message: "must not be trusted with status zero" },
      status: 0,
      statusText: "",
    })?.status,
    "unknown",
  );
  assert.equal(
    classifySafisaMutationResponse({
      error: { message: "upstream unavailable" },
      status: 503,
      statusText: "Service Unavailable",
    })?.status,
    "unknown",
  );
  assert.equal(
    classifySafisaMutationResponse({
      error: { message: "request timeout" },
      status: 408,
      statusText: "Request Timeout",
    })?.status,
    "unknown",
  );
  assert.equal(
    (
      await runSafisaMutation(() =>
        Promise.reject(new TypeError("fetch failed")),
      )
    )?.status,
    "unknown",
  );
});

test("a rejected retry does not pretend to resolve an already unknown attempt", () => {
  assert.match(portal, /retryingUnknownAttempt && result\.status !== "success"/);
  assert.match(portal, /O resultado anterior continua sem confirmação/);
});

test("client and server distinguish an unknown transport outcome from rejection", () => {
  assert.match(actions, /import \{ runSafisaMutation \}/);
  assert.match(portal, /result\.status === "unknown"/);
  assert.match(portal, /Tentar verificar novamente/);
  assert.doesNotMatch(portal, /status: "error"[\s\S]{0,120}Verifique sua conexão e tente novamente/);
});

test("line completion resends the original delta and the RPC resolves receipts first", () => {
  const section = actions.slice(
    actions.indexOf("export async function markSafisaRemainingReady"),
    actions.indexOf("export async function markSafisaOrderRemainingReady"),
  );
  assert.match(section, /p_increment_quantity: input\.incrementQuantity/);
  assert.doesNotMatch(section, /line\.waitingReadyQuantity/);
  assert.ok(
    migration.indexOf("private.safisa_portal_existing_result") <
      migration.indexOf("v_new_quantity_bigint :="),
  );
});

test("normal operation remains a single mutation with the existing mobile controls", () => {
  const nextKey = keyFactory();
  const backend = createReceiptBackend();
  const attempt = beginSafisaLogicalAttempt(null, incrementPayload(), nextKey);

  assert.equal(backend.execute(attempt).idempotentReplay, false);
  assert.equal(backend.readyQuantity, 2);
  assert.match(portal, /min-h-11/);
  assert.match(portal, /inputMode="numeric"/);
});
