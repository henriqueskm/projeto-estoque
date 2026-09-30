import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260930164109_bundle_recipe_foundation.sql",
  ),
  "utf8",
);
const documentation = readFileSync(
  resolve(root, "docs/COMMERCIAL_BUNDLES.md"),
  "utf8",
);

test("creates the separate bundle recipe, balance, ledger, and receipt model", () => {
  for (const table of [
    "public.commercial_bundles",
    "public.commercial_bundle_codes",
    "public.commercial_bundle_components",
    "public.bundle_stock_balances",
    "public.bundle_stock_movements",
    "public.bundle_assembly_operations",
    "private.bundle_operation_requests",
    "private.bundle_adjustment_requests",
  ]) {
    assert.match(migration, new RegExp(`create table ${table.replace(".", "\\.")}`, "i"));
  }

  assert.match(migration, /check \(\s*\(item_id is not null and configuration_id is null\)[\s\S]*?or \(item_id is null and configuration_id is not null\)/i);
  assert.match(migration, /commercial_bundle_components_item_uidx[\s\S]*?\(bundle_id, item_id\)[\s\S]*?where item_id is not null/i);
  assert.match(migration, /commercial_bundle_components_configuration_uidx[\s\S]*?\(bundle_id, configuration_id\)[\s\S]*?where configuration_id is not null/i);
  assert.match(migration, /bundle_stock_movements_quantity_consistency_check[\s\S]*?quantity_after = quantity_before \+ quantity_change/i);
  assert.match(migration, /jsonb_array_length\(recipe_snapshot\) > 0/i);
});

test("enforces non-empty and immutable-after-use non-nested recipes", () => {
  assert.match(migration, /commercial_bundles_require_recipe[\s\S]*?deferrable initially deferred/i);
  assert.match(migration, /commercial_bundle_components_require_recipe[\s\S]*?deferrable initially deferred/i);
  assert.match(migration, /bundle_stock_balances[\s\S]*?balance\.quantity > 0[\s\S]*?bundle_stock_movements/i);
  assert.match(migration, /Recipe for commercial bundle %s is immutable after first use/i);
  assert.doesNotMatch(migration, /bundle_component_id/i);
});

test("extends the locked INV-aware catalog namespace to bundle codes", () => {
  assert.match(migration, /create or replace function private\.enforce_catalog_code_namespace\(\)/i);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*?v_policy\.lock_identity/i);
  assert.match(migration, /public\.items[\s\S]*?public\.commercial_configuration_codes[\s\S]*?public\.commercial_bundle_codes/i);
  assert.match(migration, /commercial_bundle_codes_enforce_catalog_code_namespace/i);
  assert.match(migration, /private\.catalog_codes_conflict\(bundle_code\.code, new\.code\)/i);
});

