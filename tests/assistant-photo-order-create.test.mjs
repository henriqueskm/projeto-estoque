import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createSupplierOrderPhotoCreateProposalToken,
  verifySupplierOrderPhotoCreateProposalToken,
} from "../lib/ai/supplier-order-photo-create-token.ts";
import {
  createSupplierOrderPhotoPrepareInputFromPreview,
  parseSupplierOrderPhotoCreatePrepareInput,
  supplierOrderPhotoCreateMaxLines,
} from "../lib/assistant-supplier-order-photo-create-contract.ts";
import {
  confirmSupplierOrderPhotoCreate,
  prepareSupplierOrderPhotoCreate,
} from "../lib/assistant-supplier-order-photo-create.ts";

const secret = "a".repeat(64);
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const itemId = "11111111-1111-4111-8111-111111111111";
const configurationId = "22222222-2222-4222-8222-222222222222";
const commercialCodeId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "99999999-9999-4999-8999-999999999999";
const now = new Date("2026-08-13T12:00:00.000Z");

const catalog = [
  {
    identity: `ITEM:${itemId}`, codeIdentity: itemId, kind: "ITEM", targetId: itemId,
    commercialConfigurationCodeId: null, code: "091/VF", description: "TAMPA INTERMEDIARIA VF - 024,5",
  },
  {
    identity: `CONFIGURATION:${configurationId}`, codeIdentity: commercialCodeId,
    kind: "COMMERCIAL_CONFIGURATION", targetId: configurationId,
    commercialConfigurationCodeId: commercialCodeId, code: "10A", description: "SERVO MC-040 + KT-48",
  },
];

function tokenInput(overrides = {}) {
  return {
    userId, negotiationNumber: "0040959", orderDate: "2026-08-13",
    lines: [
      {
        kind: "ITEM", targetId: itemId, commercialConfigurationCodeId: null,
        code: "091/VF", quantity: 2,
      },
      {
        kind: "COMMERCIAL_CONFIGURATION", targetId: configurationId,
        commercialConfigurationCodeId: commercialCodeId, code: "10A", quantity: 2,
      },
    ],
    idempotencyKey,
    ...overrides,
  };
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
  return `${encoded}.${signature}`;
}

function createProposal(input) {
  return createSupplierOrderPhotoCreateProposalToken(input, secret, now);
}

function preparationDependencies(overrides = {}) {
  return {
    loadCatalog: async () => structuredClone(catalog),
    findExistingOrder: async () => null,
    createProposal,
    createIdempotencyKey: () => idempotencyKey,
    ...overrides,
  };
}

const prepareInput = {
  negotiationNumber: "0040959",
  orderDate: "2026-08-13",
  lines: [
    { code: "10a", quantity: 1 },
    { code: "091/VF", quantity: 2 },
    { code: "10A", quantity: 1 },
  ],
};

function receipt() {
  return {
    supplierOrderId: "77777777-7777-4777-8777-777777777777",
    negotiationNumber: "0040959", lineCount: 2, orderedQuantity: 4,
    pickedQuantity: 0, cancelledQuantity: 0, waitingPickupQuantity: 4,
    stockedQuantity: 0, waitingStockQuantity: 0, pickupPercentage: 0,
    status: "PENDING", updatedAt: "2026-08-13T12:00:01.000000+00:00",
  };
}

test("prepare aceita apenas o contrato de negócio estrito e preserva zeros à esquerda", () => {
  assert.deepEqual(parseSupplierOrderPhotoCreatePrepareInput(prepareInput), prepareInput);
  assert.equal(parseSupplierOrderPhotoCreatePrepareInput({ ...prepareInput, description: "não confiar" }), null);
  assert.equal(parseSupplierOrderPhotoCreatePrepareInput({
    ...prepareInput,
    lines: [{ code: "10A", quantity: 1, itemId }],
  }), null);
  assert.equal(parseSupplierOrderPhotoCreatePrepareInput({ ...prepareInput, negotiationNumber: "409-59" }), null);
  assert.equal(parseSupplierOrderPhotoCreatePrepareInput({ ...prepareInput, orderDate: "2026-02-30" }), null);
});

