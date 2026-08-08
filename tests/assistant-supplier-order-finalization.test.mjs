import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { routeSupplierOrderFinalizationAction } from "../lib/ai/supplier-order-finalization-routing.ts";
import {
  createSupplierOrderFinalizationProposalToken,
  verifySupplierOrderFinalizationProposalToken,
} from "../lib/ai/supplier-order-finalization-action-token.ts";
import {
  supplierOrderCanBeFinalized,
  supplierOrderFinalizationProfileHasName,
} from "../lib/ai/supplier-order-finalization-contract.ts";
import { handleStockEntryActionRequest } from "../lib/ai/stock-entry-http-contract.ts";
import { expireSupplierOrderFinalizationPreview } from "../lib/ai/assistant-action-persistence.ts";

const secret = "local-test-secret-with-at-least-thirty-two-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-08-08T12:00:00.000Z");

function order(overrides = {}) {
  return {
    id: orderId, negotiationNumber: "1212", orderDate: "2026-08-08", notes: null,
    createdByName: "Henrique", createdAt: now.toISOString(), updatedAt: "2026-08-08T12:00:00.123456+00:00",
    cancelledAt: null, cancelledByName: null, cancellationNote: null, finalizedAt: null,
    finalizedByName: null, finalizationNote: null, isFinalized: false, isActiveOrder: true,
    isInHistory: false, closureKind: null, closedAt: null, closedByName: null, lineCount: 1,
    orderedQuantity: 5, readyQuantity: 5, pickedQuantity: 5, cancelledQuantity: 0,
    waitingPickupQuantity: 0, waitingReadyQuantity: 0, readyWaitingPickupQuantity: 0,
    stockedQuantity: 0, waitingStockQuantity: 5, pickupPercentage: 100, status: "COMPLETED", ...overrides,
  };
}

function card() {
  return { id: orderId, negotiationNumber: "1212", orderDate: "2026-08-08", status: "COMPLETED",
    closureKind: null, lineCount: 1, orderedQuantity: 5, pickedQuantity: 5, waitingPickupQuantity: 0,
    stockedQuantity: 0, waitingStockQuantity: 5, href: `/pedidos?view=active&order=${orderId}` };
}

test("roteia somente comandos explícitos de finalização", () => {
  for (const phrase of ["finalize o pedido 1212", "finalizar pedido 40971", "pode encerrar o pedido 1212", "concluir o pedido PED-104"]) {
    const route = routeSupplierOrderFinalizationAction(phrase);
    assert.equal(route.kind, "ACTION", phrase);
  }
  assert.equal(routeSupplierOrderFinalizationAction("Retire 1 do Pedido 1212").kind, "NOT_FINALIZATION");
  assert.equal(routeSupplierOrderFinalizationAction("Cancele o pedido 1212").kind, "NOT_FINALIZATION");
  assert.equal(routeSupplierOrderFinalizationAction("sim").kind, "BUTTON_CONFIRMATION_TEXT");
  assert.equal(routeSupplierOrderFinalizationAction("Cancele esta finalização").kind, "CANCEL");
});

test("token é estrito, assinado, vinculado e preserva microssegundos", () => {
  const signed = createSupplierOrderFinalizationProposalToken({ userId, supplierOrderId: orderId,
    expectedUpdatedAt: "2026-08-08T12:00:00.123456+00:00", idempotencyKey: key }, secret, now);
  assert.ok(signed);
  assert.equal(signed.payload.action, "supplier_order_finalization");
  assert.equal(signed.payload.expectedUpdatedAt, "2026-08-08T12:00:00.123456+00:00");
  assert.equal(verifySupplierOrderFinalizationProposalToken(signed.token, secret, userId, now).ok, true);
  assert.equal(verifySupplierOrderFinalizationProposalToken(signed.token, secret, orderId, now).reason, "user_mismatch");
  assert.equal(verifySupplierOrderFinalizationProposalToken(`${signed.token}x`, secret, userId, now).reason, "invalid");
  assert.equal(verifySupplierOrderFinalizationProposalToken(signed.token, secret, userId, new Date(now.getTime() + 601_000)).reason, "expired");
});

test("contrato oficial permite somente Pedido concluído sem retirada pendente", () => {
  assert.equal(supplierOrderCanBeFinalized(order()), true);
  assert.equal(supplierOrderCanBeFinalized(order({ waitingPickupQuantity: 1 })), false);
  assert.equal(supplierOrderCanBeFinalized(order({ status: "PARTIAL" })), false);
  assert.equal(supplierOrderCanBeFinalized(order({ isFinalized: true, closureKind: "FINALIZED", isActiveOrder: false })), false);
  assert.equal(supplierOrderCanBeFinalized(order({ status: "CANCELLED", cancelledAt: now.toISOString(), closureKind: "CANCELLED", isActiveOrder: false })), false);
  assert.equal(supplierOrderFinalizationProfileHasName("Henrique"), true);
  assert.equal(supplierOrderFinalizationProfileHasName("   "), false);
});

test("endpoint só aceita token, mesma origem e confirma uma vez", async () => {
  let confirms = 0;
  const valid = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/supplier-order-finalization", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def" }),
  }), { confirm: async () => { confirms += 1; return { block: { outcome: "success" } }; },
    revalidate: () => {}, isSuccess: (result) => result.block.outcome === "success", addRefreshWarning: (result) => result,
    fallback: () => ({ block: { outcome: "error" } }) });
  assert.equal(valid.status, 200);
  assert.equal(confirms, 1);
  const freePayload = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/supplier-order-finalization", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def", rpcName: "finalize_supplier_order", supplierOrderId: orderId }),
  }), { confirm: async () => { confirms += 1; return {}; }, revalidate: () => {}, isSuccess: () => false,
    addRefreshWarning: (result) => result, fallback: () => ({}) });
  assert.equal(freePayload.status, 400);
  assert.equal(confirms, 1);
  const crossOrigin = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/supplier-order-finalization", {
    method: "POST", headers: { Origin: "https://other.local", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def" }),
  }), { confirm: async () => { confirms += 1; return {}; }, revalidate: () => {}, isSuccess: () => false,
    addRefreshWarning: (result) => result, fallback: () => ({}) });
  assert.equal(crossOrigin.status, 403);
  assert.equal(confirms, 1);
});

test("prévia persistida expira e o contrato usa somente a RPC fixa", async () => {
  const preview = { kind: "supplier_order_finalization_preview", action: "supplier_order_finalization", state: "pending",
    title: "Finalizar Pedido", message: "Revalidar antes de finalizar.", proposalToken: "abc.def", expiresAt: now.toISOString(), order: card(),
    confirmLabel: "Confirmar finalização", cancelLabel: "Cancelar", regeneratePrompt: "Finalize o Pedido 1212." };
  const expired = expireSupplierOrderFinalizationPreview(preview);
  assert.equal(expired.state, "expired");
  assert.equal(expired.proposalToken, null);
  const implementation = await readFile(new URL("../lib/assistant-supplier-order-finalization.ts", import.meta.url), "utf8");
  assert.match(implementation, /finalizeSupplierOrder\(/);
  assert.match(implementation, /finalization_note: null/);
  assert.doesNotMatch(implementation, /\.rpc\(\s*["']finalize_supplier_order/);
});
