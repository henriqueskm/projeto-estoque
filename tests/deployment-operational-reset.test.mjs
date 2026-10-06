import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runner = readFileSync("scripts/deployment-operational-reset.ps1", "utf8");
const dryRun = readFileSync("scripts/deployment-reset/dry-run.sql", "utf8");
const execute = readFileSync("scripts/deployment-reset/execute.sql", "utf8");
const contract = JSON.parse(readFileSync("scripts/deployment-reset/contract.json", "utf8"));
const localTest = readFileSync("tests/deployment-operational-reset.cli.local.ps1", "utf8");

test("audited PRE and independently expected POST contract retain exact identities", () => {
  assert.equal(contract.sourceMainSha, "50af5996ff0fb7e36c2c3ae08d20ca3232df6cdc");
  assert.equal(contract.migrationCount, 38);
  assert.equal(contract.latestMigration, "20260917120000");
  assert.equal(contract.catalogCounts.items, 106);
  assert.equal(contract.catalogCounts.looseParts, 5);
  assert.equal(contract.catalogCounts.vehicleApplications, 295);
  assert.equal(contract.catalogCounts.vehicleBrands, 8);
  assert.equal(contract.catalogCounts.items - contract.approvedLooseParts.length, 101);
  assert.equal(new Set(contract.approvedLooseParts.map(p => p.id)).size, 5);
  assert.deepEqual(contract.approvedLooseParts.map(p => p.code), ["067", "091", "091/VF", "110", "SUB071"]);
  assert.notEqual(contract.catalogFingerprint, contract.expectedPostCatalogFingerprint);
  for (const key of ["schemaFingerprint", "catalogFingerprint", "migrationFingerprint", "expectedPostCatalogFingerprint", "foreignKeyFingerprint"]) assert.match(contract[key], /^[a-f0-9]{32}$/);
});

test("DryRun is an explicit repeatable read read-only transaction without DDL/DML", () => {
  const sql = dryRun.replace(/--.*$/gm, "");
  assert.match(sql, /begin transaction isolation level repeatable read read only;/i);
  assert.match(sql, /set local standard_conforming_strings = on;/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|call|do)\b/i);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /no_protected_loose_part_references/);
  assert.match(sql, /safisa_trigger_active/);
});

test("Execute retains human guards and proves exact authorized delta and ROW_COUNT", () => {
  assert.match(runner, /CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK/);
  assert.match(runner, /BackupValidated/);
  assert.match(runner, /OperationsPaused/);
  assert.match(runner, /AllowRemoteExecution/);
  assert.match(runner, /LocalTest is never accepted for a remote target/);
  assert.match(execute, /get diagnostics affected = row_count/g);
  assert.match(execute, /Exact ROW_COUNT validation failed/);
  assert.match(execute, /expected_post_catalog_fingerprint/);
  assert.match(execute, /deployment_reset_fk_fingerprint/);
  assert.match(execute, /protected structural references/);
  assert.doesNotMatch(execute, /session_replication_role|disable\s+trigger\s+all|truncate|cascade/i);
  assert.equal((execute.match(/disable trigger safisa_portal_events_reject_mutation/g) ?? []).length, 1);
  assert.equal((execute.match(/enable trigger safisa_portal_events_reject_mutation/g) ?? []).length, 1);
  assert.match(execute, /lock table[\s\S]*in share row exclusive mode/);
});

test("full catalog/application rows are fingerprinted with minimums checked separately", () => {
  for (const sql of [dryRun, execute]) {
    assert.match(sql, /to_jsonb\(t\) - 'minimum_stock'/);
    assert.match(sql, /md5\(to_jsonb\(t\)::text\) from public\.vehicle_applications/);
    assert.match(sql, /md5\(to_jsonb\(t\)::text\) from public\.vehicle_application_brands/);
  }
  assert.match(execute, /push_fingerprint/);
  assert.match(execute, /Identity\/membership preservation validation failed/);
  assert.match(execute, /Storage preservation validation failed/);
});

