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
  "20260812223114_add_catalog_only_loose_part_creation.sql",
);
const migration = readFileSync(migrationPath, "utf8");

function functionBody(name) {
  const pattern = new RegExp(
    `create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  const match = migration.match(pattern);
  assert.ok(match, `${name} must exist in the migration`);
  return match[0];
}

test("catalog primitive validates and serializes the exact trimmed code", () => {
  const body = functionBody("private.resolve_or_create_loose_part");
  assert.match(body, /v_code := btrim\(p_code\)/i);
  assert.match(body, /char_length\(v_code\) > 120/i);
  assert.match(body, /char_length\(v_description\) > 500/i);
  assert.match(body, /pg_advisory_xact_lock[\s\S]*hashtextextended\(v_code, 0\)/i);
  assert.doesNotMatch(body, /upper\(|lower\(v_code\)/i);
});

test("catalog primitive owns all collision and subtype rules", () => {
  const body = functionBody("private.resolve_or_create_loose_part");
  assert.match(body, /public\.commercial_configuration_codes[\s\S]*commercial configuration code/i);
  assert.match(body, /item_type[\s\S]*'LOOSE_PART'/i);
  assert.match(body, /not v_item_is_active/i);
  assert.match(body, /lower\(btrim\(v_item_description\)\) <> lower\(v_description\)/i);
  assert.match(body, /public\.loose_parts/i);
  assert.match(body, /'created', v_created/i);
});

test("catalog primitive cannot create stock or supplier-order effects", () => {
  const body = functionBody("private.resolve_or_create_loose_part");
  assert.doesNotMatch(body, /movement_batches|stock_movements|configuration_stock_movements/i);
  assert.doesNotMatch(body, /stock_balances|configuration_stock_balances/i);
  assert.doesNotMatch(body, /stock_inbound_lines|supplier_orders|supplier_order_items/i);
});

test("public wrapper derives the actor from auth and requires an active named profile", () => {
  const body = functionBody("public.create_loose_part");
  assert.match(body, /security definer\s+set search_path = ''/i);
  assert.match(body, /v_user_id := auth\.uid\(\)/i);
  assert.match(body, /profile\.id = v_user_id[\s\S]*profile\.is_active/i);
  assert.match(body, /nullif\(btrim\(v_user_name\), ''\) is null/i);
  assert.match(body, /private\.resolve_or_create_loose_part/i);
  assert.doesNotMatch(body, /p_user_id|p_item_type|p_quantity|p_minimum_stock/i);
});

test("function privileges expose only the fixed catalog wrapper to authenticated", () => {
  assert.match(
    migration,
    /revoke all on function private\.resolve_or_create_loose_part\([\s\S]*?from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.create_loose_part\(text, text\)[\s\S]*?from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.create_loose_part\(text, text\)\s+to authenticated/i,
  );
});

test("NEW_LOOSE_PART inbound delegates catalog resolution to the same primitive", () => {
  const body = functionBody("private.stock_inbound_lines_with_loose_parts");
  assert.match(body, /private\.resolve_or_create_loose_part\(/i);
  assert.match(body, /private\.stock_inbound_lines\(/i);
  assert.match(body, /inbound_request_payload/i);
  assert.equal(
    (body.match(/insert into public\.items/gi) ?? []).length,
    0,
    "inbound must not retain an independent item-creation implementation",
  );
});

test("item authorship is nullable for legacy rows and populated by new creation", () => {
  assert.match(migration, /add column created_by uuid[\s\S]*references public\.profiles\(id\)[\s\S]*on delete set null/i);
  assert.match(migration, /add column created_by_name_snapshot text/i);
  assert.match(
    migration,
    /\(created_by is null and created_by_name_snapshot is null\)[\s\S]*nullif\(btrim\(created_by_name_snapshot\), ''\) is not null/i,
  );
  const body = functionBody("private.resolve_or_create_loose_part");
  assert.match(body, /created_by,[\s\S]*created_by_name_snapshot/i);
  assert.match(body, /p_user_id,[\s\S]*v_user_name/i);
});

test("migration preflights the shared code namespace and indexes the authorship FK", () => {
  assert.match(
    migration,
    /from public\.items as item[\s\S]*join public\.commercial_configuration_codes as commercial_code[\s\S]*commercial_code\.code\s*=\s*item\.code[\s\S]*exact code already exists in both/i,
  );
  assert.match(
    migration,
    /create index items_created_by_idx\s+on public\.items \(created_by\)/i,
  );
});

test("one shared trigger serializes INSERT and UPDATE across both catalog code domains", () => {
  const body = functionBody("private.enforce_catalog_code_namespace");
  assert.match(body, /set search_path = ''/i);
  assert.match(body, /pg_advisory_xact_lock\([\s\S]*hashtextextended\(new\.code, 0\)[\s\S]*\)/i);
  assert.match(body, /tg_table_name = 'items'/i);
  assert.match(body, /public\.commercial_configuration_codes[\s\S]*new\.code/i);
  assert.match(body, /tg_table_name = 'commercial_configuration_codes'/i);
  assert.match(body, /public\.items[\s\S]*new\.code/i);
  assert.doesNotMatch(body, /\binsert\s+into\b|\bupdate\s+public\b|\bdelete\s+from\b/i);
  assert.match(
    migration,
    /create trigger items_enforce_catalog_code_namespace\s+before insert or update of code\s+on public\.items/i,
  );
  assert.match(
    migration,
    /create trigger commercial_configuration_codes_enforce_catalog_code_namespace\s+before insert or update of code\s+on public\.commercial_configuration_codes/i,
  );
  assert.match(
    migration,
    /revoke all on function private\.enforce_catalog_code_namespace\(\)\s+from public, anon, authenticated/i,
  );
});