test("bloco plenamente resolvido gera input sem descrição nem IDs do browser", () => {
  const preview = {
    kind: "supplier_order_photo_preview", state: "READY_FOR_REVIEW", title: "Pedido identificado",
    message: "Revise", banner: "Somente prévia — nenhum Pedido foi criado.",
    negotiationNumber: "0040959", orderDate: "2026-08-13", totalQuantity: 2,
    warnings: ["Frete omitido"], existingOrder: null, fallbackText: "Prévia",
    lines: [{ rawCode: "10a", displayCode: "10A", description: "Oficial", rawDescription: "OCR",
      quantity: 2, resolution: "IDENTIFIED", blockingReasons: [], descriptionMatch: "MATCH",
      warning: null, consolidatedLineCount: 1 }],
  };
  assert.deepEqual(createSupplierOrderPhotoPrepareInputFromPreview(preview), {
    negotiationNumber: "0040959", orderDate: "2026-08-13", lines: [{ code: "10A", quantity: 2 }],
  });
  preview.lines[0].blockingReasons = ["VISUAL_REVIEW"];
  assert.equal(createSupplierOrderPhotoPrepareInputFromPreview(preview), null);
});

test("prepare re-resolve catálogo exato, consolida identidade oficial e assina token", async () => {
  const result = await prepareSupplierOrderPhotoCreate(prepareInput, userId, preparationDependencies());
  assert.equal(result.ok, true);
  assert.equal(result.preparation.negotiationNumber, "0040959");
  assert.equal(result.preparation.lineCount, 2);
  assert.equal(result.preparation.totalQuantity, 4);
  assert.equal(result.preparation.lines.find((line) => line.code === "10A").quantity, 2);
  assert.equal(result.preparation.lines.find((line) => line.code === "10A").description, "SERVO MC-040 + KT-48");
  assert.equal(result.preparation.expiresAt, "2026-08-13T12:10:00.000Z");
  assert.equal(JSON.stringify(result.preparation).includes("rawDescription"), false);
});

