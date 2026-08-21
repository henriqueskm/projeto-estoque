import assert from "node:assert/strict";
import test from "node:test";

import {
  createManualStockOutputIdentitySelection,
  routeManualStockOutputAction,
} from "../lib/ai/manual-stock-output-routing.ts";
import {
  createManualStockOutputProposalToken,
  verifyManualStockOutputProposalToken,
} from "../lib/ai/manual-stock-output-action-token.ts";
import {
  createManualStockEntryProposalToken,
} from "../lib/ai/stock-entry-action-tokens.ts";
import { routeSupplierOrderPickupAction } from "../lib/ai/supplier-order-pickup-routing.ts";
import {
  handleStockEntryActionRequest,
  parseStockEntryActionBody,
  stockEntryRequestIsSameOrigin,
} from "../lib/ai/stock-entry-http-contract.ts";
import {
  ASSISTANT_MANUAL_STOCK_OUTPUT_DESCRIPTION,
  calculateManualStockOutputProjection,
  manualStockOutputProfileHasName,
} from "../lib/ai/manual-stock-output-contract.ts";
import { expireStockEntryPreview } from "../lib/ai/assistant-action-persistence.ts";

const secret = "local-test-secret-with-at-least-thirty-two-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const codeId = "33333333-3333-4333-8333-333333333333";
const key = "77777777-7777-4777-8777-777777777777";
const now = new Date("2026-08-01T12:00:00.000Z");

test("roteia saídas manuais determinísticas", () => {
  const cases = [
    ["Retire 3 unidades do MBF-015 sem kit.", "ITEM", "MBF-015", 3],
    ["Tire 2 unidades do Cód. 1H.", null, "1H", 2],
    ["Dê saída em 4 unidades do KT-29 no Estoque.", null, "KT-29", 4],
    ["Dê baixa em 5 unidades da peça R064.", "ITEM", "R064", 5],
    ["Remova 1 unidade do Servo com kit Cód. 1H.", "COMMERCIAL_CODE", "1H", 1],
  ];
  for (const [phrase, identity, query, quantity] of cases) {
    const result = routeManualStockOutputAction(phrase);
    assert.equal(result.kind, "ACTION", phrase);
    assert.equal(result.request.requestedIdentity, identity, phrase);
    assert.equal(result.request.targetQuery, query, phrase);
    assert.equal(result.request.quantity, quantity, phrase);
  }
});

test("atalho de saída manual não cai na retirada por Pedido", () => {
  assert.equal(
    routeManualStockOutputAction("Dê saída manual.").kind,
    "INVALID",
  );
  assert.equal(
    routeSupplierOrderPickupAction("Dê saída manual.").kind,
    "NOT_PICKUP_ACTION",
  );
});

test("remove qualificadores singulares e plurais antes de resolver Servo com kit", () => {
  const cases = [
    ["Tire 5 Servos com kit Cód. 1H do Estoque.", 5],
    ["Tire 5 Servo com kit Cód. 1H do Estoque.", 5],
    ["Tire 5 Servos com kit, 1H do Estoque.", 5],
    ["Retire 2 unidades do Servo com kit Cód. 1H.", 2],
    ["Dê saída em 3 Servos com kit código 1H.", 3],
    ["Baixe 1 Servo com kit 1H.", 1],
  ];

  for (const [phrase, quantity] of cases) {
    const result = routeManualStockOutputAction(phrase);
    assert.equal(result.kind, "ACTION", phrase);
    assert.equal(result.request.requestedIdentity, "COMMERCIAL_CODE", phrase);
    assert.equal(result.request.targetQuery, "1H", phrase);
    assert.equal(result.request.quantity, quantity, phrase);
  }
});

test("preserva saída manual simples por código", () => {
  const result = routeManualStockOutputAction("Retire 1 do 1H do Estoque.");
  assert.equal(result.kind, "ACTION");
  assert.equal(result.request.requestedIdentity, null);
  assert.equal(result.request.targetQuery, "1H");
  assert.equal(result.request.quantity, 1);
});

test("não intercepta retirada vinculada a Pedido", () => {
  assert.equal(routeManualStockOutputAction("Retire 1 do 1H no Pedido Teste 04.").kind, "NOT_MANUAL_STOCK_OUTPUT");
});

