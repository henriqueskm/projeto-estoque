import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareSupplierOrderPhotoCreate, confirmSupplierOrderPhotoCreate } from "../lib/assistant-supplier-order-photo-create.ts";
import { createSupplierOrderPhotoCreateProposalToken, verifySupplierOrderPhotoCreateProposalToken } from "../lib/ai/supplier-order-photo-create-token.ts";
import {
  confirmSupplierOrderPhotoVisualReview, supplierOrderPhotoLineCanConfirmVisualReview,
  updateSupplierOrderPhotoPreviewLine, updateSupplierOrderPhotoPreviewQuantity,
  updateSupplierOrderPhotoPreviewHeader,
} from "../lib/assistant-supplier-order-photo-preview.ts";
import { createSupplierOrderPhotoPrepareInputFromPreview, supplierOrderPhotoPreviewCanCreate } from "../lib/assistant-supplier-order-photo-create-contract.ts";
import { parseAssistantSupplierOrderPhotoPreviewBlock } from "../lib/assistant-supplier-order-photo-contract.ts";
import { photoReviewFixture } from "./fixtures/assistant-photo-review.ts";

test("five lines: explicit visual acknowledgement unlocks the same preview without AI or mutation", () => {
  const before = photoReviewFixture(), snapshot = structuredClone(before);
  assert.equal(supplierOrderPhotoPreviewCanCreate(before), false);
  assert.equal(supplierOrderPhotoLineCanConfirmVisualReview(before, 4), true);
  const after = confirmSupplierOrderPhotoVisualReview(before, 4);
  assert.deepEqual(before, snapshot);
  assert.equal(after.state, "READY_FOR_REVIEW");
  assert.equal(after.lines[4].resolution, "IDENTIFIED");
  assert.deepEqual(after.lines[4].blockingReasons, []);
  assert.equal(after.totalQuantity, 11);
  assert.deepEqual(parseAssistantSupplierOrderPhotoPreviewBlock(after), after);
  assert.equal(createSupplierOrderPhotoPrepareInputFromPreview(after).lines.length, 5);
  assert.deepEqual(confirmSupplierOrderPhotoVisualReview(after, 4), after);
});

for (const reason of ["CODE_UNCERTAIN", "CODE_AMBIGUOUS", "CODE_MISSING", "CODE_NOT_FOUND", "DESCRIPTION_CONFLICT", "QUANTITY_MISSING"]) {
  test(`generic visual confirmation cannot remove ${reason}`, () => {
    const block = photoReviewFixture(); block.lines[4].blockingReasons.push(reason);
    assert.equal(supplierOrderPhotoLineCanConfirmVisualReview(block, 4), false);
    assert.equal(confirmSupplierOrderPhotoVisualReview(block, 4), block);
    assert.equal(supplierOrderPhotoPreviewCanCreate(block), false);
  });
}

for (const quantity of [null, 0, -1, 1.5, 2147483648, NaN, Infinity]) test(`invalid quantity ${quantity} cannot be acknowledged or saved`, () => {
  const block = photoReviewFixture(); block.lines[4].quantity = quantity;
  assert.equal(supplierOrderPhotoLineCanConfirmVisualReview(block, 4), false);
  assert.equal(confirmSupplierOrderPhotoVisualReview(block, 4), block);
  assert.equal(updateSupplierOrderPhotoPreviewQuantity(block, 4, quantity), block);
});

test("quantity correction changes totals but never acknowledges visual or product doubt", () => {
  const block = photoReviewFixture(); block.lines[4].quantity = null;
  block.lines[4].blockingReasons.push("QUANTITY_MISSING", "CODE_UNCERTAIN");
  const after = updateSupplierOrderPhotoPreviewQuantity(block, 4, 7);
  assert.equal(after.totalQuantity, 14);
  assert.deepEqual(after.lines[4].blockingReasons, ["VISUAL_REVIEW", "CODE_UNCERTAIN"]);
  assert.equal(after.state, "NEEDS_REVIEW");
  assert.equal(confirmSupplierOrderPhotoVisualReview(after, 4), after);
});

