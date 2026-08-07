import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260804044500_safisa_portal_foundation.sql",
  import.meta.url,
);
const sql = readFileSync(migrationPath, "utf8");

function expectAll(patterns) {
  for (const pattern of patterns) {
    assert.match(sql, pattern);
  }
}

test("creates the Safisa identity, authorization, readiness, and audit model", () => {
  expectAll([
    /create table public\.safisa_portal_members/i,
    /create table public\.safisa_order_authorizations/i,
    /is_authorized boolean not null default false/i,
    /create table public\.safisa_portal_events/i,
    /add column ready_quantity integer/i,
    /set ready_quantity = picked_quantity/i,
    /ready_quantity >= picked_quantity/i,
    /ready_quantity \+ cancelled_quantity <= ordered_quantity/i,
    /alter column is_active set default false/i,
  ]);

  assert.doesNotMatch(
    sql,
    /insert\s+into\s+public\.safisa_order_authorizations(?:(?!;)[\s\S])*?\bselect\b/i,
    "the migration must not publish existing orders through a backfill",
  );
});

test("exposes only fixed authenticated wrappers and denies direct table access", () => {
  expectAll([
    /alter table public\.safisa_portal_members enable row level security/i,
    /alter table public\.safisa_order_authorizations enable row level security/i,
    /alter table public\.safisa_portal_events enable row level security/i,
    /revoke all on table public\.safisa_portal_members[\s\S]*from public, anon, authenticated/i,
    /revoke all on table public\.safisa_order_authorizations[\s\S]*from public, anon, authenticated/i,
    /revoke all on table public\.safisa_portal_events[\s\S]*from public, anon, authenticated/i,
    /grant execute on function public\.increment_safisa_ready_quantity[\s\S]*to authenticated/i,
    /grant execute on function public\.correct_safisa_ready_quantity[\s\S]*to authenticated/i,
    /grant execute on function public\.list_safisa_authorized_orders[\s\S]*to authenticated/i,
  ]);

  assert.doesNotMatch(sql, /grant\s+(insert|update|delete|all)\s+on\s+table/i);
  assert.doesNotMatch(sql, /\bservice_role\b/i);
});

test("uses qualified fixed functions with hardened security modes", () => {
  const publicFunctions = [
    "set_safisa_portal_member_status",
    "publish_supplier_order_to_safisa",
    "revoke_supplier_order_from_safisa",
    "increment_safisa_ready_quantity",
    "correct_safisa_ready_quantity",
    "list_safisa_authorized_orders",
    "get_safisa_authorized_order",
    "list_safisa_ready_pickup_alerts",
  ];
  const privateFunctions = [
    "set_safisa_portal_member_status",
    "set_safisa_order_authorization",
    "increment_safisa_ready_quantity",
    "correct_safisa_ready_quantity",
  ];

  for (const functionName of publicFunctions) {
    assert.match(
      sql,
      new RegExp(
        `create function public\\.${functionName}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`,
        "i",
      ),
    );
  }
  for (const functionName of privateFunctions) {
    assert.match(
      sql,
      new RegExp(
        `create function private\\.${functionName}\\([\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`,
        "i",
      ),
    );
  }

  assert.doesNotMatch(sql, /execute\s+format\s*\(/i);
  assert.doesNotMatch(sql, /\b(auth\.jwt|current_setting\s*\(\s*'request\.jwt)/i);
});

test("enforces idempotency, immutable audit, deterministic locks, and correction versioning", () => {
  expectAll([
    /pg_advisory_xact_lock/i,
    /create unique index safisa_portal_events_actor_idempotency_uidx[\s\S]*?\(actor_user_id, idempotency_key\)/i,
    /p_idempotency_key has already been used with a different Safisa portal request/i,
    /create trigger safisa_portal_events_reject_mutation/i,
    /for update of supplier_order/i,
    /for update;/i,
    /order by order_item\.id[\s\S]*for update/i,
    /p_expected_updated_at timestamptz/i,
    /p_confirmed is distinct from true/i,
    /v_line\.updated_at is distinct from p_expected_updated_at/i,
    /safisa_ready_quantity_version_conflict/i,
  ]);
});

test("hardens pickup without coupling supplier-order stock entry to readiness", () => {
  expectAll([
    /create or replace function private\.set_supplier_order_item_picked_quantity\(/i,
    /p_picked_quantity > v_line\.ready_quantity/i,
    /create or replace function private\.mark_supplier_order_all_picked\(/i,
    /set picked_quantity = ready_quantity/i,
    /sum\(order_item\.ready_quantity - order_item\.picked_quantity\)/i,
    /ready_quantity \+ new\.cancelled_quantity > new\.ordered_quantity/i,
    /with ready units cannot change its catalog identity/i,
  ]);

  assert.doesNotMatch(
    sql,
    /create or replace function (public|private)\.create_supplier_order_stock_entry/i,
    "stock entry must remain based on picked minus stocked and outside this change",
  );
});

test("contains no seed identities, Auth configuration change, or deployment command", () => {
  assert.doesNotMatch(sql, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(
    sql,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
  assert.doesNotMatch(sql, /auth\.config|disable_signup|enable_signup/i);
  assert.doesNotMatch(sql, /supabase\s+(db push|migration up|db reset)/i);
});