test("automated Execute tests are exclusive, behavioral and cover late sabotage rollback", () => {
  assert.match(localTest, /nk\.disposable/);
  assert.match(localTest, /deployment-reset-pr-68/);
  assert.match(localTest, /reset_test_skip_delete/);
  assert.match(localTest, /reset_test_corrupt_catalog/);
  assert.match(localTest, /Get-StateSignature|Signature/);
  assert.match(localTest, /jsonb_populate_recordset/);
  assert.match(localTest, /accentedDescription/);
  assert.match(runner, /Get-Content -Encoding UTF8/);
  assert.equal((runner.match(/\[Regex\]::Replace\(\$sql, ":/g) ?? []).length, 1);
  assert.doesNotMatch(runner, /Add-PsqlVariable/);
});

function probe(env = {}, mode = "DryRun", ref = contract.projectRef, staleContract = false) {
  const dir = mkdtempSync(join(tmpdir(), "nk-reset-cli-probe-"));
  mkdirSync(join(dir, "supabase", ".temp"), { recursive: true });
  writeFileSync(join(dir, "supabase", ".temp", "project-ref"), ref, "utf8");
  // Transport mocks must reach the transport gates after forward migrations.
  // This generated TEST-ONLY contract changes only local migration identity;
  // the production PRE/POST fingerprints and historical contract stay intact.
  const migrations = readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort();
  const testContractPath = join(dir, "test-contract.json");
  const migrationRows = migrations.map(name => `${name.slice(0, 14)}|${name.slice(15, -4)}`).join("\n");
  writeFileSync(testContractPath, JSON.stringify(staleContract ? contract : {
    ...contract, migrationCount: migrations.length, latestMigration: migrations.at(-1).slice(0, 14),
    migrationFingerprint: createHash("md5").update(migrationRows).digest("hex"),
  }), "utf8");
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    resolve("tests/fixtures/deployment-reset-api-probe.ps1"),
    "-Runner", resolve("scripts/deployment-operational-reset.ps1"),
    "-MockCli", resolve("tests/fixtures/deployment-reset-readonly-cli.mock.ps1"),
    "-LinkedWorkspace", dir, "-Mode", mode, "-TestContract", testContractPath
  ], { encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true });
  assert.equal(result.error, undefined);
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes("local-test-decoy-credential"));
  return { ...result, output };
}

test("read-only Management API wrapper restores local sentinel setting after success", () => {
  const result = probe();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /PASS API wrapper/);
});
test("obsolete reset contract still fails closed before the mocked transport", () => {
  const result = probe({}, "DryRun", contract.projectRef, true);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Local migration files do not match the registered reset contract/);
});

test("reset and backup retain both queue types and delete their new source FK before audit rows", () => {
  const backup = readFileSync("scripts/deployment-backup.mjs", "utf8");
  assert.match(dryRun, /select 'push_notification_events', count\(\*\) from public\.push_notification_events/);
  assert.match(backup, /['"]push_notification_events['"]/);
  assert.ok(execute.indexOf("delete from public.push_notification_events") < execute.indexOf("delete from public.safisa_portal_events"));
  const newMigration = readFileSync("supabase/migrations/20261006104415_safisa_item_ready_push_notifications.sql", "utf8");
  assert.match(newMigration, /references public\.safisa_portal_events\(id\) on delete restrict/);
  assert.match(newMigration, /event_type in \('SAFISA_FULLY_READY', 'SAFISA_ITEM_READY'\)/);
  assert.doesNotMatch(execute, /event_type\s*=\s*'SAFISA_FULLY_READY'/);
});
test("Management API rejects Execute before invoking any transport", () => {
  const result = probe({}, "Execute");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /only accepts DryRun/);
});
test("unaudited CLI version is rejected", () => {
  const result = probe({ NK_RESET_MOCK_VERSION: "2.113.0" });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /version 2.112.0/);
});
test("actual authenticated project metadata must match the linked ref", () => {
  const result = probe({ NK_RESET_MOCK_WRONG_PROJECT: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /metadata guard failed/);
});
test("wrong linked ref is rejected before query", () => {
  const result = probe({}, "DryRun", "differentprojectref00");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /actual target/);
});
test("parse failure is safe and restores previous local setting", () => {
  const result = probe({ NK_RESET_MOCK_PARSE_ERROR: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /could not be parsed safely/);
});
