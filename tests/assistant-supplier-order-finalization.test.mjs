import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createSupplierOrderFinalizationProposalToken,
  verifySupplierOrderFinalizationProposalToken,
} from "../lib/ai/supplier-order-finalization-action-token.ts";
import { expireSupplierOrderFinalizationPreview } from "../lib/ai/assistant-action-persistence.ts";
import { createSupplierOrderFinalizationOperations } from "../lib/ai/supplier-order-finalization-service.ts";
import {
  supplierOrderCanBeFinalized,
  supplierOrderFinalizationProfileHasName,
} from "../lib/ai/supplier-order-finalization-contract.ts";
import { routeSupplierOrderFinalizationAction } from "../lib/ai/supplier-order-finalization-routing.ts";
import { handleStockEntryActionRequest } from "../lib/ai/stock-entry-http-contract.ts";

const secret = "local-test-secret-with-at-least-thirty-two-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const otherOrderId = "44444444-4444-4444-8444-444444444444";
const key = "55555555-5555-4555-8555-555555555555";
const now = new Date("2026-08-08T12:00:00.000Z");

function order(overrides = {}) {
  return {
    id: orderId,
    negotiationNumber: "1212",
    orderDate: "2026-08-08",
    notes: null,
    createdByName: "Henrique",
    createdAt: now.toISOString(),
    updatedAt: "2026-08-08T12:00:00.123456+00:00",
    cancelledAt: null,
    cancelledByName: null,
    cancellationNote: null,
    finalizedAt: null,
    finalizedByName: null,
    finalizationNote: null,
    isFinalized: false,
    isActiveOrder: true,
    isInHistory: false,
    closureKind: null,
    closedAt: null,
    closedByName: null,
    lineCount: 1,
    orderedQuantity: 5,
    readyQuantity: 5,
    pickedQuantity: 5,
    cancelledQuantity: 0,
    waitingPickupQuantity: 0,
    waitingReadyQuantity: 0,
    readyWaitingPickupQuantity: 0,
    stockedQuantity: 0,
    waitingStockQuantity: 5,
    pickupPercentage: 100,
    status: "COMPLETED",
    ...overrides,
  };
}

function finalOrder(overrides = {}) {
  return order({
    finalizedAt: "2026-08-08T12:01:00.000Z",
    finalizedByName: "Henrique",
    isFinalized: true,
    isActiveOrder: false,
    isInHistory: true,
    closureKind: "FINALIZED",
    closedAt: "2026-08-08T12:01:00.000Z",
    closedByName: "Henrique",
    ...overrides,
  });
}

function createRuntime(overrides = {}) {
  const calls = [];
  let loadByIdCalls = 0;
  const state = {
    orders: [order()],
    currentOrder: order(),
    refreshedOrder: finalOrder(),
    profile: { userId, profileName: "Henrique" },
    hasFinalizationEvent: false,
    finalizationResult: { ok: true, receipt: { negotiationNumber: "1212" } },
    ...overrides,
  };
  const operations = createSupplierOrderFinalizationOperations({
    createIdempotencyKey: () => key,
    createProposal: (input) => createSupplierOrderFinalizationProposalToken(
      input,
      state.secret ?? secret,
      now,
    ),
    verifyProposal: (proposalToken, expectedUserId) => verifySupplierOrderFinalizationProposalToken(
      proposalToken,
      state.secret ?? secret,
      expectedUserId,
      now,
    ),
    profileHasName: supplierOrderFinalizationProfileHasName,
    isOrderEligible: supplierOrderCanBeFinalized,
    loadOrdersByNegotiation: async () => ({ failed: false, orders: state.orders }),
    loadOrderById: async () => {
      loadByIdCalls += 1;
      return {
        failed: false,
        order: loadByIdCalls === 1 ? state.currentOrder : state.refreshedOrder,
      };
    },
    getActiveProfile: async () => state.profile,
    hasFinalizationEvent: async () => state.hasFinalizationEvent,
    finalize: async (input) => {
      calls.push(input);
      if (state.finalizationError) throw state.finalizationError;
      return state.finalizationResult;
    },
  });
  return { calls, operations, state };
}

async function createPreview(runtime, negotiationNumber = "1212") {
  const response = await runtime.operations.createPreview(
    { negotiationNumber },
    { userId, profileName: "Henrique" },
  );
  assert.equal(response.structuredBlock?.kind, "supplier_order_finalization_preview");
  return response.structuredBlock;
}

function signRawPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
  return `${encoded}.${signature}`;
}

test("roteia somente frases explícitas de finalização e texto nunca confirma", () => {
  for (const phrase of [
    "finalize o pedido 1212",
    "FINALIZAR PEDIDO 40971!",
    "pode encerrar o pedido 1212?",
    "concluir o pedido PED-104.",
  ]) {
    const route = routeSupplierOrderFinalizationAction(phrase);
    assert.equal(route.kind, "ACTION", phrase);
  }

  for (const phrase of [
    "Retire 1 do Pedido 1212",
    "Dê entrada no Pedido 1212",
    "Cancele o Pedido 1212",
    "Exclua o Pedido 1212",
    "Monte o código 1H",
    "Desmonte o código 1H",
    "Retirar tudo que está pronto do Pedido 1212",
  ]) {
    assert.equal(routeSupplierOrderFinalizationAction(phrase).kind, "NOT_FINALIZATION", phrase);
  }

  for (const phrase of ["sim", "confirmar", "pode finalizar"]) {
    assert.equal(routeSupplierOrderFinalizationAction(phrase).kind, "BUTTON_CONFIRMATION_TEXT", phrase);
  }
});

test("a resolução server-side exige uma única negociação exata", async () => {
  const missing = createRuntime({ orders: [] });
  const missingResult = await missing.operations.createPreview({ negotiationNumber: "1212" }, { userId, profileName: "Henrique" });
  assert.equal(missingResult.structuredBlock?.title, "Pedido não encontrado");

  const ambiguous = createRuntime({ orders: [order(), order({ id: otherOrderId })] });
  const ambiguousResult = await ambiguous.operations.createPreview({ negotiationNumber: "1212" }, { userId, profileName: "Henrique" });
  assert.equal(ambiguousResult.structuredBlock?.title, "Pedido ambíguo");

  const exact = createRuntime();
  const preview = await createPreview(exact);
  assert.equal(preview.order.id, orderId);
  assert.equal(preview.order.negotiationNumber, "1212");
});

test("a prévia elegível contém somente dados oficiais e token vinculado", async () => {
  const runtime = createRuntime();
  const preview = await createPreview(runtime);
  const verified = verifySupplierOrderFinalizationProposalToken(preview.proposalToken, secret, userId, now);

  assert.equal(preview.confirmLabel, "Confirmar finalização");
  assert.equal(preview.cancelLabel, "Cancelar");
  assert.equal(preview.order.orderedQuantity, 5);
  assert.equal(preview.order.pickedQuantity, 5);
  assert.equal(preview.order.waitingPickupQuantity, 0);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.supplierOrderId, orderId);
  assert.equal(verified.payload.expectedUpdatedAt, "2026-08-08T12:00:00.123456+00:00");
  assert.equal(verified.payload.idempotencyKey, key);
  assert.equal(verified.payload.userId, userId);
  assert.ok(Date.parse(preview.expiresAt) > now.getTime());
  assert.equal(runtime.calls.length, 0);
});

test("estados inelegíveis e perfis inválidos nunca chamam a finalização", async () => {
  for (const candidate of [
    finalOrder(),
    order({ cancelledAt: now.toISOString(), status: "CANCELLED", closureKind: "CANCELLED", isActiveOrder: false }),
    order({ status: "PARTIAL", waitingPickupQuantity: 1 }),
    order({ status: "PENDING", pickedQuantity: 0, waitingPickupQuantity: 5 }),
    order({ waitingPickupQuantity: 1 }),
  ]) {
    const runtime = createRuntime({ orders: [candidate] });
    const result = await runtime.operations.createPreview({ negotiationNumber: "1212" }, { userId, profileName: "Henrique" });
    assert.equal(result.structuredBlock?.kind, "supplier_order_finalization_result");
    assert.equal(runtime.calls.length, 0);
  }

  for (const context of [
    { userId: "not-a-uuid", profileName: "Henrique" },
    { userId, profileName: "   " },
  ]) {
    const runtime = createRuntime();
    const result = await runtime.operations.createPreview({ negotiationNumber: "1212" }, context);
    assert.equal(result.structuredBlock?.title, "Perfil incompleto");
    assert.equal(runtime.calls.length, 0);
  }
});

