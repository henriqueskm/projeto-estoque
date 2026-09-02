import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { interpretSupplierOrderPhoto } from "../lib/assistant-supplier-order-photo.ts";
import { updateSupplierOrderPhotoPreviewLine } from "../lib/assistant-supplier-order-photo-preview.ts";
import {
  assessSupplierOrderPhotoLoosePartCode,
  resolveSupplierOrderPhotoCatalogCode,
} from "../lib/assistant-supplier-order-photo-catalog-resolution.ts";

const catalog = [{ identity: "ITEM:1", codeIdentity: "1", code: "10A", description: "SERVO MC-040 + KT-48" }];
const invertedCatalog = [
  { identity: "ITEM:1inv", codeIdentity: "1inv", code: "1INV", description: "SERVO MBF-015 Invertido 028" },
  { identity: "ITEM:5inv015", codeIdentity: "5inv015", code: "5INV015", description: "SERVO MBF-040 Invertido 015/VF" },
  { identity: "ITEM:5inv028", codeIdentity: "5inv028", code: "5INV028", description: "SERVO MBF-040 Invertido 028" },
  { identity: "ITEM:7inv015", codeIdentity: "7inv015", code: "7INV015", description: "SERVO BR-040 Invertido 015/VF" },
  { identity: "ITEM:7inv028", codeIdentity: "7inv028", code: "7INV028", description: "SERVO BR-040 Invertido 028" },
  { identity: "ITEM:9inv", codeIdentity: "9inv", code: "9INV", description: "SERVO MBF-032 Invertido 028" },
  ...catalog,
];
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

test("separadores de INV são normalizados só para consulta e famílias conhecidas ficam ambíguas", () => {
  for (const [family, variants] of [
    ["5", ["5INV015", "5INV028"]],
    ["7", ["7INV015", "7INV028"]],
  ]) {
    for (const code of [`${family}-INV`, `${family} INV`, `${family}INV`]) {
      const resolution = resolveSupplierOrderPhotoCatalogCode(invertedCatalog, code);
      assert.equal(resolution.kind, "AMBIGUOUS", code);
      assert.deepEqual(resolution.candidates.map((candidate) => candidate.code), variants, code);
      assert.equal(assessSupplierOrderPhotoLoosePartCode(invertedCatalog, code).allowed, false, code);
    }
  }
});

test("código INV oficial equivalente prevalece antes da busca por família", async () => {
  for (const [rawCode, officialCode] of [["1-INV", "1INV"], ["9-INV", "9INV"]]) {
    const resolution = resolveSupplierOrderPhotoCatalogCode(invertedCatalog, rawCode);
    assert.equal(resolution.kind, "FOUND");
    assert.equal(resolution.target.code, officialCode);
    const extraction = structuredClone(base);
    extraction.lines[0] = {
      rawCode, rawDescription: resolution.target.description,
      quantity: 1, needsReview: false, warning: null,
    };
    const block = await interpretSupplierOrderPhoto({
      ...dependencies(extraction),
      loadCatalog: async () => invertedCatalog,
    });
    assert.equal(block.lines[0].displayCode, officialCode);
    assert.equal(block.lines[0].resolution, "IDENTIFIED");
  }
  assert.equal(resolveSupplierOrderPhotoCatalogCode(invertedCatalog, "10A").target.code, "10A");
});

test("prévia exige escolha manual entre 015 e 028 e a escolha remove o bloqueio", async () => {
  const extraction = structuredClone(base);
  extraction.lines[0] = {
    rawCode: "5-INV", rawDescription: "SERVO MBF-040 INVERTIDO",
    quantity: 2, needsReview: false, warning: null,
  };
  const block = await interpretSupplierOrderPhoto({
    ...dependencies(extraction),
    loadCatalog: async () => invertedCatalog,
  });
  assert.deepEqual(block.lines[0].blockingReasons, ["CODE_AMBIGUOUS"]);
  assert.deepEqual(block.lines[0].catalogOptions.map((option) => option.code), ["5INV015", "5INV028"]);
  for (const option of block.lines[0].catalogOptions) {
    const updated = updateSupplierOrderPhotoPreviewLine(block, 0, option);
    assert.equal(updated.lines[0].displayCode, option.code);
    assert.equal(updated.lines[0].description, option.description);
    assert.equal(updated.lines[0].resolution, "IDENTIFIED");
    assert.equal(updated.lines[0].blockingReasons.includes("CODE_AMBIGUOUS"), false);
  }
});

test("somente código genuinamente desconhecido permanece elegível para peça avulsa", () => {
  assert.equal(assessSupplierOrderPhotoLoosePartCode(invertedCatalog, "5 INV").allowed, false);
  assert.equal(assessSupplierOrderPhotoLoosePartCode(invertedCatalog, "7-INV").allowed, false);
  assert.equal(assessSupplierOrderPhotoLoosePartCode(invertedCatalog, "P123").allowed, true);
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
  assert.match(createRoute, /assessSupplierOrderPhotoLoosePartCode/);
  assert.match(createRoute, /\.rpc\("create_loose_part"/);
  assert.ok(
    createRoute.lastIndexOf("assessSupplierOrderPhotoLoosePartCode") < createRoute.indexOf('.rpc("create_loose_part"'),
    "o preflight de catálogo deve ocorrer antes da RPC",
  );
  assert.doesNotMatch(resolveRoute + createRoute, /Gemini|create_supplier_order|stock_inbound|movement_batch/);
});

test("UI C3B mantém modal/bottom sheet e bloqueio de duplo clique junto da criação segura", () => {
  const view = readFileSync(new URL("../components/assistant-structured-block.tsx", import.meta.url), "utf8");
  assert.match(view, /Cadastrar peça avulsa/);
  assert.match(view, /Definir produto/);
  assert.match(view, /line\.catalogOptions\.map/);
  assert.match(view, /const canCreateDirectly = line\.blockingReasons\.includes\("CODE_NOT_FOUND"\)/);
  assert.match(view, /role="dialog"/);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, /items-end[\s\S]*sm:items-center/);
  assert.match(view, /if \(!dialog \|\| submitInFlightRef\.current \|\| !onUpdate\) return/);
  assert.match(view, /"Criar Pedido"/);
  assert.match(view, /prepare-create/);
  assert.match(view, /confirm-create/);
});
