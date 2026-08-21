import assert from "node:assert/strict";
import test from "node:test";

import { createManualStockEntryProposalToken, createSupplierOrderStockEntryProposalToken, verifyManualStockEntryProposalToken, verifySupplierOrderStockEntryProposalToken } from "../lib/ai/stock-entry-action-tokens.ts";
import { createManualStockEntryIdentitySelection, matchesExactManualStockEntryModel, normalizeManualStockEntryModel, routeManualStockEntryAction } from "../lib/ai/manual-stock-entry-routing.ts";
import { routeSupplierOrderStockEntryAction } from "../lib/ai/supplier-order-stock-entry-routing.ts";
import {
  selectSupplierOrderStockEntryLines,
  toSafeWaitingStockQuantity,
  validateSupplierOrderStockEntryConfirmation,
} from "../lib/ai/supplier-order-stock-entry-plan.ts";
import { handleStockEntryActionRequest, parseStockEntryActionBody, stockEntryRequestIsSameOrigin } from "../lib/ai/stock-entry-http-contract.ts";
import { ASSISTANT_MANUAL_STOCK_ENTRY_DESCRIPTION } from "../lib/ai/manual-stock-entry-contract.ts";
import { expireStockEntryPreview } from "../lib/ai/assistant-action-persistence.ts";

const secret = "local-test-secret-with-at-least-thirty-two-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const codeId = "55555555-5555-4555-8555-555555555555";
const key = "66666666-6666-4666-8666-666666666666";
const now = new Date("2026-07-31T12:00:00.000Z");

test("roteia entrada por Pedido e preserva a negociação exata", () => {
  const result = routeSupplierOrderStockEntryAction("Dê entrada em 1 unidade do 1H no Pedido Teste 04.");
  assert.equal(result.kind, "ACTION");
  assert.deepEqual(result.request, { negotiationNumber: "Teste 04", quantity: 1, allAvailable: false, targetQueries: ["1H"] });
  const all = routeSupplierOrderStockEntryAction("Dê entrada em tudo que está disponível no PEDIDO Teste 04!");
  assert.equal(all.kind, "ACTION");
  assert.equal(all.request.allAvailable, true);
  assert.deepEqual(all.request.targetQueries, []);
  const selected = routeSupplierOrderStockEntryAction("Lance o 1H e o KT-29 do Pedido Teste 04.");
  assert.equal(selected.kind, "ACTION");
  assert.deepEqual(selected.request.targetQueries, ["1H", "KT-29"]);
  assert.equal(routeSupplierOrderStockEntryAction("O que pode entrar no Estoque no Pedido Teste 04?").kind, "NOT_SUPPLIER_ORDER_STOCK_ENTRY");
  assert.deepEqual(routeSupplierOrderStockEntryAction("Lance 2 unidades do Cód. 1H no Estoque pelo Pedido Teste 04.").request.targetQueries, ["1H"]);
});

test("extrai Pedido, quantidade e código independentemente da ordem da frase", () => {
  const phrases = [
    "No Pedido Teste 04, lance mais 1 do código 1H no Estoque.",
    "no pedido teste 04 lance mais 1 do código 1h no estoque",
    "Lance mais 1 do 1H pelo Pedido Teste 04.",
    "Pelo Pedido Teste 04 dê entrada em 1 unidade do Cód. 1H.",
    "Dê entrada pelo Pedido Teste 04 em 1 unidade do Cód. 1H.",
    "Dê entrada em 1 do 1H no Pedido Teste 04.",
  ];
  for (const phrase of phrases) {
    const result = routeSupplierOrderStockEntryAction(phrase);
    assert.equal(result.kind, "ACTION", phrase);
    assert.equal(result.request.negotiationNumber.toLocaleLowerCase("pt-BR"), "teste 04", phrase);
    assert.equal(result.request.quantity, 1, phrase);
    assert.deepEqual(result.request.targetQueries.map((value) => value.toLocaleUpperCase("pt-BR")), ["1H"], phrase);
  }
  for (const negotiation of ["0004", "PED-104", "2026/045", "ABC 01-B"]) {
    const result = routeSupplierOrderStockEntryAction(`Lance mais 1 do 1H pelo Pedido ${negotiation}.`);
    assert.equal(result.kind, "ACTION");
    assert.equal(result.request.negotiationNumber, negotiation);
  }
});