test("o token rejeita adulteração, ação diferente, campos extras, usuário e secret inválido", () => {
  const created = createSupplierOrderFinalizationProposalToken({
    userId,
    supplierOrderId: orderId,
    expectedUpdatedAt: "2026-08-08T12:00:00.123456+00:00",
    idempotencyKey: key,
  }, secret, now);
  assert.ok(created);
  assert.equal(verifySupplierOrderFinalizationProposalToken(created.token, secret, userId, now).ok, true);
  assert.equal(verifySupplierOrderFinalizationProposalToken(`${created.token}x`, secret, userId, now).reason, "invalid");
  assert.equal(verifySupplierOrderFinalizationProposalToken(created.token, secret, otherUserId, now).reason, "user_mismatch");
  assert.equal(verifySupplierOrderFinalizationProposalToken(created.token, secret, userId, new Date(now.getTime() + 601_000)).reason, "expired");
  assert.equal(createSupplierOrderFinalizationProposalToken({ userId, supplierOrderId: orderId, expectedUpdatedAt: now.toISOString(), idempotencyKey: key }, "too-short", now), null);

  const decoded = JSON.parse(Buffer.from(created.token.split(".")[0], "base64url").toString("utf8"));
  assert.equal(verifySupplierOrderFinalizationProposalToken(signRawPayload({ ...decoded, action: "manual_stock_entry" }), secret, userId, now).reason, "invalid");
  assert.equal(verifySupplierOrderFinalizationProposalToken(signRawPayload({ ...decoded, unexpected: true }), secret, userId, now).reason, "invalid");
  assert.equal(verifySupplierOrderFinalizationProposalToken(signRawPayload({ ...decoded, supplierOrderId: otherOrderId }), secret, userId, now).ok, true);
  assert.equal(verifySupplierOrderFinalizationProposalToken(`${created.token.split(".")[0]}.invalid`, secret, userId, now).reason, "invalid");
});