test("prepare rejeita unknown, ambiguous, inativo ausente, fuzzy e Pedido duplicado", async () => {
  for (const code of ["10B", "091V/F"]) {
    const result = await prepareSupplierOrderPhotoCreate(
      { ...prepareInput, lines: [{ code, quantity: 1 }] }, userId, preparationDependencies(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "CATALOG_NOT_FOUND");
  }
  const ambiguous = await prepareSupplierOrderPhotoCreate(
    { ...prepareInput, lines: [{ code: "10A", quantity: 1 }] }, userId,
    preparationDependencies({ loadCatalog: async () => [catalog[1], { ...catalog[1], targetId: itemId }] }),
  );
  assert.equal(ambiguous.code, "CATALOG_AMBIGUOUS");
  const duplicate = await prepareSupplierOrderPhotoCreate(prepareInput, userId, preparationDependencies({
    findExistingOrder: async () => ({
      id: "77777777-7777-4777-8777-777777777777", negotiationNumber: "0040959",
      status: "PENDING", isInHistory: false,
    }),
  }));
  assert.equal(duplicate.code, "DUPLICATE");
  assert.match(duplicate.block.order.href, /view=active/);
});

test("cadastro catalog-only recém-criado resolve como item e excesso orienta tela tradicional", async () => {
  const result = await prepareSupplierOrderPhotoCreate(
    { negotiationNumber: "40959", orderDate: "2026-08-13", lines: [{ code: "091/VF", quantity: 2 }] },
    userId, preparationDependencies(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.preparation.lines[0].kind, "ITEM");
  const tooMany = await prepareSupplierOrderPhotoCreate({
    negotiationNumber: "40959", orderDate: "2026-08-13",
    lines: Array.from({ length: supplierOrderPhotoCreateMaxLines + 1 }, () => ({ code: "091/VF", quantity: 1 })),
  }, userId, preparationDependencies());
  assert.equal(tooMany.code, "TOO_MANY_LINES");
  assert.match(tooMany.error, /tela tradicional/);
});

test("token válido é vinculado ao usuário, expira em dez minutos e aceita dezenas de linhas", () => {
  const lines = Array.from({ length: 60 }, (_, index) => ({
    kind: "ITEM", targetId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    commercialConfigurationCodeId: null, code: `P${index + 1}`, quantity: index + 1,
  }));
  const created = createSupplierOrderPhotoCreateProposalToken(tokenInput({ lines }), secret, now);
  assert.ok(created);
  assert.equal(created.payload.expiresAt - created.payload.issuedAt, 600);
  assert.equal(verifySupplierOrderPhotoCreateProposalToken(created.token, secret, userId, now).ok, true);
  assert.equal(verifySupplierOrderPhotoCreateProposalToken(created.token, secret, otherUserId, now).reason, "user_mismatch");
  assert.equal(verifySupplierOrderPhotoCreateProposalToken(created.token, secret, userId, new Date("2026-08-13T12:10:01Z")).reason, "expired");
});

test("token rejeita adulteração, schema/action/versão/linha/idempotência inválidos e segredo curto", () => {
  const created = createSupplierOrderPhotoCreateProposalToken(tokenInput(), secret, now);
  assert.ok(created);
  assert.equal(verifySupplierOrderPhotoCreateProposalToken(`${created.token}x`, secret, userId, now).reason, "invalid");
  assert.equal(createSupplierOrderPhotoCreateProposalToken(tokenInput(), "curto", now), null);
  assert.equal(verifySupplierOrderPhotoCreateProposalToken(created.token, "curto", userId, now).reason, "configuration");
  const cases = [
    { ...created.payload, action: "supplier_order_pickup" },
    { ...created.payload, version: 2 },
    { ...created.payload, rpcName: "create_supplier_order" },
    { ...created.payload, idempotencyKey: "invalid" },
    { ...created.payload, issuedAt: created.payload.expiresAt + 1 },
    { ...created.payload, lines: [{ ...created.payload.lines[0], quantity: 0 }] },
    { ...created.payload, lines: [{ ...created.payload.lines[0], description: "browser" }] },
  ];
  for (const payload of cases) {
    assert.equal(verifySupplierOrderPhotoCreateProposalToken(signPayload(payload), secret, userId, now).reason, "invalid");
  }
  assert.equal(verifySupplierOrderPhotoCreateProposalToken(`a.${"b".repeat(70_000)}`, secret, userId, now).reason, "invalid");
});

test("confirm revalida catálogo e cria exatamente um Pedido em replay do mesmo token", async () => {
  const created = createSupplierOrderPhotoCreateProposalToken(tokenInput(), secret, now);
  const receipts = new Map();
  let writes = 0;
  const inputs = [];
  const dependencies = {
    verifyProposal: (token, expectedUserId) => verifySupplierOrderPhotoCreateProposalToken(token, secret, expectedUserId, now),
    loadCatalog: async () => structuredClone(catalog),
    findExistingOrder: async () => null,
    createOrder: async (input) => {
      inputs.push(input);
      if (!receipts.has(input.idempotency_key)) {
        writes += 1;
        receipts.set(input.idempotency_key, receipt());
      }
      return { ok: true, receipt: receipts.get(input.idempotency_key) };
    },
  };
  const first = await confirmSupplierOrderPhotoCreate(created.token, userId, dependencies);
  const second = await confirmSupplierOrderPhotoCreate(created.token, userId, dependencies);
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.equal(writes, 1);
  assert.equal(inputs[0].notes, null);
  assert.equal(inputs[0].lines[0].notes, null);
  assert.equal(inputs[0].lines[0].item_id, itemId);
  assert.equal(first.block.order.status, "PENDING");
  assert.equal(first.block.lineCount, 2);
  assert.equal(first.block.totalQuantity, 4);
});

test("confirm expirada/outro usuário/catálogo alterado ou código remapeado gera zero writes", async () => {
  const created = createSupplierOrderPhotoCreateProposalToken(tokenInput(), secret, now);
  let writes = 0;
  const base = {
    verifyProposal: (token, expectedUserId) => verifySupplierOrderPhotoCreateProposalToken(token, secret, expectedUserId, now),
    loadCatalog: async () => structuredClone(catalog), findExistingOrder: async () => null,
    createOrder: async () => { writes += 1; return { ok: true, receipt: receipt() }; },
  };
  const other = await confirmSupplierOrderPhotoCreate(created.token, otherUserId, base);
  assert.equal(other.code, "USER_MISMATCH");
  const changed = await confirmSupplierOrderPhotoCreate(created.token, userId, {
    ...base, loadCatalog: async () => catalog.filter((target) => target.code !== "091/VF"),
  });
  assert.equal(changed.code, "CATALOG_CHANGED");
  const remapped = await confirmSupplierOrderPhotoCreate(created.token, userId, {
    ...base, loadCatalog: async () => [{ ...catalog[0], targetId: configurationId }, catalog[1]],
  });
  assert.equal(remapped.code, "CATALOG_CHANGED");
  const expired = await confirmSupplierOrderPhotoCreate(created.token, userId, {
    ...base,
    verifyProposal: (token, expectedUserId) => verifySupplierOrderPhotoCreateProposalToken(
      token, secret, expectedUserId, new Date("2026-08-13T12:10:01Z"),
    ),
  });
  assert.equal(expired.code, "EXPIRED");
  assert.equal(writes, 0);
});

test("corrida de negociação retorna Pedido existente e incerteza mantém a mesma proposta", async () => {
  const created = createSupplierOrderPhotoCreateProposalToken(tokenInput(), secret, now);
  const base = {
    verifyProposal: (token, expectedUserId) => verifySupplierOrderPhotoCreateProposalToken(token, secret, expectedUserId, now),
    loadCatalog: async () => structuredClone(catalog),
    createOrder: async () => ({ ok: false, error: "dados não são mais válidos" }),
  };
  const race = await confirmSupplierOrderPhotoCreate(created.token, userId, {
    ...base,
    findExistingOrder: async () => ({
      id: "77777777-7777-4777-8777-777777777777", negotiationNumber: "0040959",
      status: "PENDING", isInHistory: false,
    }),
  });
  assert.equal(race.ok, true);
  assert.equal(race.block.outcome, "duplicate");
  const uncertain = await confirmSupplierOrderPhotoCreate(created.token, userId, {
    ...base, findExistingOrder: async () => null,
  });
  assert.equal(uncertain.code, "TRANSPORT_UNCERTAIN");
  assert.match(uncertain.error, /Verifique se o Pedido foi criado/);
});

test("rotas são fixas, prepare não escreve e confirmação aceita somente proposalToken", () => {
  const prepareRoute = readFileSync(new URL("../app/api/assistant/order-photo/prepare-create/route.ts", import.meta.url), "utf8");
  const confirmRoute = readFileSync(new URL("../app/api/assistant/order-photo/confirm-create/route.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../lib/assistant-supplier-order-photo-create.ts", import.meta.url), "utf8");
  assert.match(prepareRoute, /\["negotiationNumber", "orderDate", "lines"\]/);
  assert.doesNotMatch(prepareRoute, /@\/app\/\(authenticated\)\/pedidos\/actions|\.rpc\(/);
  assert.match(confirmRoute, /\["proposalToken"\]/);
  assert.match(confirmRoute, /createOrder: createSupplierOrder/);
  assert.doesNotMatch(confirmRoute, /\.rpc\(|Gemini|movement_batch|Safisa/i);
  assert.match(service, /notes: null/);
});

test("UI confirma somente por botão, mantém token fora do structured block e não roteia texto", () => {
  const view = readFileSync(new URL("../components/assistant-structured-block.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../components/assistant-home.tsx", import.meta.url), "utf8");
  const contract = readFileSync(new URL("../lib/assistant-supplier-order-photo-create-contract.ts", import.meta.url), "utf8");
  assert.match(view, /"Criar Pedido"/);
  assert.match(view, /Confirmar criação/);
  assert.match(view, /role="dialog"/);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, /createInFlightRef\.current/);
  assert.match(view, /JSON\.stringify\(\{ proposalToken: createProposal\.proposalToken \}\)/);
  assert.doesNotMatch(contract, /AssistantSupplierOrderPhotoCreateResultBlock[\s\S]{0,800}proposalToken/);
  assert.doesNotMatch(home, /supplier_order_create_from_photo/);
});

test("serviço de criação não contém caminhos de estoque, Safisa ou imagem/Gemini", () => {
  const source = readFileSync(new URL("../lib/assistant-supplier-order-photo-create.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /stock_movements|movement_batches|stock_balances|ready_quantity|Safisa|Gemini|base64|image/i);
});