test("roteia entradas manuais claras e esclarece modelo ambíguo", () => {
  assert.deepEqual(routeManualStockEntryAction("Dê entrada em 3 unidades do MBF-015 sem kit."),
    { kind: "ACTION", request: { quantity: 3, targetQuery: "MBF-015", requestedIdentity: "ITEM" } });
  assert.deepEqual(routeManualStockEntryAction("Dê entrada em 1 Servo com kit Cód. 1H."),
    { kind: "ACTION", request: { quantity: 1, targetQuery: "1H", requestedIdentity: "COMMERCIAL_CODE" } });
  assert.equal(routeManualStockEntryAction("Lance 4 unidades do KT-29 no Estoque.").request.targetQuery, "KT-29");
  assert.equal(routeManualStockEntryAction("Adicione 5 unidades da peça R064.").request.targetQuery, "R064");
  assert.equal(routeManualStockEntryAction("Dê entrada em 2 MBF-015.").kind, "AMBIGUOUS_FLOW");
  assert.equal(routeManualStockEntryAction("Dê entrada em 0 unidades do KT-29.").kind, "INVALID");
  assert.equal(routeManualStockEntryAction("Dê entrada em -2 unidades do KT-29.").kind, "INVALID");
});

test("atalho de entrada manual pede os detalhes sem cair no fluxo de Pedido", () => {
  assert.deepEqual(routeManualStockEntryAction("Dê entrada manual."), {
    kind: "MISSING_QUANTITY",
    targetQuery: null,
  });
  assert.equal(
    routeSupplierOrderStockEntryAction("Dê entrada manual.").kind,
    "NOT_SUPPLIER_ORDER_STOCK_ENTRY",
  );
});

test("reconhece linguagem natural de entrada manual para código comercial sem contexto de Pedido", () => {
  const phrases = [
    "Quero registrar uma entrada de 1 do 2A",
    "Quero registrar uma entrada de 1 unidade do 2A",
    "quero dar entrada no estoque de 1 do 2A",
    "Dê entrada manual de 1 do 2A",
    "Dê entrada de 1 no 2A",
    "Dê entrada de 1 unidade no 2A",
    "quero dar entrada no 2A 1 unidade",
  ];

  for (const phrase of phrases) {
    assert.deepEqual(routeManualStockEntryAction(phrase), {
      kind: "ACTION",
      request: { quantity: 1, targetQuery: "2A", requestedIdentity: null },
    }, phrase);
    assert.equal(
      routeSupplierOrderStockEntryAction(phrase).kind,
      "NOT_SUPPLIER_ORDER_STOCK_ENTRY",
      phrase,
    );
  }
});

test("aceita a resposta curta de código e quantidade após o atalho de entrada", () => {
  assert.deepEqual(routeManualStockEntryAction("2A, 2 unidades"), {
    kind: "ACTION",
    request: { quantity: 2, targetQuery: "2A", requestedIdentity: null },
  });
});

