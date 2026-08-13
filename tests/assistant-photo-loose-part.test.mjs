import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { interpretSupplierOrderPhoto } from "../lib/assistant-supplier-order-photo.ts";
import { updateSupplierOrderPhotoPreviewLine } from "../lib/assistant-supplier-order-photo-preview.ts";

const catalog = [{ identity: "ITEM:1", codeIdentity: "1", code: "10A", description: "SERVO MC-040 + KT-48" }];
const base = {
  documentType: "supplier_order", negotiationNumber: "40963", orderDate: "2026-07-24",
  lines: [{ rawCode: "P123", rawDescription: "SUPORTE DO SERVO", quantity: 4, needsReview: false, warning: null }],
  documentWarnings: [],
};

function dependencies(extraction = base) {
  return {
    extract: async () => structuredClone(extraction),
    loadCatalog: async () => catalog,
    findExistingOrder: async () => null,
  };
}

test("código desconhecido seguro tem motivo tipado e permite fluxo explícito", async () => {
  const block = await interpretSupplierOrderPhoto(dependencies());
  assert.deepEqual(block.lines[0].blockingReasons, ["CODE_NOT_FOUND"]);
  assert.equal(block.state, "NEEDS_REVIEW");
});

test("código visualmente incerto não é confundido com ausência no catálogo", async () => {
  const extraction = structuredClone(base);
  extraction.lines[0].needsReview = true;
  extraction.lines[0].warning = "O código está incerto na fotografia.";
  const block = await interpretSupplierOrderPhoto(dependencies(extraction));
  assert.ok(block.lines[0].blockingReasons.includes("CODE_UNCERTAIN"));
});

test("quantidade pendente continua bloqueante depois de cadastrar a peça", async () => {
  const extraction = structuredClone(base);
  extraction.lines[0].quantity = null;
  extraction.lines[0].needsReview = true;
  extraction.lines[0].warning = "A quantidade não pôde ser lida.";
  const block = await interpretSupplierOrderPhoto(dependencies(extraction));
  const updated = updateSupplierOrderPhotoPreviewLine(block, 0, { code: "P123", description: "SUPORTE DO SERVO" });
  assert.equal(updated.lines[0].resolution, "NEEDS_REVIEW");
  assert.deepEqual(updated.lines[0].blockingReasons, ["QUANTITY_MISSING"]);
  assert.equal(updated.state, "NEEDS_REVIEW");
});

test("blocker visual não relacionado ao código permanece após cadastro", async () => {
  const extraction = structuredClone(base);
  extraction.lines[0].needsReview = true;
  extraction.lines[0].warning = "A anotação manuscrita altera a leitura da linha.";
  const block = await interpretSupplierOrderPhoto(dependencies(extraction));
  const updated = updateSupplierOrderPhotoPreviewLine(block, 0, { code: "P123", description: "SUPORTE DO SERVO" });
  assert.ok(updated.lines[0].blockingReasons.includes("VISUAL_REVIEW"));
  assert.equal(updated.lines[0].resolution, "NEEDS_REVIEW");
});

test("correção exata atualiza a linha e pode deixar a prévia pronta", async () => {
  const block = await interpretSupplierOrderPhoto(dependencies());
  const updated = updateSupplierOrderPhotoPreviewLine(block, 0, { code: "10A", description: "SERVO MC-040 + KT-48" });
  assert.equal(updated.lines[0].resolution, "IDENTIFIED");
  assert.equal(updated.lines[0].displayCode, "10A");
  assert.equal(updated.state, "READY_FOR_REVIEW");
});

test("endpoints são fixos, estritos, autenticados e não criam Pedido nem estoque", () => {
  const resolveRoute = readFileSync(new URL("../app/api/assistant/order-photo/resolve-code/route.ts", import.meta.url), "utf8");
  const createRoute = readFileSync(new URL("../app/api/assistant/order-photo/create-loose-part/route.ts", import.meta.url), "utf8");
  const security = readFileSync(new URL("../lib/assistant-order-photo-route.ts", import.meta.url), "utf8");
  assert.match(security, /getClaims\(\)/);
  assert.match(security, /isAssistantOrderPhotoSameOrigin/);
  assert.match(resolveRoute, /readExactJson\(request, \["code"\]\)/);
  assert.match(createRoute, /readExactJson\(request, \["code", "description"\]\)/);
  assert.match(createRoute, /\.rpc\("create_loose_part"/);
  assert.doesNotMatch(resolveRoute + createRoute, /Gemini|create_supplier_order|stock_inbound|movement_batch/);
});

test("UI C3B mantém modal/bottom sheet e bloqueio de duplo clique junto da criação segura", () => {
  const view = readFileSync(new URL("../components/assistant-structured-block.tsx", import.meta.url), "utf8");
  assert.match(view, /Cadastrar peça avulsa/);
  assert.match(view, /role="dialog"/);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, /items-end[\s\S]*sm:items-center/);
  assert.match(view, /if \(!dialog \|\| submitInFlightRef\.current \|\| !onUpdate\) return/);
  assert.match(view, /"Criar Pedido"/);
  assert.match(view, /prepare-create/);
  assert.match(view, /confirm-create/);
});
