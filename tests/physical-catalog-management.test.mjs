import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { catalogPostCommitMatches, parsePhysicalCatalogSnapshot, validatePhysicalCatalogRequest } from "../lib/physical-catalog-management.ts";
import { managePhysicalCatalog, loadPhysicalCatalogPreview } from "../app/(authenticated)/estoque/catalog-actions.ts";
import { PhysicalCatalogDialog, PhysicalCatalogCreateButton } from "../components/physical-catalog-dialog.tsx";
import { InventoryRowActions } from "../components/inventory-row-actions.tsx";

const id = "95000000-0000-4000-8000-000000000001", key = "95000000-0000-4000-8000-000000000002";
const snapshot = { id, code: "NK95", description: "Peça de teste", itemType: "LOOSE_PART", isActive: true, model: null, quantity: 15, version: "a".repeat(32), dependencies: { configurations: 0, recipes: 0, compatibilities: 0, applications: 0, pendingOrders: 0 } };
const request = { operation: "ARCHIVE", itemId: id, expectedVersion: snapshot.version, expectedQuantity: 15, reason: "Cadastro incorreto" };
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
let calls, receipt, fresh, error, active;
beforeEach(() => {
  calls = []; active = true; error = null;
  fresh = { ...snapshot, isActive: false, quantity: 0 };
  receipt = { operation: "ARCHIVE", item: fresh, idempotentReplay: false };
  globalThis.__NK95_INVALIDATIONS__ = 0; globalThis.__NK72_PATHS__ = []; globalThis.__NK72_MENU_OPEN__ = true;
  globalThis.__NK72_CLIENT__ = {
    auth: { async getClaims() { return { data: active ? { claims: { sub: id } } : null, error: null }; } },
    from(table) { assert.equal(table, "profiles"); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: active ? { id } : null, error: null }; } }; },
    async rpc(name, args) { calls.push({ name, args }); return name === "manage_physical_catalog" ? { data: error ? null : receipt, error } : { data: fresh, error: null }; },
  };
});
test("snapshot validates identity, fixed type, balance, dependencies and concurrency token", () => {
  assert.deepEqual(parsePhysicalCatalogSnapshot(snapshot), snapshot);
  for (const bad of [null, {}, { ...snapshot, itemType: "__proto__" }, { ...snapshot, quantity: -1 }, { ...snapshot, version: "bad" }, { ...snapshot, dependencies: {} }]) assert.equal(parsePhysicalCatalogSnapshot(bad), null);
});
test("create/edit/archive input validation; category is never mutable", () => {
  assert.equal(validatePhysicalCatalogRequest(request), null);
  for (const bad of [{ ...request, expectedQuantity: -1 }, { ...request, reason: "" }, { ...request, expectedVersion: "bad" }, { operation: "CREATE", itemType: "SERVO", code: "X", description: "X", reason: "X" }, { operation: "CREATE", itemType: "__proto__", code: "X", description: "X", reason: "X" }]) assert.equal(typeof validatePhysicalCatalogRequest(bad), "string");
});
test("successful archive requires canonical RPC AND fresh post-commit inactive/zero verification", async () => {
  const result = await managePhysicalCatalog(request, key); assert.equal(result.ok, true);
  assert.deepEqual(calls.map(c => c.name), ["manage_physical_catalog", "get_physical_catalog_item_preview"]);
  assert.deepEqual(calls[0].args, { p_request: request, p_idempotency_key: key });
  assert.equal(globalThis.__NK95_INVALIDATIONS__, 1);
  for (const path of ["/estoque", "/entrada", "/saida", "/", "/relatorio-estoque"]) assert.ok(globalThis.__NK72_PATHS__.includes(path));
});
test("bad receipt, false success/readback mismatch and transport interruption stay uncertain", async () => {
  fresh = snapshot; let result = await managePhysicalCatalog(request, key); assert.equal(result.ok, false); assert.equal(result.uncertain, true);
  receipt = {}; result = await managePhysicalCatalog(request, key); assert.equal(result.ok, false); assert.equal(result.uncertain, true);
  globalThis.__NK72_CLIENT__.rpc = async () => { throw Error("network"); };
  result = await managePhysicalCatalog(request, key); assert.equal(result.uncertain, true);
});
test("stale and dependency errors produce no success or implicit retry", async () => {
  error = { code: "40001", message: "catalog_item_stale" }; let result = await managePhysicalCatalog(request, key);
  assert.equal(result.stale, true); assert.equal(calls.length, 1); assert.equal(globalThis.__NK95_INVALIDATIONS__, 0);
  error = { code: "23514", message: "catalog_item_has_dependencies" }; result = await managePhysicalCatalog(request, key);
  assert.match(result.error, /bloqueada/); assert.equal(result.ok, false);
});
test("same-key retry stays same-key; completed replay reverified before success", async () => {
  error = { code: "PGRST000", message: "transport" }; assert.equal((await managePhysicalCatalog(request, key)).uncertain, true);
  error = null; receipt = { ...receipt, idempotentReplay: true };
  assert.equal((await managePhysicalCatalog(request, key)).ok, true);
  assert.equal(calls.filter(c => c.name === "manage_physical_catalog").every(c => c.args.p_idempotency_key === key), true);
});
test("auth and input validation fail closed before RPC; preview is read-only", async () => {
  active = false; assert.equal((await managePhysicalCatalog(request, key)).ok, false); assert.equal(calls.length, 0);
  active = true; assert.equal((await managePhysicalCatalog({ ...request, reason: "" }, key)).ok, false); assert.equal(calls.length, 0);
  assert.equal((await loadPhysicalCatalogPreview(id)).ok, true); assert.deepEqual(calls.map(c => c.name), ["get_physical_catalog_item_preview"]);
});
test("metadata post-commit verification allows genuine concurrent stock changes, not changed metadata", () => {
  const r = { operation: "EDIT", item: snapshot };
  assert.equal(catalogPostCommitMatches(r, { ...snapshot, quantity: 16 }), true);
  assert.equal(catalogPostCommitMatches(r, { ...snapshot, code: "OTHER" }), false);
});
for (const itemType of ["SERVO", "INSTALLATION_KIT", "REPAIR_KIT", "LOOSE_PART"]) test(`${itemType} create button/form render fixed category, safe zero stock and cancel`, () => {
  const button = renderToStaticMarkup(h(PhysicalCatalogCreateButton, { servoOptions: [] })); assert.match(button, /Cadastrar produto/); assert.match(button, /min-h-11/);
  const form = renderToStaticMarkup(h(PhysicalCatalogDialog, { operation: "CREATE", itemType, onClose() {}, onSuccess() {} }));
  assert.match(form, /role="dialog"/); assert.match(form, /aria-modal="true"/); assert.match(form, /Cadastro sem movimentação/);
  assert.match(form, /Cancelar/); assert.match(form, /Revisar alteração/); assert.doesNotMatch(form, /type="number"/);
  if (itemType === "SERVO") assert.match(form, /Modelo do Servo/);
  if (itemType === "REPAIR_KIT") assert.match(form, /Nenhuma é presumida/);
});
test("item menu adds catalog actions without modifying configuration/bundle controls", () => {
  const item = { kind: "ITEM", itemId: id, code: "NK95", description: "Fixture", itemType: "LOOSE_PART", looseQuantity: 15, mountedQuantity: 0, minimumStock: 0 };
  const html = renderToStaticMarkup(h(InventoryRowActions, { target: item }));
  assert.match(html, /Editar código\/descrição/); assert.match(html, /Excluir produto/); assert.match(html, /Venda/);
  const bundle = renderToStaticMarkup(h(InventoryRowActions, { target: { kind: "BUNDLE", bundleId: id, commercialCodes: ["1HC"], description: "Fixture" } }));
  assert.doesNotMatch(bundle, /Excluir produto|Editar código\/descrição/); assert.match(bundle, /Montar/);
});
test("UI gates double submit, fresh preview, stale refresh, immutable uncertain attempt and lifecycle", () => {
  const ui = read("components/physical-catalog-dialog.tsx");
  assert.match(ui, /loadPhysicalCatalogPreview\(itemId\)/); assert.match(ui, /attempt\.current \?\?=/);
  assert.match(ui, /currentAttempt\.request, currentAttempt\.key/); assert.match(ui, /useRouteMutation\(/);
  assert.match(ui, /if \(isPending \|\| blocked \|\| stale \|\| loading\) return/);
  assert.match(ui, /useSemanticTransient\(open, close, pending\)/); assert.match(ui, /useRouteTransientCleanup/);
  assert.match(ui, /Atualizar prévia/); assert.match(ui, /useAccessibleDialog/);
  assert.match(ui, /if \(!loading && !review\) inputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(ui, /\.from\(|\.rpc\(|popstate|localStorage|item_type.*select/);
});
test("forward-only SQL composes canonical adjustment and preserves immutable physical identity", () => {
  const sql = read("supabase/migrations/20261022200954_physical_catalog_management.sql");
  assert.match(sql, /private\.adjust_inventory_stock_checked\('ITEM'/); assert.match(sql, /set is_active = false/);
  assert.match(sql, /for no key update/); assert.match(sql, /where item_id = v_id for update/);
  assert.match(sql, /stock_balance_active_catalog_guard/); assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /delete from public\.|update public\.(stock_balances|supplier_order_items)|set item_type|set servo_id|set installation_kit_id/);
  const ui = read("app/(authenticated)/estoque/inventory-workspace.tsx");
  assert.equal((ui.match(/<PhysicalCatalogCreateButton\b/g) ?? []).length, 1);
  assert.doesNotMatch(ui, /headerAction|itemType=\{group\.itemType\}/);
  assert.match(ui, /onCatalogSuccess=\{handleCatalogSuccess\}/);
  assert.match(ui, /catalogFeedback \? <div role="status"/);
});