test("official code correction preserves original visual warning until explicit acknowledgement", () => {
  const block = photoReviewFixture(); block.lines[4].blockingReasons.push("CODE_UNCERTAIN", "DESCRIPTION_CONFLICT");
  const after = updateSupplierOrderPhotoPreviewLine(block, 4, { code: "FIX-06", description: "Outro produto oficial fictício" });
  assert.deepEqual(after.lines[4].blockingReasons, ["VISUAL_REVIEW"]);
  assert.equal(after.lines[4].warning, block.lines[4].warning);
  assert.equal(after.state, "NEEDS_REVIEW");
  assert.equal(confirmSupplierOrderPhotoVisualReview(after, 4).state, "READY_FOR_REVIEW");
});

test("several pending lines require individual confirmation; header edits cannot clear blockers", () => {
  const block = photoReviewFixture(); block.lines[0].blockingReasons = ["VISUAL_REVIEW"]; block.lines[0].resolution = "NEEDS_REVIEW";
  const one = confirmSupplierOrderPhotoVisualReview(block, 4);
  assert.equal(one.state, "NEEDS_REVIEW");
  const header = updateSupplierOrderPhotoPreviewHeader(one, "000123", "2026-10-24");
  assert.equal(header.state, "NEEDS_REVIEW");
  assert.equal(confirmSupplierOrderPhotoVisualReview(header, 0).state, "READY_FOR_REVIEW");
});

test("header needs a real date and numeric negotiation, including preserved leading zeros", () => {
  let block = confirmSupplierOrderPhotoVisualReview(photoReviewFixture(), 4);
  block = { ...block, orderDate: null, negotiationNumber: null, state: "NEEDS_REVIEW" };
  for (const [number, date] of [["12x", "2026-10-23"], ["123", "2026-02-30"], ["", "2026-10-23"]]) {
    assert.equal(updateSupplierOrderPhotoPreviewHeader(block, number, date), block);
  }
  const after = updateSupplierOrderPhotoPreviewHeader(block, " 000123 ", "2026-10-23");
  assert.equal(after.negotiationNumber, "000123");
  assert.equal(after.state, "READY_FOR_REVIEW");
  assert.equal(after.totalQuantity, 11);
});

for (const state of ["DUPLICATE_NEGOTIATION", "UNREADABLE", "NOT_A_SUPPLIER_ORDER", "ERROR"]) test(`${state} cannot become ready by editing a stale preview`, () => {
  const block = { ...photoReviewFixture(), state };
  assert.equal(confirmSupplierOrderPhotoVisualReview(block, 4), block);
  assert.equal(updateSupplierOrderPhotoPreviewQuantity(block, 4, 2), block);
  assert.equal(updateSupplierOrderPhotoPreviewLine(block, 4, { code: "X", description: "Y" }), block);
  assert.equal(updateSupplierOrderPhotoPreviewHeader(block, "123", "2026-10-23"), block);
});

test("missing official identity and duplicate order cannot be confirmed", () => {
  for (const patch of [{ displayCode: null }, { description: null }, { descriptionMatch: "CONFLICT" }]) {
    const block = photoReviewFixture(); Object.assign(block.lines[4], patch);
    assert.equal(confirmSupplierOrderPhotoVisualReview(block, 4), block);
  }
  const block = photoReviewFixture(); block.existingOrder = { negotiationNumber: "00900123", status: "PENDING", href: "/pedidos" };
  assert.equal(confirmSupplierOrderPhotoVisualReview(block, 4), block);
  assert.equal(confirmSupplierOrderPhotoVisualReview(photoReviewFixture(), 100).state, "NEEDS_REVIEW");
});

