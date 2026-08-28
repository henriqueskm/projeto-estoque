import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync as run } from "node:child_process";

const container = process.env.SAFISA_TEST_DB_CONTAINER ?? "supabase_db_nk_current_state_baseline";
const windowsDocker = join(process.env.LOCALAPPDATA ?? "", "Programs", "DockerDesktop", "resources", "bin", "docker.exe");
const docker = existsSync(windowsDocker) ? windowsDocker : "docker";
const ids = {
  internalA: "30000000-0000-4000-8000-000000000001",
  internalB: "30000000-0000-4000-8000-000000000002",
  inactive: "30000000-0000-4000-8000-000000000003",
  safisa: "30000000-0000-4000-8000-000000000004",
};
const orderId = (suffix) => `30000000-0000-4000-8000-${String(100 + suffix).padStart(12, "0")}`;
const lineId = (suffix) => `30000000-0000-4000-8000-${String(200 + suffix).padStart(12, "0")}`;
const key = (suffix) => `30000000-0000-4000-8000-${String(300 + suffix).padStart(12, "0")}`;
const fid = (suffix) => `local-fid:${String(suffix).padStart(32, "x")}`;
const deviceId = (suffix) => `30000000-0000-4000-8000-${String(400 + suffix).padStart(12, "0")}`;

function psql(sql, { allowFailure = false } = {}) {
  try {
    return run(docker, ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
    throw error;
  }
}

function asRole(role, userId, statement, allowFailure = false) {
  return psql(`begin; select set_config('request.jwt.claim.sub', '${userId ?? ""}', true); set local role ${role}; ${statement}; commit;`, { allowFailure });
}

function asAuthenticated(userId, statement) {
  return asRole("authenticated", userId, statement);
}

function asAuthenticatedFailure(userId, statement, expected) {
  assert.match(asRole("authenticated", userId, statement, true), expected);
}

function number(sql) {
  return Number(psql(sql).split(/\r?\n/).at(-1));
}

console.log("ALVO CONFIRMADO: SUPABASE LOCAL DESCARTÁVEL");
assert.equal(psql("select current_database() = 'postgres'"), "t");
assert.equal(psql("select to_regclass('public.push_subscriptions') is not null"), "t");
assert.equal(psql("select to_regclass('public.push_notification_events') is not null"), "t");

const itemId = psql("select id from public.items where is_active order by id limit 1");
assert.match(itemId, /^[0-9a-f-]{36}$/i);

psql(`
  truncate table
    public.push_notification_events,
    public.push_subscriptions,
    public.supplier_order_items,
    public.supplier_orders
  cascade;
  delete from public.safisa_portal_members where user_id = '${ids.safisa}';
  delete from public.profiles where id in ('${ids.internalA}', '${ids.internalB}', '${ids.inactive}', '${ids.safisa}');
  delete from auth.users where id in ('${ids.internalA}', '${ids.internalB}', '${ids.inactive}', '${ids.safisa}');
  insert into auth.users (id, aud, role, created_at, updated_at) values
    ('${ids.internalA}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.internalB}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.inactive}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.safisa}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active) values
    ('${ids.internalA}', 'Internal A', true),
    ('${ids.internalB}', 'Internal B', true),
    ('${ids.inactive}', 'Inactive', false),
    ('${ids.safisa}', 'Safisa Local', false);
`);

assert.match(asRole("anon", null, `select public.register_push_subscription('${deviceId(1)}', '${fid(1)}')`, true), /permission denied|Authentication is required/i);
asAuthenticatedFailure(ids.inactive, `select public.register_push_subscription('${deviceId(1)}', '${fid(1)}')`, /active internal profile/i);
asAuthenticatedFailure(ids.internalA, `select public.register_push_subscription('${deviceId(9)}', '')`, /Firebase installation ID is invalid/i);
asAuthenticatedFailure(ids.internalA, `select public.register_push_subscription('${deviceId(9)}', repeat('x', 513))`, /Firebase installation ID is invalid/i);
asAuthenticatedFailure(ids.internalA, `select public.register_push_subscription('${deviceId(9)}', 'fid' || chr(1))`, /Firebase installation ID is invalid/i);
asAuthenticated(ids.internalA, `select public.register_push_subscription('${deviceId(1)}', '${fid(1)}')`);
asAuthenticated(ids.internalA, `select public.register_push_subscription('${deviceId(1)}', '${fid(2)}')`);
assert.equal(number(`select count(*) from public.push_subscriptions where device_id = '${deviceId(1)}'`), 1, "FID rotation updates the same device row");
assert.equal(number(`select count(*) from public.push_subscriptions where firebase_installation_id = '${fid(1)}'`), 0);
asAuthenticated(ids.internalA, `select public.register_push_subscription('${deviceId(1)}', '${fid(1)}')`);
assert.equal(number(`select count(*) from public.push_subscriptions where firebase_installation_id = '${fid(1)}'`), 1);
assert.match(asRole("authenticated", ids.internalB, "select firebase_installation_id from public.push_subscriptions", true), /permission denied/i);

asAuthenticated(ids.internalB, `select public.register_push_subscription('${deviceId(1)}', '${fid(1)}')`);
assert.equal(psql(`select user_id from public.push_subscriptions where firebase_installation_id = '${fid(1)}'`), ids.internalB);
assert.equal(asAuthenticated(ids.internalA, `select public.disable_push_subscription('${deviceId(1)}', '${fid(1)}')`).includes('"disabled": false'), true);
assert.equal(number(`select count(*) from public.push_subscriptions where firebase_installation_id = '${fid(1)}' and enabled`), 1);
assert.equal(asAuthenticated(ids.internalB, `select public.disable_push_subscription('${deviceId(1)}', '${fid(1)}')`).includes('"disabled": true'), true);
assert.equal(number(`select count(*) from public.push_subscriptions where firebase_installation_id = '${fid(1)}' and enabled`), 0);

asAuthenticated(ids.internalA, `select public.set_safisa_portal_member_status('${ids.safisa}', true, '${key(1)}')`);
psql(`
  insert into public.supplier_orders (id, negotiation_number, order_date, created_by, created_by_name_snapshot) values
    ('${orderId(1)}', '990001', current_date, '${ids.internalA}', 'Internal A'),
    ('${orderId(2)}', '990002', current_date, '${ids.internalA}', 'Internal A'),
    ('${orderId(3)}', '990003', current_date, '${ids.internalA}', 'Internal A'),
    ('${orderId(4)}', '990004', current_date, '${ids.internalA}', 'Internal A');
  insert into public.supplier_order_items (
    id, supplier_order_id, item_id, code_snapshot, description_snapshot,
    item_type_snapshot, ordered_quantity, ready_quantity, picked_quantity,
    stocked_quantity, cancelled_quantity, position
  ) values
    ('${lineId(1)}', '${orderId(1)}', '${itemId}', 'LOCAL-1', 'Produto local parcial', 'ITEM', 10, 0, 0, 0, 0, 0),
    ('${lineId(2)}', '${orderId(2)}', '${itemId}', 'LOCAL-2A', 'Produto local completo A', 'ITEM', 5, 0, 0, 0, 0, 0),
    ('${lineId(3)}', '${orderId(2)}', '${itemId}', 'LOCAL-2B', 'Produto local completo B', 'ITEM', 5, 0, 0, 0, 0, 1),
    ('${lineId(4)}', '${orderId(3)}', '${itemId}', 'LOCAL-3', 'Produto local cancelado', 'ITEM', 10, 0, 0, 0, 2, 0),
    ('${lineId(5)}', '${orderId(4)}', '${itemId}', 'LOCAL-4', 'Produto local cancelamento completa', 'ITEM', 10, 8, 0, 0, 0, 0);
`);

asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(1)}', 3, '${key(2)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(1)}'`), 0, "PARTIALLY_READY does not enqueue");

asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(2)}', 5, '${key(3)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(2)}'`), 0, "one ready line is still partial");
asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(3)}', 5, '${key(4)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(2)}' and event_type = 'SAFISA_FULLY_READY'`), 1);
asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(3)}', 5, '${key(4)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(2)}'`), 1, "idempotent replay does not duplicate");

asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(4)}', 8, '${key(5)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(3)}'`), 1, "cancelled quantity participates in FULLY_READY");

assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(4)}'`), 0, "ready 8 of 10 remains PARTIALLY_READY");
psql(`update public.supplier_order_items set cancelled_quantity = 2 where id = '${lineId(5)}'`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(4)}' and event_type = 'SAFISA_FULLY_READY'`), 1, "cancellation-only transition enqueues FULLY_READY");
psql(`update public.supplier_order_items set cancelled_quantity = 2 where id = '${lineId(5)}'`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(4)}'`), 1, "cancellation transition replay remains idempotent");

assert.match(asRole("authenticated", ids.internalA, `select public.claim_safisa_fully_ready_push_event('${orderId(2)}')`, true), /permission denied/i);
const claimed = asRole("service_role", null, `select public.claim_safisa_fully_ready_push_event('${orderId(2)}')`);
assert.match(claimed, /SAFISA_FULLY_READY/);
assert.equal(number(`select attempt_count from public.push_notification_events where supplier_order_id = '${orderId(2)}'`), 1);

console.log("SUBSCRIPTIONS/RLS/REASSIGNMENT: PASS");
console.log("PARTIAL/FULL/REPLAY/CANCELLATION PARITY: PASS");