test("reconhece formulações naturais de entrada manual sem desviar para consulta", () => {
  for (const phrase of [
    "Dê entrada em 1 unidade do 1B.",
    "Dê entrada em 1 unidade do 1B no estoque.",
    "Dar entrada em 1 unidade do 1B.",
    "Quero colocar 1 unidade do 1B no estoque.",
    "Quero dar entrada em 1 unidade do 1B.",
    "Preciso colocar 1 unidade do 1B no estoque.",
    "Preciso dar entrada em 1 unidade do 1B.",
    "Coloque 1 unidade do 1B no estoque.",
    "Coloca 1 unidade do 1B no estoque.",
    "Adicionar 1 unidade do 1B no estoque.",
    "Adicione 1 unidade do 1B no estoque.",
    "Lance 1 unidade do 1B no estoque.",
    "Quero adicionar 1 unidade do 1B ao estoque.",
    "Pode colocar 1 unidade do 1B no estoque.",
    "quero coloca 1 unidade do 1b no estoque",
    "de entrada em um 1b no estoque",
  ]) {
    const result = routeManualStockEntryAction(phrase);
    assert.equal(result.kind, "ACTION", phrase);
    assert.equal(result.request.quantity, 1, phrase);
    assert.equal(result.request.targetQuery.toLocaleUpperCase("pt-BR"), "1B", phrase);
    assert.equal(result.request.requestedIdentity, null, phrase);
  }
});

test("interpreta um como quantidade somente dentro do comando operacional", () => {
  for (const phrase of [
    "Dê entrada em um 1B no estoque.",
    "Coloque um 1B no estoque.",
  ]) {
    const result = routeManualStockEntryAction(phrase);
    assert.equal(result.kind, "ACTION", phrase);
    assert.equal(result.request.quantity, 1, phrase);
    assert.equal(result.request.targetQuery, "1B", phrase);
  }
});

test("reconhece entrada manual sem quantidade e preserva o alvo para esclarecimento", () => {
  for (const phrase of [
    "Quero dar entrada manual do 1B.",
    "de entrada manual de 1b no estoque",
    "Dar entrada do 1B no estoque.",
    "Colocar o 1B no estoque.",
  ]) {
    const result = routeManualStockEntryAction(phrase);
    assert.equal(result.kind, "MISSING_QUANTITY", phrase);
    assert.equal(result.targetQuery.toLocaleUpperCase("pt-BR"), "1B", phrase);
  }
  assert.deepEqual(routeManualStockEntryAction("Quero dar entrada manual."), {
    kind: "MISSING_QUANTITY",
    targetQuery: null,
  });
});

test("preserva consultas somente leitura fora da rota de entrada manual", () => {
  for (const phrase of [
    "Quanto tem do 1B?",
    "Quanto tem do 2A?",
    "Qual o estoque do 1B?",
    "Me mostre o 1B.",
    "Tem 1B no estoque?",
    "Quanto tem do MBF-025?",
  ]) {
    assert.equal(routeManualStockEntryAction(phrase).kind, "NOT_MANUAL_STOCK_ENTRY", phrase);
  }
});

test("qualificador sem kit tem prioridade e aceita variações do modelo", () => {
  for (const phrase of [
    "Dê entrada em 3 unidades do MBF015 sem kit.",
    "Dê entrada em 3 unidades do MBF-015 sem kit.",
    "Dê entrada em 3 unidades do mbf 015 sem kit.",
  ]) {
    const result = routeManualStockEntryAction(phrase);
    assert.equal(result.kind, "ACTION", phrase);
    assert.equal(result.request.quantity, 3, phrase);
    assert.equal(result.request.requestedIdentity, "ITEM", phrase);
  }
  assert.equal(routeManualStockEntryAction("Dê entrada em 2 MBF-015.").kind, "AMBIGUOUS_FLOW");
  for (const query of ["MBF015", "MBF-015", "mbf 015"]) {
    assert.equal(matchesExactManualStockEntryModel(query, "MBF-015"), true);
    assert.equal(matchesExactManualStockEntryModel(query, "MBF-015 Deslocado"), false);
  }
});