test("modelo sem qualificador exige esclarecimento", () => {
  const result = routeManualStockOutputAction("Retire 2 unidades do MBF015.");
  assert.equal(result.kind, "AMBIGUOUS_TARGET");
  assert.equal(result.quantity, 2);
  assert.equal(result.targetQuery, "MBF015");
});

test("qualificadores com e sem kit restringem a identidade", () => {
  assert.equal(routeManualStockOutputAction("Baixe 2 MBF015 sem kit.").request.requestedIdentity, "ITEM");
  assert.equal(routeManualStockOutputAction("Baixe 2 MBF015 com kit.").request.requestedIdentity, "COMMERCIAL_CODE");
});

test("quantidades inválidas são rejeitadas", () => {
  assert.equal(routeManualStockOutputAction("Retire 0 unidades do 1H.").kind, "INVALID");
  assert.equal(routeManualStockOutputAction("Retire -2 unidades do 1H.").kind, "INVALID");
  assert.equal(routeManualStockOutputAction("Retire o 1H.").kind, "INVALID");
});

test("texto de confirmação nunca executa", () => {
  for (const phrase of ["sim", "confirme", "pode fazer", "execute", "ok"]) {
    assert.equal(routeManualStockOutputAction(phrase).kind, "BUTTON_CONFIRMATION_TEXT", phrase);
  }
});

test("cancelamento textual não é ação operacional", () => {
  assert.equal(routeManualStockOutputAction("Cancelar esta saída.").kind, "CANCEL");
});

test("seleções estruturadas são estritas", () => {
  const identity = createManualStockOutputIdentitySelection("MBF015", 3, "ITEM");
  assert.deepEqual(identity, { action: "manual_stock_output_identity", targetQuery: "MBF015", quantity: 3, targetKind: "ITEM" });
  assert.equal(createManualStockOutputIdentitySelection("MBF015", 0, "ITEM"), null);
  assert.equal(createManualStockOutputIdentitySelection("", 2, "ITEM"), null);
});

test("token consolida duplicados e ordena linhas", () => {
  const signed = createManualStockOutputProposalToken({ userId, idempotencyKey: key, lines: [
    { kind: "ITEM", targetId: itemId, quantity: 1 },
    { kind: "COMMERCIAL_CODE", targetId: codeId, quantity: 2 },
    { kind: "ITEM", targetId: itemId, quantity: 3 },
  ] }, secret, now);
  assert.ok(signed);
  assert.deepEqual(signed.payload.lines, [
    { kind: "COMMERCIAL_CODE", targetId: codeId, quantity: 2 },
    { kind: "ITEM", targetId: itemId, quantity: 4 },
  ]);
});

test("token é vinculado a usuário, ação, assinatura e expiração", () => {
  const signed = createManualStockOutputProposalToken({ userId, idempotencyKey: key,
    lines: [{ kind: "ITEM", targetId: itemId, quantity: 3 }] }, secret, now);
  assert.ok(signed);
  assert.equal(verifyManualStockOutputProposalToken(signed.token, secret, userId, now).ok, true);
  assert.equal(verifyManualStockOutputProposalToken(signed.token, secret, codeId, now).reason, "user_mismatch");
  assert.equal(verifyManualStockOutputProposalToken(`${signed.token}x`, secret, userId, now).reason, "invalid");
  assert.equal(verifyManualStockOutputProposalToken(signed.token, secret, userId,
    new Date(now.getTime() + 601_000)).reason, "expired");
});

test("token de entrada não é aceito como token de saída", () => {
  const entry = createManualStockEntryProposalToken({ userId, idempotencyKey: key,
    lines: [{ kind: "ITEM", targetId: itemId, quantity: 1 }] }, secret, now);
  assert.ok(entry);
  assert.equal(verifyManualStockOutputProposalToken(entry.token, secret, userId, now).reason, "invalid");
});

test("token rejeita NEW_LOOSE_PART", () => {
  assert.equal(createManualStockOutputProposalToken({ userId, idempotencyKey: key,
    lines: [{ kind: "NEW_LOOSE_PART", targetId: itemId, quantity: 1 }] }, secret, now), null);
});

