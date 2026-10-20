import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { updateSupplierOrder } from "../app/(authenticated)/pedidos/actions.ts";
import { supplierOrderEditMatches } from "../lib/supplier-order-edit-verification.ts";
import { buildSupplierOrderFormLines } from "../lib/supplier-order-form-lines.ts";

const uid = n => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const version = "2026-10-20T12:00:00.123456+00:00";
const line = { id: uid(3), kind: "ITEM", item_id: uid(4), quantity: 10, notes: null };
const added = { kind: "COMMERCIAL_CONFIGURATION", commercial_configuration_id: uid(5), commercial_configuration_code_id: uid(6), quantity: 3, notes: "fixture alias" };
const input = () => ({ supplier_order_id: uid(1), expected_updated_at: version, negotiation_number: "910001", order_date: "2026-10-20", notes: null,
  lines: [line, added], idempotency_key: uid(2) });
const saved = request => ({ id: request.supplier_order_id, negotiation_number: request.negotiation_number, order_date: request.order_date, notes: request.notes,
  supplier_order_items: request.lines.map((l, i) => ({ id: l.id ?? uid(10+i), item_id: l.item_id ?? null,
    commercial_configuration_id: l.commercial_configuration_id ?? null, commercial_configuration_code_id: l.commercial_configuration_code_id ?? null,
    ordered_quantity: l.quantity, notes: l.notes, position: i })) });
const receipt = () => ({ supplier_order_id: uid(1), negotiation_number: "910001", line_count: 2, ordered_quantity: 13,
  picked_quantity: 0, cancelled_quantity: 0, waiting_pickup_quantity: 13, stocked_quantity: 0, waiting_stock_quantity: 0,
  pickup_percentage: 0, status: "PENDING", updated_at: version });
let calls, logs, persisted, returned, rpcError, readError, active, throws;
const originalWarn = console.warn;
test.beforeEach(() => {
  calls = []; logs = []; persisted = saved(input()); returned = receipt(); rpcError = null; readError = null; active = true; throws = false;
  globalThis.__nk57RevalidatedPaths = []; globalThis.__nk57Pushes = [];
  console.warn = (...args) => logs.push(args);
  globalThis.__nk57SupabaseClient = {
    auth: { getClaims: async () => ({ data: { claims: { sub: uid(99) } } }) },
    from(table) {
      assert.ok(["profiles", "supplier_orders"].includes(table));
      const query = { select() { return query; }, eq() { return query; },
        async maybeSingle() { return table === "profiles" ? { data: active ? { id: uid(99), name: "Fixture" } : null, error: null }
          : { data: persisted, error: readError }; } };
      return query;
    },
    async rpc(name, args) { assert.equal(name, "update_supplier_order"); calls.push(args);
      if (throws) throw Error("private secret order description"); return { data: returned, error: rpcError }; },
  };
});
test.afterEach(() => { console.warn = originalWarn; delete globalThis.__nk57SupabaseClient; });