test("separa quantidade e AL-10 em comandos naturais equivalentes", () => {
  const phrases = [
    "Dê entrada em 1 unidade do AL-10 sem kit.",
    "Dê entrada no Estoque de 1 unidade do AL10 sem kit.",
    "de entrada no estoque de 1 unidade do al10 sem kit",
    "Dar entrada em uma unidade do AL 10 sem kit.",
    "Adicione 1 unidade do AL10 sem kit ao Estoque.",
    "Coloque mais 1 AL-10 sem kit no Estoque.",
    "Lance no Estoque 1 unidade do AL10 sem kit.",
  ];

  for (const phrase of phrases) {
    const result = routeManualStockEntryAction(phrase);
    assert.equal(result.kind, "ACTION", phrase);
    assert.equal(result.request.quantity, 1, phrase);
    assert.equal(result.request.requestedIdentity, "ITEM", phrase);
    assert.equal(normalizeManualStockEntryModel(result.request.targetQuery), "AL10", phrase);
    assert.doesNotMatch(result.request.targetQuery, /unidades?/iu, phrase);
  }
});

test("não confunde quantidade com números do modelo ou código", () => {
  const two = routeManualStockEntryAction("Dê entrada em 2 unidades do AL10 sem kit.");
  assert.deepEqual(two, {
    kind: "ACTION",
    request: { quantity: 2, targetQuery: "AL10", requestedIdentity: "ITEM" },
  });

  const ten = routeManualStockEntryAction("Dê entrada em 10 unidades do AL10 sem kit.");
  assert.deepEqual(ten, {
    kind: "ACTION",
    request: { quantity: 10, targetQuery: "AL10", requestedIdentity: "ITEM" },
  });

  const code = routeManualStockEntryAction("Dê entrada em 1 unidade do Cód. 1 sem kit.");
  assert.deepEqual(code, {
    kind: "ACTION",
    request: { quantity: 1, targetQuery: "1", requestedIdentity: "ITEM" },
  });

  const mbf = routeManualStockEntryAction("Dê entrada em 1 unidade do MBF015 sem kit.");
  assert.deepEqual(mbf, {
    kind: "ACTION",
    request: { quantity: 1, targetQuery: "MBF015", requestedIdentity: "ITEM" },
  });
});

test("mantém alvo inexistente limpo e não trata texto não operacional como entrada", () => {
  const missing = routeManualStockEntryAction("Dê entrada em 1 unidade do XYZ-999 sem kit.");
  assert.deepEqual(missing, {
    kind: "ACTION",
    request: { quantity: 1, targetQuery: "XYZ-999", requestedIdentity: "ITEM" },
  });
  assert.equal(routeManualStockEntryAction("Fale de entrada no estoque de mercadorias.").kind, "NOT_MANUAL_STOCK_ENTRY");
  assert.equal(routeManualStockEntryAction("Cancelar esta entrada.").kind, "CANCEL");
});

test("opção estruturada preserva modelo, identidade e quantidade original", () => {
  assert.deepEqual(createManualStockEntryIdentitySelection("MBF015", 3, "ITEM"), {
    action: "manual_stock_entry_identity",
    targetQuery: "MBF015",
    quantity: 3,
    targetKind: "ITEM",
  });
  assert.equal(createManualStockEntryIdentitySelection("MBF015", 0, "ITEM"), null);
});

test("texto de confirmação nunca vira execução", () => {
  for (const text of ["sim", "confirme", "pode fazer", "ok", "execute", "manda ver"]) {
    assert.equal(routeManualStockEntryAction(text).kind, "BUTTON_CONFIRMATION_TEXT");
    assert.equal(routeSupplierOrderStockEntryAction(text).kind, "BUTTON_CONFIRMATION_TEXT");
  }
});

test("token de Pedido preserva microssegundos, ordem e vínculo ao usuário", () => {
  const expectedUpdatedAt = "2026-07-31T08:09:10.123456-03:00";
  const created = createSupplierOrderStockEntryProposalToken({ userId, supplierOrderId: orderId,
    lines: [{ supplierOrderItemId: lineId, quantity: 1 }], expectedUpdatedAt, idempotencyKey: key }, secret, now);
  assert.ok(created);
  assert.equal(created.payload.expectedUpdatedAt, expectedUpdatedAt);
  const verified = verifySupplierOrderStockEntryProposalToken(created.token, secret, userId, now);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.expectedUpdatedAt, expectedUpdatedAt);
  assert.equal(verifySupplierOrderStockEntryProposalToken(created.token, secret, itemId, now).reason, "user_mismatch");
  assert.equal(verifyManualStockEntryProposalToken(created.token, secret, userId, now).reason, "invalid");
});

