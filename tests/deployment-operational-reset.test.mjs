import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync("scripts/deployment-operational-reset.ps1", "utf8");
const dryRun = readFileSync("scripts/deployment-reset/dry-run.sql", "utf8");
const execute = readFileSync("scripts/deployment-reset/execute.sql", "utf8");
const fixture = readFileSync("tests/fixtures/deployment-operational-reset.sql", "utf8");
const contract = JSON.parse(readFileSync("scripts/deployment-reset/contract.json", "utf8"));

test("versioned reset contract pins the audited production identity", () => {
  assert.equal(contract.projectName, "EstoqueNK");
  assert.equal(contract.projectRef, "isdjboconmwaqipjrjvp");
  assert.equal(contract.databaseName, "postgres");
  assert.equal(contract.sourceMainSha, "12e6e5838bb905332232cbf724df46f6aa9bc810");
  assert.equal(contract.migrationCount, 31);
  assert.equal(contract.latestMigration, "20260828234000");
  for (const key of ["migrationFingerprint", "schemaFingerprint", "catalogFingerprint"]) {
    assert.match(contract[key], /^[0-9a-f]{32}$/);
  }
  assert.equal(contract.catalogCounts.items, 107);
  assert.equal(contract.catalogCounts.configurations, 80);
  assert.equal(contract.catalogCounts.commercialCodes, 80);
  assert.equal(contract.catalogCounts.compatibilities, 22);
  assert.equal(contract.dynamicItems.length, 5);
});

test("dry-run SQL is a single read-only report", () => {
  const withoutComments = dryRun.replace(/--.*$/gm, "");
  assert.match(withoutComments, /^\s*\\set ON_ERROR_STOP on\s+with\b/i);
  assert.doesNotMatch(
    withoutComments,
    /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|call|do)\b/i,
  );
  assert.match(dryRun, /'mutationsExecuted', false/);
  assert.match(dryRun, /RESET_OPERACIONAL_DRY_RUN/);
  assert.match(dryRun, /required_relations_present/);
  assert.match(dryRun, /dynamicItems/);
  assert.match(dryRun, /push_subscription_action/);
});

test("execute path requires explicit independent acknowledgements", () => {
  assert.match(runner, /CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK/);
  assert.match(runner, /BackupValidated/);
  assert.match(runner, /OperationsPaused/);
  assert.match(runner, /AllowRemoteExecution/);
  assert.match(runner, /Remote execution is blocked/);
  assert.match(runner, /versioned default contract/);
  assert.match(runner, /tracked worktree/);
  assert.match(runner, /derive a Supabase project ref from the actual database target/);
  assert.match(runner, /Local execution requires a disposable Supabase database container/);
});

test("execute SQL uses one transaction and the FK-safe order", () => {
  assert.match(execute, /^\\set ON_ERROR_STOP on\s+begin;/i);
  assert.match(execute, /commit;\s*$/i);
  assert.doesNotMatch(execute, /session_replication_role/i);
  assert.doesNotMatch(execute, /disable\s+trigger\s+all/i);

  const deleteEntryLines = execute.indexOf("delete from public.supplier_order_stock_entry_lines");
  const resetReadiness = execute.indexOf("update public.supplier_order_items");
  const deleteOrderItems = execute.indexOf("delete from public.supplier_order_items");
  const deleteOrders = execute.indexOf("delete from public.supplier_orders");
  const deleteMovements = execute.indexOf("delete from public.stock_movements");
  const deleteBatches = execute.indexOf("delete from public.movement_batches");

  assert.ok(deleteEntryLines < resetReadiness);
  assert.ok(resetReadiness < deleteOrderItems);
  assert.ok(deleteOrderItems < deleteOrders);
  assert.ok(deleteMovements < deleteBatches);
});

test("only the exact immutable Safisa trigger is temporarily bypassed", () => {
  const disable = "disable trigger safisa_portal_events_reject_mutation";
  const enable = "enable trigger safisa_portal_events_reject_mutation";
  assert.equal(execute.toLowerCase().split(disable).length - 1, 1);
  assert.equal(execute.toLowerCase().split(enable).length - 1, 1);
  assert.ok(execute.toLowerCase().indexOf(disable) < execute.toLowerCase().indexOf(enable));
  assert.match(execute, /Safisa immutable-event trigger was not restored/);
  assert.match(execute, /READY_QUANTITIES_ALL_MARKED/);
});

test("post-reset validation covers operational zero and preservation", () => {
  for (const relation of [
    "movement_batches",
    "stock_movements",
    "configuration_stock_movements",
    "assembly_operations",
    "inbound_batch_lines",
    "outbound_batch_lines",
    "supplier_orders",
    "supplier_order_items",
    "supplier_order_events",
    "supplier_order_stock_entries",
    "supplier_order_stock_entry_lines",
    "safisa_order_authorizations",
    "safisa_portal_events",
    "push_notification_events",
    "stock_adjustment_requests",
    "configuration_operation_requests",
    "stock_balances",
    "configuration_stock_balances",
    "minimum_stock_changes",
    "configuration_minimum_stock_changes",
  ]) {
    assert.match(execute, new RegExp(`count\\(\\*\\) from (?:public|private)\\.${relation}`));
  }
  assert.match(execute, /Catalog\/schema\/migration preservation validation failed/);
  assert.match(execute, /Identity\/membership preservation validation failed/);
  assert.match(execute, /Storage preservation validation failed/);
  assert.match(execute, /Intentional local rollback validation failure/);
});

test("push subscriptions default to preserve and offer explicit disable/delete policies", () => {
  assert.match(runner, /\[string\]\$PushSubscriptions = "PRESERVE"/);
  assert.match(runner, /\[ValidateSet\("PRESERVE", "DISABLE", "DELETE"\)\]/);
  assert.match(execute, /when 'PRESERVE' then null/);
  assert.match(execute, /when 'DISABLE' then[\s\S]*set enabled = false/);
  assert.match(execute, /when 'DELETE' then[\s\S]*delete from public\.push_subscriptions/);
  assert.match(execute, /Push subscription preserve validation failed/);
  assert.match(execute, /Push subscription disable validation failed/);
  assert.match(execute, /Push subscription delete validation failed/);
});

test("disposable fixture exercises restrictive operational relationships", () => {
  assert.match(fixture, /Fixture supplier entry/);
  assert.match(fixture, /supplier_order_stock_entry_lines/);
  assert.match(fixture, /READY_QUANTITY_INCREMENTED/);
  assert.match(fixture, /push_notification_events/);
  assert.match(fixture, /private\.stock_adjustment_requests/);
  assert.match(fixture, /private\.configuration_operation_requests/);
  assert.match(fixture, /'ASSEMBLY'/);
  assert.match(fixture, /'DISASSEMBLY'/);
  assert.match(fixture, /'REVERSAL'/);
});