test("review -> prepare -> explicit confirmation revalidates the catalog, signs HMAC and replays the same writer key", async () => {
  const reviewed = confirmSupplierOrderPhotoVisualReview(photoReviewFixture(), 4);
  const catalog = reviewed.lines.map((line, index) => ({
    identity: `ITEM:${index}`, codeIdentity: String(index), kind: "ITEM",
    targetId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    commercialConfigurationCodeId: null, code: line.displayCode, description: `Descrição OFICIAL ${index}`,
  }));
  const user = "11111111-1111-4111-8111-111111111111", key = "22222222-2222-4222-8222-222222222222";
  const secret = "synthetic-test-secret-not-a-real-credential".repeat(2), now = new Date("2026-10-23T12:00:00Z");
  let loads = 0, writes = 0;
  const inputs = [], receipts = new Map();
  const loadCatalog = async () => { loads++; return catalog; };
  const prepared = await prepareSupplierOrderPhotoCreate(createSupplierOrderPhotoPrepareInputFromPreview(reviewed), user, {
    loadCatalog, findExistingOrder: async () => null, createIdempotencyKey: () => key,
    createProposal: input => createSupplierOrderPhotoCreateProposalToken(input, secret, now),
  });
  assert.equal(prepared.ok, true); assert.equal(writes, 0); assert.equal(loads, 1);
  assert.equal(prepared.preparation.lines[0].description, "Descrição OFICIAL 0");
  const deps = {
    loadCatalog, findExistingOrder: async () => null,
    verifyProposal: (token, expectedUser) => verifySupplierOrderPhotoCreateProposalToken(token, secret, expectedUser, now),
    createOrder: async input => {
      inputs.push(input);
      if (!receipts.has(input.idempotency_key)) {
        writes++;
        receipts.set(input.idempotency_key, { supplierOrderId: key, negotiationNumber: reviewed.negotiationNumber, status: "PENDING", lineCount: 5, orderedQuantity: 11 });
      }
      return { ok: true, receipt: receipts.get(input.idempotency_key) };
    },
  };
  const first = await confirmSupplierOrderPhotoCreate(prepared.preparation.proposalToken, user, deps);
  const retry = await confirmSupplierOrderPhotoCreate(prepared.preparation.proposalToken, user, deps);
  assert.equal(first.ok, true); assert.deepEqual(retry, first); assert.equal(writes, 1); assert.equal(loads, 3);
  assert.equal(inputs[0].idempotency_key, key); assert.equal(inputs[0].notes, null);
  assert.equal(JSON.stringify(inputs).includes("manuscrita"), false);
  const changed = await confirmSupplierOrderPhotoCreate(prepared.preparation.proposalToken, user, { ...deps, loadCatalog: async () => [] });
  assert.equal(changed.code, "CATALOG_CHANGED"); assert.equal(writes, 1);
});

test("review UI uses accessible mobile controls, transient Back/Activity and the unchanged canonical creation endpoints", () => {
  const view = readFileSync(new URL("../components/assistant-structured-block.tsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../components/assistant-photo-review-dialog.tsx", import.meta.url), "utf8");
  assert.match(view, /Revisar primeiro item pendente/);
  assert.match(view, /aria-label=\{`Revisar item/);
  assert.match(view, /supplierOrderPhotoLineCanConfirmVisualReview\(block, reviewLineIndex\)/);
  assert.match(view, /if \(!isCurrentVisit\(\)\) return/);
  assert.match(view, /useSemanticTransient\(Boolean\(createProposal\), closeCreateDialog, isConfirmingCreate\)/);
  for (const text of ["Confirmar produto e quantidade", "Corrigir produto", "Salvar quantidade"]) assert.ok(dialog.includes(text));
  assert.match(dialog, /min-h-11/); assert.match(dialog, /inputMode="numeric"/);
  assert.match(dialog, /aria-modal="true"/); assert.match(dialog, /aria-describedby=/);
  assert.match(dialog, /useSemanticTransient\(true, onClose\)/);
  assert.match(dialog, /useRouteTransientCleanup\(onClose\)/);
  assert.match(dialog, /event\.key === "Escape"/); assert.match(dialog, /event\.key !== "Tab"/);
  assert.doesNotMatch(dialog, /fetch\(|\.rpc\(|localStorage|proposalToken|confirm-create/);
});