test("token manual consolida duplicados, rejeita NEW_LOOSE_PART e ação cruzada", () => {
  const created = createManualStockEntryProposalToken({ userId, lines: [
    { kind: "ITEM", targetId: itemId, quantity: 1 }, { kind: "ITEM", targetId: itemId, quantity: 2 },
    { kind: "COMMERCIAL_CODE", targetId: codeId, quantity: 1 },
  ], idempotencyKey: key }, secret, now);
  assert.ok(created);
  assert.deepEqual(created.payload.lines, [
    { kind: "COMMERCIAL_CODE", targetId: codeId, quantity: 1 }, { kind: "ITEM", targetId: itemId, quantity: 3 },
  ]);
  assert.equal(verifyManualStockEntryProposalToken(created.token, secret, userId, now).ok, true);
  assert.equal(verifySupplierOrderStockEntryProposalToken(created.token, secret, userId, now).reason, "invalid");
  assert.equal(createManualStockEntryProposalToken({ userId, lines: [
    { kind: "NEW_LOOSE_PART", targetId: itemId, quantity: 1 },
  ], idempotencyKey: key }, secret, now), null);
});

test("tokens adulterados e expirados são rejeitados", () => {
  const created = createManualStockEntryProposalToken({ userId, lines: [{ kind: "ITEM", targetId: itemId, quantity: 1 }], idempotencyKey: key }, secret, now);
  assert.ok(created);
  const [payload, signature] = created.token.split(".");
  const tampered = `${payload}.${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
  assert.equal(verifyManualStockEntryProposalToken(tampered, secret, userId, now).reason, "invalid");
  assert.equal(verifyManualStockEntryProposalToken(created.token, secret, userId, new Date(now.getTime() + 11 * 60 * 1000)).reason, "expired");
});

test("contrato HTTP aceita somente proposalToken e exige same-origin", () => {
  assert.equal(parseStockEntryActionBody({ proposalToken: "abc.def" }), "abc.def");
  assert.equal(parseStockEntryActionBody({ proposalToken: "abc.def", description: "não permitido" }), null);
  assert.equal(parseStockEntryActionBody({ action: "manual_stock_entry", proposalToken: "abc.def" }), null);
  assert.equal(stockEntryRequestIsSameOrigin(new Request("https://nk.local/api/assistant/actions/manual-stock-entry", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin" },
  })), true);
  assert.equal(stockEntryRequestIsSameOrigin(new Request("https://nk.local/api/assistant/actions/manual-stock-entry", {
    method: "POST", headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
  })), false);
});

test("descrição manual é fixa e exclusivamente server-side", () => {
  assert.equal(ASSISTANT_MANUAL_STOCK_ENTRY_DESCRIPTION, "Entrada manual confirmada pela Assistente NK.");
});

test("prévia restaurada perde o proposalToken e fica expirada", () => {
  const expired = expireStockEntryPreview({
    kind: "manual_stock_entry_preview", action: "manual_stock_entry", state: "pending",
    title: "Confirmar entrada manual", message: "Prévia", proposalToken: "abc.def",
    expiresAt: "2026-07-31T12:10:00.000Z", lines: [], totalQuantity: 1,
    confirmLabel: "Confirmar entrada", cancelLabel: "Cancelar", regeneratePrompt: "Gerar novamente",
  });
  assert.equal(expired.state, "expired");
  assert.equal(expired.proposalToken, null);
  assert.equal(expired.expiresAt, null);
});

test("Route Handler mockado confirma uma vez e preserva success com refreshWarning", async () => {
  let calls = 0;
  const response = await handleStockEntryActionRequest(
    new Request("https://nk.local/api/assistant/actions/manual-stock-entry", {
      method: "POST",
      headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
      body: JSON.stringify({ proposalToken: "abc.def" }),
    }),
    {
      confirm: async () => { calls += 1; return { outcome: "success", refreshWarning: false }; },
      revalidate: () => { throw new Error("mock refresh failure"); },
      isSuccess: (result) => result.outcome === "success",
      addRefreshWarning: (result) => ({ ...result, refreshWarning: true }),
      fallback: () => ({ outcome: "error", refreshWarning: false }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { outcome: "success", refreshWarning: true });
});

test("Route Handler mockado rejeita campo extra e origem cruzada antes do executor", async () => {
  let calls = 0;
  const dependencies = {
    confirm: async () => { calls += 1; return { outcome: "success" }; },
    revalidate: () => {},
    isSuccess: (result) => result.outcome === "success",
    addRefreshWarning: (result) => result,
    fallback: () => ({ outcome: "error" }),
  };
  const extraField = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/manual-stock-entry", {
    method: "POST", headers: { Origin: "https://nk.local", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def", description: "bloqueada" }),
  }), dependencies);
  const crossOrigin = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/manual-stock-entry", {
    method: "POST", headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def" }),
  }), dependencies);
  assert.equal(extraField.status, 400);
  assert.equal(crossOrigin.status, 403);
  assert.equal(calls, 0);
});

test("mapeia waiting_stock_quantity e seleciona somente retiradas aguardando entrada", () => {
  const mappedWaitingQuantity = toSafeWaitingStockQuantity(1);
  assert.equal(mappedWaitingQuantity, 1);

  const items = [
    { id: "line-1", waitingStockQuantity: mappedWaitingQuantity, pickedQuantity: 1, stockedQuantity: 0 },
    { id: "line-2", waitingStockQuantity: 0, pickedQuantity: 4, stockedQuantity: 4 },
    // A prontidão Safisa não participa da disponibilidade de entrada no Estoque.
    { id: "line-3", waitingStockQuantity: 0, pickedQuantity: 0, stockedQuantity: 0, readyQuantity: 8 },
  ];

  const allAvailable = selectSupplierOrderStockEntryLines(
    { allAvailable: true, quantity: null, targetQueries: [] },
    items,
    () => [],
  );
  assert.deepEqual(allAvailable, {
    kind: "ok",
    lines: [{ item: items[0], quantity: 1 }],
  });

  const specific = selectSupplierOrderStockEntryLines(
    { allAvailable: false, quantity: 1, targetQueries: ["1H"] },
    items,
    () => [items[0]],
  );
  assert.deepEqual(specific, {
    kind: "ok",
    lines: [{ item: items[0], quantity: 1 }],
  });

  const alreadyStocked = selectSupplierOrderStockEntryLines(
    { allAvailable: false, quantity: 1, targetQueries: ["1H"] },
    [items[1]],
    () => [items[1]],
  );
  assert.deepEqual(alreadyStocked, { kind: "unavailable", query: "1H" });
});

test("revalida versão e disponibilidade antes da confirmação de entrada por Pedido", () => {
  const lines = [{ supplierOrderItemId: lineId, quantity: 1 }];
  const currentItems = [{ id: lineId, waitingStockQuantity: 1 }];

  assert.equal(
    validateSupplierOrderStockEntryConfirmation(
      "2026-08-08T12:00:00.123456Z",
      "2026-08-08T12:00:00.123456Z",
      lines,
      currentItems,
    ),
    "ok",
  );
  assert.equal(
    validateSupplierOrderStockEntryConfirmation(
      "2026-08-08T12:00:00.123456Z",
      "2026-08-08T12:00:01.123456Z",
      lines,
      currentItems,
    ),
    "order_changed",
  );
  assert.equal(
    validateSupplierOrderStockEntryConfirmation(
      "2026-08-08T12:00:00.123456Z",
      "2026-08-08T12:00:00.123456Z",
      lines,
      [{ id: lineId, waitingStockQuantity: 0 }],
    ),
    "availability_changed",
  );
});
