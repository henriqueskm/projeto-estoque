import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = resolve(
  repositoryRoot,
  "supabase",
  "migrations",
  "20260812133046_enforce_supplier_order_negotiation_identity.sql",
);
const migration = readFileSync(migrationPath, "utf8");

const legacyMappings = [
  ["26e08e22-a2fb-4e8d-8605-4ccdb57d4773", "teste 00", "99990000"],
  ["db02621b-b6c1-4e7a-8fef-b63fc3e60d50", "teste 01", "99990001"],
  ["e92bc06f-5721-4082-b77a-def6954e3300", "teste 03", "99990003"],
  ["af7a39f6-c4a2-4e92-b183-d8196aa775d1", "Teste 04", "99990004"],
];

test("migration contains only the four approved legacy mappings and guarded updates", () => {
  for (const [id, previous, next] of legacyMappings) {
    assert.match(migration, new RegExp(id, "i"));
    assert.match(migration, new RegExp(`'${previous}'`, "i"));
    assert.match(migration, new RegExp(`'${next}'`, "i"));
  }

  assert.equal(
    [...migration.matchAll(/'previous_negotiation_number'/g)].length,
    6,
  );
  assert.match(migration, /lock table public\.supplier_orders in share row exclusive mode/i);
  assert.match(migration, /where id = v_supplier_order_id\s+and negotiation_number = v_previous_negotiation_number/i);
  assert.doesNotMatch(migration, /delete from public\.supplier_orders/i);
  assert.doesNotMatch(migration, /insert into public\.supplier_orders/i);
});

test("migration preserves text identity and installs a global, non-partial unique constraint", () => {
  assert.match(
    migration,
    /negotiation_number ~ '\^\[0-9\]\+\$'/i,
  );
  assert.match(
    migration,
    /add constraint supplier_orders_negotiation_number_key\s+unique \(negotiation_number\)/i,
  );
  assert.doesNotMatch(
    migration,
    /supplier_orders_negotiation_number_key[\s\S]*?where\s*\(/i,
  );
  assert.doesNotMatch(migration, /alter column negotiation_number type/i);
  assert.doesNotMatch(migration, /regexp_replace|::(?:big)?int|cast\s*\(/i);
  assert.match(
    migration,
    /drop index public\.supplier_orders_negotiation_number_idx/i,
  );
});

test("technical audit events preserve old snapshots and record the explicit transition", () => {
  assert.match(migration, /'ORDER_HEADER_UPDATED'/);
  assert.match(migration, /'MIG-ORD-008A'/);
  assert.match(
    migration,
    /Legacy negotiation converted to numeric identity by MIG-ORD-008A\./,
  );
  assert.match(migration, /'reason', 'legacy_negotiation_identity_migration'/);
  assert.match(migration, /'previous_negotiation_number', v_previous_negotiation_number/);
  assert.match(migration, /'new_negotiation_number', v_new_negotiation_number/);
  assert.doesNotMatch(migration, /update public\.supplier_order_events/i);
});

test("official wrappers preserve signatures and sanitize only negotiation constraints", () => {
  assert.match(
    migration,
    /create or replace function public\.create_supplier_order\(\s*p_negotiation_number text,\s*p_order_date date,\s*p_notes text,\s*p_lines jsonb,\s*p_idempotency_key uuid\s*\)/i,
  );
  assert.match(
    migration,
    /create or replace function public\.update_supplier_order\(\s*p_supplier_order_id uuid,\s*p_expected_updated_at timestamptz,\s*p_negotiation_number text,\s*p_order_date date,\s*p_notes text,\s*p_lines jsonb,\s*p_idempotency_key uuid\s*\)/i,
  );
  assert.match(migration, /security definer\s+set search_path = ''/gi);
  assert.match(migration, /get stacked diagnostics v_constraint_name = constraint_name/gi);
  assert.match(migration, /supplier order negotiation already exists\./gi);
  assert.match(migration, /return private\.create_supplier_order\(/i);
  assert.match(migration, /return private\.update_supplier_order\(/i);
});