test("form keeps existing IDs, omits new ITEM/config IDs, exact alias and all lines", () => {
  const form = [{ existingId: uid(3), kind: "ITEM", itemId: uid(4), configurationId: null, commercialCodeId: null,
    quantity: 10, notes: "", readyQuantity: 2, pickedQuantity: 1, cancelledQuantity: 0 },
  { existingId: null, kind: "COMMERCIAL_CONFIGURATION", itemId: null, configurationId: uid(5), commercialCodeId: uid(6),
    quantity: 3, notes: " fixture alias ", readyQuantity: 0, pickedQuantity: 0, cancelledQuantity: 0 },
  { existingId: null, kind: "ITEM", itemId: uid(7), configurationId: null, commercialCodeId: null,
    quantity: 2, notes: "", readyQuantity: 0, pickedQuantity: 0, cancelledQuantity: 0 }];
  const result = buildSupplierOrderFormLines(form);
  assert.deepEqual(result, [line, added, { kind: "ITEM", item_id: uid(7), quantity: 2, notes: null }]);
  assert.equal("id" in result[1], false); assert.equal("id" in result[2], false);
  assert.equal(buildSupplierOrderFormLines([{ ...form[0], quantity: 1 }]), null, "cannot shrink below ready");
  assert.equal(buildSupplierOrderFormLines([]), null);
});
test("update sends complete normalized payload/version/key and succeeds only after consistent read", async () => {
  const result = await updateSupplierOrder(input()); assert.equal(result.ok, true);
  assert.deepEqual(calls[0].p_lines, input().lines); assert.equal(calls[0].p_expected_updated_at, version); assert.equal(calls[0].p_idempotency_key, uid(2));
  assert.deepEqual(globalThis.__nk57RevalidatedPaths, ["/pedidos"]); assert.deepEqual(globalThis.__nk57Pushes, []); assert.deepEqual(logs, []);
});
test("deployed-bug receipt losing new lines is NOT reported as success", async () => {
  returned = { ...receipt(), line_count: 1, ordered_quantity: 10 }; persisted.supplier_order_items.pop();
  const result = await updateSupplierOrder(input()); assert.equal(result.ok, false); assert.match(result.error, /rascunho foi mantido/i);
  assert.deepEqual(globalThis.__nk57RevalidatedPaths, []); assert.equal(logs[0][1].stage, "receipt");
});
for (const corruption of ["missing", "target", "alias", "notes", "quantity", "position", "header"]) {
  test(`read-back ${corruption} mismatch cannot produce false success`, async () => {
    if (corruption === "missing") persisted.supplier_order_items.pop();
    if (corruption === "target") persisted.supplier_order_items[0].item_id = uid(70);
    if (corruption === "alias") persisted.supplier_order_items[1].commercial_configuration_code_id = uid(70);
    if (corruption === "notes") persisted.supplier_order_items[0].notes = "changed";
    if (corruption === "quantity") persisted.supplier_order_items[0].ordered_quantity = 1;
    if (corruption === "position") persisted.supplier_order_items[0].position = 10;
    if (corruption === "header") persisted.notes = "different";
    assert.equal(supplierOrderEditMatches(input(), persisted), false);
    const result = await updateSupplierOrder(input()); assert.equal(result.ok, false); assert.deepEqual(globalThis.__nk57RevalidatedPaths, []);
  });
}
test("stale and inactive profile do not produce success or revalidation; logs omit private fields", async () => {
  rpcError = { code: "40001", message: "private secret order changed after it was loaded" };
  const stale = await updateSupplierOrder(input()); assert.equal(stale.ok, false); assert.equal(stale.stale, true);
  assert.equal(logs[0][1].sqlstate, "40001"); assert.equal(logs[0][1].stage, "rpc");
  active = false; calls = []; assert.equal((await updateSupplierOrder(input())).ok, false); assert.equal(calls.length, 0);
  assert.doesNotMatch(JSON.stringify(logs), /private|secret|910001|91000000|fixture alias|2026-10-20/);
});
test("transport/read failure keeps the same key for retry and never revalidates as success", async () => {
  throws = true; assert.equal((await updateSupplierOrder(input())).ok, false);
  throws = false; readError = { code: "PGRST000", message: "private detail" }; assert.equal((await updateSupplierOrder(input())).ok, false);
  assert.equal(calls[0].p_idempotency_key, calls[1].p_idempotency_key);
  assert.deepEqual(globalThis.__nk57RevalidatedPaths, []); assert.doesNotMatch(JSON.stringify(logs), /private|secret/);
  readError = null; assert.equal((await updateSupplierOrder(input())).ok, true);
});
test("form preserves draft on stale/error, offers explicit reopen, and keeps route mutation gate", () => {
  const source = readFileSync(new URL("../app/(authenticated)/pedidos/orders-workspace.tsx", import.meta.url), "utf8");
  const form = source.slice(source.indexOf("function OrderFormDialog"), source.indexOf("function ConfirmationDialog"));
  assert.match(form, /buildSupplierOrderFormLines\(lines\)/); assert.match(form, /if \(isPending \|\| reloadRequired\) return/);
  assert.match(form, /setReloadRequired\(true\)/); assert.match(form, /Reabrir Pedido atualizado/);
  assert.match(form, /runMutation\(async/); assert.match(form, /if \(!result.ok\)/);
  const stale = form.slice(form.indexOf("if (result.stale)"), form.indexOf("setError(result.error)"));
  assert.doesNotMatch(stale, /onStale\(|onSaved\(|setLines\(/);
  assert.match(form, /item.readyQuantity > 0/); assert.match(form, /idempotencyKeyRef.current \?\? crypto.randomUUID/);
});
test("migration only replaces private writer; pre-edit delete scope and transactional persistence guard", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261020132636_fix_supplier_order_edit_line_persistence.sql", import.meta.url), "utf8");
  assert.match(sql, /existing_line.id = any\(v_existing_line_ids\)/);
  assert.ok(sql.indexOf("into v_existing_line_ids") < sql.indexOf("insert into public.supplier_order_items"));
  assert.ok(sql.indexOf("supplier_order_update_persistence_mismatch") < sql.indexOf("insert into public.supplier_order_events"));
  assert.match(sql, /errcode = '40001'/); assert.match(sql, /'ORDER_ITEMS_UPDATED'/);
  assert.doesNotMatch(sql, /disable trigger|session_replication_role|security definer|update public\.(?:stock_balances|configuration_stock_balances)|create or replace function public\./i);
});
test("Issue93: hotfix uses the already-applied version, without duplicate/old version or SQL edits", () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(directory).filter(name => name.endsWith(".sql"));
  assert.equal(files.length, new Set(files.map(name => name.slice(0, 14))).size);
  assert.deepEqual(files.filter(name => name.startsWith("20261020132636_")), ["20261020132636_fix_supplier_order_edit_line_persistence.sql"]);
  // Historical version must be absent, not a second pending migration.
  assert.equal(files.some(name => name.startsWith("20261020125349_")), false);
  const sql = readFileSync(new URL("20261020132636_fix_supplier_order_edit_line_persistence.sql", directory), "utf8");
  // Canonical Git bytes; also accepts Windows CRLF checkout conversion.
  assert.equal(createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex"),
    "157d1b21831698a4849da354c8d402b32141920b0090abeeb1b8328a774752dc");
});