test("seeds the required loose parts and always registers 1HC without catalog UUID literals", () => {
  const seed = migration.match(
    /create function private\.ensure_1hc_loose_parts\(\)[\s\S]*?revoke all on function private\.ensure_1hc_loose_parts\(\)/i,
  )?.[0];
  const registration = migration.match(
    /create function private\.register_1hc_bundle\(\)[\s\S]*?revoke all on function private\.register_1hc_bundle\(\)/i,
  )?.[0];
  assert.ok(seed);
  assert.ok(registration);
  for (const [code, description] of [
    ["CIL", "Cilindro Primário"],
    ["EMP", "Empurrador MBB"],
    ["RES", "Reservatório de Óleo"],
    ["COT", "Cotovelo Plástico MBB"],
  ]) {
    assert.match(seed, new RegExp(`'${code}'`));
    assert.match(seed, new RegExp(description));
  }
  assert.match(seed, /private\.catalog_code_write_policy\(required\.code\)[\s\S]*?order by policy\.lock_identity, required\.code/i);
  assert.match(seed, /pg_advisory_xact_lock[\s\S]*?v_required\.lock_identity/i);
  assert.match(seed, /private\.catalog_codes_conflict\(item\.code, v_required\.code\)/i);
  assert.match(seed, /private\.catalog_codes_conflict\([\s\S]*?commercial_code\.code,[\s\S]*?v_required\.code/i);
  assert.match(seed, /private\.catalog_codes_conflict\(bundle_code\.code, v_required\.code\)/i);
  assert.match(seed, /insert into public\.items[\s\S]*?insert into public\.loose_parts/i);
  assert.match(seed, /v_item_type <> 'LOOSE_PART'/i);
  assert.match(seed, /not v_item_is_active/i);
  assert.match(seed, /not registered as a loose-part subtype/i);
  assert.doesNotMatch(seed, /created_by/i);
  assert.match(registration, /commercial_code\.code = '1H'/i);
  for (const code of ["CIL", "EMP", "RES", "COT"]) {
    assert.match(registration, new RegExp(`'${code}'`));
  }
  assert.match(registration, /item\.item_type = 'LOOSE_PART'/i);
  assert.match(registration, /commercial_code\.is_active[\s\S]*?configuration\.is_active/i);
  assert.match(registration, /private\.catalog_codes_conflict\(item\.code, '1HC'\)/i);
  assert.doesNotMatch(`${seed}\n${registration}`, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  assert.match(migration, /perform private\.ensure_1hc_loose_parts\(\);[\s\S]*?perform private\.register_1hc_bundle\(\);/i);
  assert.doesNotMatch(migration, /registration deferred/i);
});

test("assembly and disassembly use free balances, deterministic locks, and a full atomic ledger", () => {
  assert.match(migration, /create function private\.commercial_bundle_maximum_assemblable/i);
  assert.match(migration, /coalesce\(item_balance\.quantity, 0\)/i);
  assert.match(migration, /coalesce\(configuration_balance\.quantity, 0\)/i);
  assert.match(migration, /available_quantity \/ quantity_per_bundle/i);

  const worker = migration.match(
    /create function private\.execute_commercial_bundle_operation\([\s\S]*?revoke all on function private\.execute_commercial_bundle_operation/i,
  )?.[0];
  assert.ok(worker);
  assert.match(worker, /pg_advisory_xact_lock[\s\S]*?bundle-request:/i);
  assert.match(worker, /bundle_operation_requests[\s\S]*?if found then[\s\S]*?return v_existing\.result/i);
  assert.match(worker, /configuration_stock_balances[\s\S]*?order by balance\.configuration_id[\s\S]*?for update of balance/i);
  assert.match(worker, /stock_balances[\s\S]*?order by balance\.item_id[\s\S]*?for update of balance/i);
  assert.match(worker, /bundle_stock_balances[\s\S]*?for update/i);
  assert.match(worker, /insert into public\.configuration_stock_movements/i);
  assert.match(worker, /insert into public\.stock_movements/i);
  assert.match(worker, /insert into public\.bundle_stock_movements/i);
  assert.match(worker, /insert into public\.bundle_assembly_operations/i);
  assert.match(worker, /Commercial bundle disassembly would overflow a component balance/i);
  assert.match(worker, /p_operation_type = 'DISASSEMBLY'[\s\S]*?or \(bundle_code\.is_active and bundle\.is_active\)/i);
  assert.match(worker, /if p_operation_type = 'ASSEMBLY' then[\s\S]*?v_active_component_count/i);
  assert.match(migration, /commercial_codes'[\s\S]*?where code\.configuration_id = component\.configuration_id\s*\)/i);
});

test("idempotent receipts reject changed payloads and become immutable", () => {
  assert.match(migration, /p_idempotency_key has already been used with a different commercial bundle operation/i);
  assert.match(migration, /p_idempotency_key has already been used with a different commercial bundle adjustment/i);
  assert.match(migration, /bundle_operation_requests_immutable_receipt/i);
  assert.match(migration, /bundle_adjustment_requests_immutable_receipt/i);
  assert.match(migration, /old\.completed_at is not null[\s\S]*?Bundle idempotency receipts are immutable/i);
  assert.match(migration, /old\.completed_at is not null[\s\S]*?Bundle adjustment receipts are immutable/i);
  assert.match(migration, /v_existing\.movement_batch_id is null and found[\s\S]*?already been used by another stock operation/i);
});

test("absolute bundle adjustment is stale-protected and does not create assembly audit", () => {
  const adjustment = migration.match(
    /create function private\.adjust_commercial_bundle_stock_checked\([\s\S]*?create function public\.adjust_commercial_bundle_stock_checked/i,
  )?.[0];
  assert.ok(adjustment);
  assert.match(adjustment, /return v_existing\.result/i);
  assert.match(adjustment, /v_quantity_before is distinct from p_expected_quantity/i);
  assert.match(adjustment, /bundle_stock_adjustment_quantity_conflict/i);
  assert.match(adjustment, /'ADJUSTMENT'[\s\S]*?'MANUAL'/i);
  assert.match(adjustment, /insert into public\.bundle_stock_movements/i);
  assert.doesNotMatch(adjustment, /bundle_assembly_operations/i);
});

test("RLS, grants, and function execution expose reads and authenticated RPCs only", () => {
  for (const table of [
    "commercial_bundles",
    "commercial_bundle_codes",
    "commercial_bundle_components",
    "bundle_stock_balances",
    "bundle_stock_movements",
    "bundle_assembly_operations",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`${table}_select_active_users[\\s\\S]*?to authenticated[\\s\\S]*?private\\.is_active_profile`, "i"));
  }
  assert.match(migration, /revoke all privileges on table[\s\S]*?commercial_bundles[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant select on table[\s\S]*?bundle_assembly_operations[\s\S]*?to authenticated/i);
  assert.match(migration, /revoke all on function public\.assemble_commercial_bundle[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.assemble_commercial_bundle[\s\S]*?to authenticated/i);
});

test("documentation distinguishes configuration, seeded bundle, and unentered real count", () => {
  assert.match(documentation, /not an alias of `1H`/i);
  assert.match(documentation, /clean migration\s+chain creates/i);
  assert.match(documentation, /free plus embedded/i);
  assert.match(documentation, /maximum assemblable.*only free balances/i);
  assert.match(documentation, /has \*\*not\*\* been entered/i);
});
