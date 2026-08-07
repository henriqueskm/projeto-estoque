import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260807091653_safisa_legacy_order_transition.sql",
  import.meta.url,
);
const sql = readFileSync(migrationPath, "utf8");

test("changes only the three canonical pickup workers", () => {
  const replacements = [
    ...sql.matchAll(/create or replace function\s+([^(\s]+)\s*\(/gi),
  ].map((match) => match[1].toLowerCase());

  assert.deepEqual(replacements, [
    "private.set_supplier_order_item_picked_quantity",
    "private.mark_supplier_order_all_picked",
    "private.mark_supplier_order_all_picked_checked",
  ]);
  assert.doesNotMatch(sql, /create\s+table|alter\s+table|drop\s+/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\./i);
});

test("uses authorization existence as the irreversible regime marker", () => {
  assert.match(
    sql,
    /select exists\s*\([\s\S]*?from public\.safisa_order_authorizations[\s\S]*?supplier_order_id = v_order_id[\s\S]*?into v_is_safisa_managed/i,
  );
  assert.match(
    sql,
    /select exists\s*\([\s\S]*?from public\.safisa_order_authorizations[\s\S]*?supplier_order_id = p_supplier_order_id[\s\S]*?into v_is_safisa_managed/i,
  );
  assert.doesNotMatch(
    sql,
    /order_authorization\.is_authorized\s*(?:=|is)/i,
  );
});

test("legacy single pickup atomically advances readiness without lowering it", () => {
  assert.match(
    sql,
    /else greatest\(v_line\.ready_quantity, p_picked_quantity\)/i,
  );
  assert.match(
    sql,
    /set[\s\S]*?picked_quantity = p_picked_quantity,[\s\S]*?ready_quantity = v_effective_ready_quantity/i,
  );
  assert.match(
    sql,
    /v_is_safisa_managed[\s\S]*?p_picked_quantity > v_line\.ready_quantity[\s\S]*?picked_quantity cannot exceed ready_quantity/i,
  );
});

test("bulk pickup preserves legacy remainder and managed ready-only behavior", () => {
  assert.match(
    sql,
    /when v_is_safisa_managed then order_item\.ready_quantity[\s\S]*?else order_item\.ordered_quantity - order_item\.cancelled_quantity/i,
  );
  assert.match(
    sql,
    /ready_quantity = case[\s\S]*?when v_is_safisa_managed then ready_quantity[\s\S]*?else greatest\(ready_quantity, ordered_quantity - cancelled_quantity\)/i,
  );
  assert.match(
    sql,
    /when v_is_safisa_managed[\s\S]*?ready_quantity - order_item\.picked_quantity[\s\S]*?else order_item\.ordered_quantity[\s\S]*?- order_item\.cancelled_quantity[\s\S]*?- order_item\.picked_quantity/i,
  );
});

test("preserves idempotency, lock order, audit, and hardened function modes", () => {
  assert.match(sql, /private\.supplier_order_existing_result/g);
  assert.match(
    sql,
    /from public\.supplier_orders[\s\S]*?for update[\s\S]*?from public\.supplier_order_items[\s\S]*?for update/i,
  );
  assert.match(sql, /insert into public\.supplier_order_events/i);
  assert.doesNotMatch(sql, /insert into public\.safisa_portal_events/i);
  assert.doesNotMatch(sql, /insert into public\.safisa_order_authorizations/i);
  assert.match(sql, /security invoker/g);
  assert.match(sql, /set search_path = ''/g);
});

test("contains no remote operation, seed identity, or mutable catalog action", () => {
  assert.doesNotMatch(sql, /supabase\s+(db push|migration repair|db reset)/i);
  assert.doesNotMatch(sql, /\b(auth\.users|profiles|stock_balances)\b[\s\S]*?\b(insert|update|delete)\b/i);
  assert.doesNotMatch(
    sql,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
});
