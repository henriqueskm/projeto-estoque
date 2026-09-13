import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260913003000_enforce_catalog_inv_writer_policy.sql",
  ),
  "utf8",
);

function functionBody(name) {
  const pattern = new RegExp(
    `create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  const match = migration.match(pattern);
  assert.ok(match, `${name} must exist in the forward migration`);
  return match[0];
}

test("forward migration defines one authoritative write identity", () => {
  const body = functionBody("private.catalog_code_write_policy");
  assert.match(body, /\^\(\[0-9\]\+\)-\?\(INV\|DESL\)\(\[0-9\]\*\)\$/i);
  assert.match(body, /unsupported INV\/DESL format/i);
  assert.match(body, /\^\[A-Za-z0-9\]\+\(\[-\/\]\[A-Za-z0-9\]\+\)\*\$/);
  assert.match(body, /lock_identity := modifier_family/i);
  assert.match(body, /canonical_code := modifier_family \|\| v_modifier_parts\[3\]/i);
  assert.doesNotMatch(body, /update public\.|insert into public\.|delete from public\./i);
});

test("migration preflights the complete existing namespace and fails clearly", () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/i);
  assert.match(migration, /select item\.code from public\.items[\s\S]*union all[\s\S]*public\.commercial_configuration_codes/i);
  assert.match(migration, /existing code %s is invalid/i);
  assert.match(migration, /existing codes %s and %s conflict semantically/i);
  assert.doesNotMatch(migration, /update public\.items[\s\S]*set code|update public\.commercial_configuration_codes[\s\S]*set code/i);
});

test("namespace trigger serializes and checks same-table plus cross-table conflicts", () => {
  const body = functionBody("private.enforce_catalog_code_namespace");
  assert.match(body, /catalog_code_write_policy\(new\.code\)/i);
  assert.match(body, /pg_advisory_xact_lock[\s\S]*v_policy\.lock_identity/i);
  assert.ok((body.match(/private\.catalog_codes_conflict/gi) ?? []).length >= 4);
  assert.match(body, /item\.id <> new\.id/i);
  assert.match(body, /commercial_code\.id <> new\.id/i);
});

test("shared primitive enforces policy and family lock before any insert", () => {
  const body = functionBody("private.resolve_or_create_loose_part");
  const policyIndex = body.indexOf("private.catalog_code_write_policy");
  const lockIndex = body.indexOf("pg_catalog.pg_advisory_xact_lock");
  const insertIndex = body.indexOf("insert into public.items");
  assert.ok(policyIndex >= 0 && policyIndex < lockIndex && lockIndex < insertIndex);
  assert.match(body, /private\.catalog_codes_conflict\(commercial_code\.code, v_code\)/i);
  assert.match(body, /private\.catalog_codes_conflict\(item\.code, v_code\)/i);
  assert.match(body, /v_item_code <> v_code/i);
  assert.match(body, /minimum_stock,[\s\S]*values \([\s\S]*'LOOSE_PART',[\s\S]*0,/i);
});

test("authenticated inbound RPC prelocks every NEW_LOOSE_PART family in key order", () => {
  const body = functionBody("public.stock_inbound_lines");
  assert.match(body, /jsonb_array_elements\(p_lines\)/i);
  assert.match(body, /private\.catalog_code_write_policy/i);
  assert.match(body, /where payload_line\.value ->> 'kind' = 'NEW_LOOSE_PART'/i);
  assert.match(body, /order by 1[\s\S]*pg_advisory_xact_lock/i);
  assert.match(body, /private\.stock_inbound_lines_with_loose_parts/i);
});

test("policy helpers and primitive remain unavailable to authenticated callers", () => {
  const compactMigration = migration.replace(/\s+/g, "").toLowerCase();

  for (const signature of [
    "private.catalog_code_write_policy(text)",
    "private.catalog_codes_conflict(text, text)",
    "private.resolve_or_create_loose_part(text, text, uuid, text)",
  ]) {
    const normalizedSignature = signature.replace(/\s+/g, "");
    assert.ok(
      compactMigration.includes(
        `revokeallonfunction${normalizedSignature}frompublic,anon,authenticated`,
      ),
      `${signature} must be revoked from public, anon and authenticated`,
    );
  }
});