test("descrição operacional é fixa no servidor", () => {
  assert.equal(ASSISTANT_MANUAL_STOCK_OUTPUT_DESCRIPTION, "Saída manual confirmada pela Assistente NK.");
});

test("perfil sem nome é rejeitado pelo contrato", () => {
  assert.equal(manualStockOutputProfileHasName("Henrique"), true);
  assert.equal(manualStockOutputProfileHasName("   "), false);
  assert.equal(manualStockOutputProfileHasName(null), false);
});

test("projeção usa saldo montado antes da montagem automática", () => {
  assert.deepEqual(calculateManualStockOutputProjection(3, 8, 2), {
    autoAssembledQuantity: 0, estimatedStockAfter: 1, sufficient: true,
  });
  assert.deepEqual(calculateManualStockOutputProjection(1, 4, 3), {
    autoAssembledQuantity: 2, estimatedStockAfter: 0, sufficient: true,
  });
  assert.equal(calculateManualStockOutputProjection(0, 0, 1).sufficient, false);
  assert.equal(calculateManualStockOutputProjection(1, 1, 2).sufficient, false);
});

test("body operacional aceita somente proposalToken", () => {
  assert.equal(parseStockEntryActionBody({ proposalToken: "abc.def" }), "abc.def");
  assert.equal(parseStockEntryActionBody({ proposalToken: "abc.def", quantity: 1 }), null);
  assert.equal(parseStockEntryActionBody({ proposalToken: "abc.def", description: "livre" }), null);
});

test("same-origin é obrigatório", () => {
  assert.equal(stockEntryRequestIsSameOrigin(new Request("https://nk.local/api/assistant/actions/manual-stock-output", {
    headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin" },
  })), true);
  assert.equal(stockEntryRequestIsSameOrigin(new Request("https://nk.local/api/assistant/actions/manual-stock-output", {
    headers: { Origin: "https://evil.local", "Sec-Fetch-Site": "cross-site" },
  })), false);
});

test("handler executa uma confirmação e preserva sucesso com warning", async () => {
  let confirms = 0;
  const success = { block: { outcome: "success", refreshWarning: false } };
  const response = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/manual-stock-output", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def" }),
  }), {
    confirm: async () => { confirms += 1; return success; },
    revalidate: async () => { throw new Error("refresh"); },
    isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: (result) => ({ ...result, block: { ...result.block, refreshWarning: true } }),
    fallback: () => ({ block: { outcome: "error", refreshWarning: false } }),
  });
  assert.equal(confirms, 1);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).block.refreshWarning, true);
});

test("handler rejeita campo extra antes de confirmar", async () => {
  let confirms = 0;
  const response = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/manual-stock-output", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def", rpcName: "stock_outbound_items" }),
  }), { confirm: async () => { confirms += 1; return {}; }, revalidate: () => {}, isSuccess: () => false,
    addRefreshWarning: (value) => value, fallback: () => ({}) });
  assert.equal(response.status, 400);
  assert.equal(confirms, 0);
});

test("prévia persistida expira e perde o token", () => {
  const target = { kind: "ITEM", targetId: itemId, configurationId: null, displayCode: "1", aliases: [],
    typeLabel: "Servo sem kit", description: "SERVO MBF-015", detail: "MBF-015", currentStock: 5,
    availableStock: 5, autoAssemblyCapacity: 0, servo: null, installationKit: null };
  const block = { kind: "manual_stock_output_preview", action: "manual_stock_output", state: "pending",
    title: "Confirmar saída manual", message: "Revalidar.", proposalToken: "abc.def", expiresAt: now.toISOString(),
    lines: [{ target, outputQuantity: 2, estimatedStockAfter: 3, autoAssembledQuantity: 0 }], totalQuantity: 2,
    totalAutoAssemblyQuantity: 0, confirmLabel: "Confirmar saída", cancelLabel: "Cancelar", regeneratePrompt: "Retire 2 do Cód. 1." };
  const expired = expireStockEntryPreview(block);
  assert.equal(expired.state, "expired");
  assert.equal(expired.proposalToken, null);
  assert.equal(expired.expiresAt, null);
});
