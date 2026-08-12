import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPath = "supabase/migrations/20260812023500_atomic_supplier_order_pickup_stock_entry.sql";
const sql = read(migrationPath);

function section(start, end) {
  const from = sql.indexOf(start);
  const to = end ? sql.indexOf(end, from + start.length) : sql.length;
  assert.ok(from >= 0, `Missing section: ${start}`);
  assert.ok(to > from, `Invalid section end: ${end}`);
  return sql.slice(from, to);
}

test("creates one private shared physical primitive with minimal exposure", () => {
  const core = section(
    "create function private.apply_supplier_order_stock_entry",
    "create or replace function private.create_supplier_order_stock_entry",
  );
  assert.match(core, /security invoker/i);
  assert.match(core, /set search_path = ''/i);
  assert.match(core, /private\.stock_inbound_lines\(/i);
  assert.match(core, /insert into public\.supplier_order_stock_entries/i);
  assert.match(core, /insert into public\.supplier_order_stock_entry_lines/i);
  assert.match(core, /set stocked_quantity\s*=/i);
  assert.doesNotMatch(core, /insert into public\.supplier_order_events/i);
  assert.match(sql, /revoke all on function private\.apply_supplier_order_stock_entry[\s\S]*from public, anon, authenticated/i);
});

test("keeps standalone backlog entry and its independent event contract", () => {
  const standalone = section(
    "create or replace function private.create_supplier_order_stock_entry",
    "create or replace function private.set_supplier_order_item_picked_quantity",
  );
  assert.match(standalone, /private\.supplier_order_existing_result\([\s\S]*'STOCK_ENTRY_CREATED'/i);
  assert.match(standalone, /private\.apply_supplier_order_stock_entry\(/i);
  assert.match(standalone, /'STOCK_ENTRY_CREATED'/i);
  assert.match(standalone, /p_expected_updated_at/i);
});

test("individual pickup rejects reduction and stocks only its positive delta", () => {
  const pickup = section(
    "create or replace function private.set_supplier_order_item_picked_quantity",
    "create or replace function private.mark_supplier_order_all_picked",
  );
  assert.match(pickup, /p_picked_quantity < v_line\.picked_quantity/i);
  assert.match(pickup, /picked_quantity cannot be reduced/i);
  assert.match(pickup, /p_picked_quantity > v_line\.ready_quantity/i);
  assert.match(pickup, /v_delta := p_picked_quantity - v_previous_quantity/i);
  assert.match(pickup, /if v_delta > 0 then[\s\S]*private\.apply_supplier_order_stock_entry/i);
  assert.match(pickup, /jsonb_build_object\([\s\S]*'quantity', v_delta/i);
  assert.doesNotMatch(pickup, /picked_quantity - stocked_quantity/i);
  assert.match(pickup, /'PICKED_QUANTITY_CHANGED'/i);
  assert.doesNotMatch(pickup, /'STOCK_ENTRY_CREATED'/i);
});

test("mark all creates one batch from ready-only per-line deltas", () => {
  const markAll = section(
    "create or replace function private.mark_supplier_order_all_picked",
    "revoke all on function private.apply_supplier_order_stock_entry",
  );
  assert.match(markAll, /ready_quantity - order_item\.picked_quantity/i);
  assert.match(markAll, /where order_item\.ready_quantity > order_item\.picked_quantity/i);
  assert.equal((markAll.match(/private\.apply_supplier_order_stock_entry\(/gi) ?? []).length, 1);
  assert.match(markAll, /'ALL_ITEMS_MARKED_PICKED'/i);
  assert.doesNotMatch(markAll, /'STOCK_ENTRY_CREATED'/i);
  assert.match(markAll, /'added_picked_quantity', v_added_picked_quantity/i);
});

test("preserves public signatures by replacing private workers only", () => {
  assert.doesNotMatch(sql, /create or replace function public\./i);
  assert.doesNotMatch(sql, /drop function/i);
  assert.doesNotMatch(sql, /grant execute on function public\./i);
});

test("contains no remote or destructive deployment command", () => {
  assert.doesNotMatch(sql, /supabase\s+(db push|migration repair|db reset)/i);
  assert.doesNotMatch(sql, /isdjboconmwaqipjrjvp/i);
  assert.doesNotMatch(sql, /service[_-]?role|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(sql, /truncate\s+table/i);
});