test("o endpoint fixo aceita somente POST same-origin com proposalToken", async () => {
  let calls = 0;
  const dependencies = {
    confirm: async () => { calls += 1; return { block: { outcome: "success" } }; },
    revalidate: () => {},
    isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: (result) => result,
    fallback: () => ({ block: { outcome: "error" } }),
  };
  const request = (headers, body) => new Request("https://nk.local/api/assistant/actions/supplier-order-finalization", {
    method: "POST", headers, body,
  });

  const valid = await handleStockEntryActionRequest(request({ Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, JSON.stringify({ proposalToken: "abc.def" })), dependencies);
  assert.equal(valid.status, 200);
  assert.equal(calls, 1);

  for (const invalid of [
    request({ Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, JSON.stringify({ proposalToken: "abc.def" })),
    request({ Origin: "https://nk.local", "Content-Type": "text/plain" }, JSON.stringify({ proposalToken: "abc.def" })),
    request({ Origin: "https://nk.local", "Content-Type": "application/json" }, "{"),
    request({ Origin: "https://nk.local", "Content-Type": "application/json" }, JSON.stringify({ proposalToken: "abc.def", rpcName: "finalize_supplier_order" })),
    request({ Origin: "https://nk.local", "Content-Type": "application/json" }, JSON.stringify({ proposalToken: "abc.def", table: "supplier_orders", sql: "update" })),
  ]) {
    assert.ok((await handleStockEntryActionRequest(invalid, dependencies)).status >= 400);
  }
  assert.equal(calls, 1);
});

test("a confirmação usa somente os campos oficiais do token e produz receipt real", async () => {
  const runtime = createRuntime();
  const preview = await createPreview(runtime);
  const result = await runtime.operations.confirm(preview.proposalToken);

  assert.equal(runtime.calls.length, 1);
  assert.deepEqual(runtime.calls[0], {
    supplier_order_id: orderId,
    expected_updated_at: "2026-08-08T12:00:00.123456+00:00",
    finalization_note: null,
    idempotency_key: key,
  });
  assert.equal(result.block.outcome, "success");
  assert.equal(result.block.order?.negotiationNumber, "1212");
  assert.equal(result.block.occurredAt, "2026-08-08T12:01:00.000Z");
  assert.equal(result.block.idempotentReplay, false);
});

test("releitura bloqueia versão/retirada incompatível e finalização concorrente sem segunda ação", async () => {
  const changed = createRuntime({ currentOrder: order({ updatedAt: "2026-08-08T12:00:01.000000+00:00" }) });
  const changedPreview = await createPreview(changed);
  const changedResult = await changed.operations.confirm(changedPreview.proposalToken);
  assert.equal(changedResult.block.outcome, "conflict");
  assert.equal(changed.calls.length, 0);

  const pickedDuringPreview = createRuntime({ currentOrder: order({ status: "PARTIAL", waitingPickupQuantity: 1 }) });
  const pickedPreview = await createPreview(pickedDuringPreview);
  const pickedResult = await pickedDuringPreview.operations.confirm(pickedPreview.proposalToken);
  assert.equal(pickedResult.block.outcome, "conflict");
  assert.equal(pickedDuringPreview.calls.length, 0);

  const finalizedElsewhere = createRuntime({ currentOrder: finalOrder() });
  const finalizedPreview = await createPreview(finalizedElsewhere);
  const finalizedResult = await finalizedElsewhere.operations.confirm(finalizedPreview.proposalToken);
  assert.equal(finalizedResult.block.title, "Pedido já finalizado");
  assert.equal(finalizedElsewhere.calls.length, 0);
});

test("retry com o mesmo token preserva a chave e resultado idempotente; conflitos são seguros", async () => {
  const replay = createRuntime({ currentOrder: finalOrder(), refreshedOrder: finalOrder(), hasFinalizationEvent: true });
  const preview = await createPreview(replay);
  const first = await replay.operations.confirm(preview.proposalToken);
  const second = await replay.operations.confirm(preview.proposalToken);
  assert.equal(first.block.outcome, "success");
  assert.equal(second.block.outcome, "success");
  assert.equal(second.block.idempotentReplay, true);
  assert.equal(replay.calls.length, 2);
  assert.equal(replay.calls[0].idempotency_key, replay.calls[1].idempotency_key);

  const incompatibleKey = createRuntime({ finalizationResult: { ok: false, error: "Esta tentativa já foi usada com dados incompatíveis." } });
  const incompatiblePreview = await createPreview(incompatibleKey);
  const incompatibleResult = await incompatibleKey.operations.confirm(incompatiblePreview.proposalToken);
  assert.equal(incompatibleResult.block.outcome, "error");
  assert.equal(incompatibleResult.block.message, "Esta tentativa já foi usada com dados incompatíveis.");
});

test("falha inesperada e releitura falha preservam mensagens seguras", async () => {
  const failed = createRuntime({ finalizationError: new Error("SQLSTATE 99999" ) });
  const failedPreview = await createPreview(failed);
  const failedResult = await failed.operations.confirm(failedPreview.proposalToken);
  assert.equal(failedResult.block.outcome, "error");
  assert.doesNotMatch(failedResult.block.message, /sql|stack|99999/i);

  const stale = createRuntime({ finalizationResult: { ok: false, stale: true, error: "Pedido alterado por outro usuário." } });
  const stalePreview = await createPreview(stale);
  const staleResult = await stale.operations.confirm(stalePreview.proposalToken);
  assert.equal(staleResult.block.outcome, "conflict");

  const refreshFailure = createRuntime({ refreshedOrder: null });
  const refreshPreview = await createPreview(refreshFailure);
  const refreshResult = await refreshFailure.operations.confirm(refreshPreview.proposalToken);
  assert.equal(refreshResult.block.outcome, "success");
  assert.equal(refreshResult.block.refreshWarning, true);
});

test("prévia persistida expira e perde o token operacional", () => {
  const expired = expireSupplierOrderFinalizationPreview({
    kind: "supplier_order_finalization_preview",
    action: "supplier_order_finalization",
    state: "pending",
    title: "Finalizar Pedido",
    message: "Revalidar antes de finalizar.",
    proposalToken: "abc.def",
    expiresAt: now.toISOString(),
    order: {
      id: orderId,
      negotiationNumber: "1212",
      orderDate: "2026-08-08",
      status: "COMPLETED",
      closureKind: null,
      lineCount: 1,
      orderedQuantity: 5,
      pickedQuantity: 5,
      waitingPickupQuantity: 0,
      stockedQuantity: 0,
      waitingStockQuantity: 5,
      href: "/pedidos",
    },
    confirmLabel: "Confirmar finalização",
    cancelLabel: "Cancelar",
    regeneratePrompt: "Finalize o Pedido 1212.",
  });
  assert.equal(expired.state, "expired");
  assert.equal(expired.proposalToken, null);
  assert.equal(expired.expiresAt, null);
});
