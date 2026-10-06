import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync as run, spawn } from "node:child_process";

const container = process.env.SAFISA_TEST_DB_CONTAINER ?? "supabase_db_nk_pr82_push";
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
const idempotentDisableMigration = readFileSync(
  new URL("../supabase/migrations/20260912104748_make_disable_push_subscription_idempotent.sql", import.meta.url),
  "utf8",
);

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
assert.match(container, /^supabase_db_nk_pr82_push[a-z0-9_]*$/);
assert.equal(JSON.parse(run(docker, ["inspect", "-f", "{{json .Config.Labels}}", container], { encoding: "utf8" }))["nk.disposable"], "nk-pr82-push");
assert.equal(psql("select current_database() = 'postgres'"), "t");
assert.equal(psql("select to_regclass('public.push_subscriptions') is not null"), "t");
assert.equal(psql("select to_regclass('public.push_notification_events') is not null"), "t");
psql(idempotentDisableMigration);
if (psql("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='push_notification_events' and column_name='portal_event_id')") === "f") {
  psql(readFileSync(new URL("../supabase/migrations/20261006104415_safisa_item_ready_push_notifications.sql", import.meta.url), "utf8"));
}
assert.equal(psql("select has_function_privilege('authenticated', 'public.disable_push_subscription(uuid,text)', 'execute')"), "t");
assert.equal(psql("select has_function_privilege('anon', 'public.disable_push_subscription(uuid,text)', 'execute')"), "f");
assert.equal(psql(`
  select procedure.prosecdef
    and array_to_string(procedure.proconfig, ',') = 'search_path=""'
  from pg_proc as procedure
  where procedure.oid = 'public.disable_push_subscription(uuid,text)'::regprocedure
`), "t");

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
assert.match(asRole("anon", null, `select public.disable_push_subscription('${deviceId(1)}', '${fid(1)}')`, true), /permission denied|Authentication is required/i);
asAuthenticatedFailure(ids.inactive, `select public.disable_push_subscription('${deviceId(1)}', '${fid(1)}')`, /active internal profile/i);
asAuthenticatedFailure(ids.internalA, `select public.disable_push_subscription('${deviceId(9)}', '')`, /Firebase installation ID is invalid/i);
asAuthenticatedFailure(ids.internalA, `select public.disable_push_subscription('${deviceId(9)}', repeat('x', 513))`, /Firebase installation ID is invalid/i);
asAuthenticatedFailure(ids.internalA, `select public.disable_push_subscription('${deviceId(9)}', 'fid' || chr(1))`, /Firebase installation ID is invalid/i);
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
assert.equal(asAuthenticated(ids.internalB, `select public.disable_push_subscription('${deviceId(9)}', '${fid(1)}')`).includes('"disabled": true'), true, "device_id metadata does not participate in disable");
assert.equal(number(`select count(*) from public.push_subscriptions where firebase_installation_id = '${fid(1)}' and enabled`), 0);
assert.equal(asAuthenticated(ids.internalB, `select public.disable_push_subscription('${deviceId(1)}', '${fid(1)}')`).includes('"disabled": true'), true, "second exact disable remains successful");
assert.equal(number(`select count(*) from public.push_subscriptions where firebase_installation_id = '${fid(1)}' and enabled`), 0);
assert.equal(asAuthenticated(ids.internalB, `select public.disable_push_subscription('${deviceId(9)}', '${fid(9)}')`).includes('"disabled": false'), true, "missing tuple is not confirmed");

asAuthenticated(ids.internalA, `select public.register_push_subscription('${deviceId(2)}', '${fid(2)}')`);
asAuthenticated(ids.internalB, `select public.register_push_subscription('${deviceId(3)}', '${fid(3)}')`);
assert.equal(asAuthenticated(ids.internalB, `select public.disable_push_subscription('${deviceId(2)}', '${fid(2)}')`).includes('"disabled": false'), true, "device B cannot disable device A");
assert.equal(number(`select count(*) from public.push_subscriptions where user_id = '${ids.internalA}' and device_id = '${deviceId(2)}' and firebase_installation_id = '${fid(2)}' and enabled`), 1);
assert.equal(number(`select count(*) from public.push_subscriptions where user_id = '${ids.internalB}' and device_id = '${deviceId(3)}' and firebase_installation_id = '${fid(3)}' and enabled`), 1);

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
assert.equal(number(`select count(*) from public.push_notification_events p join public.supplier_order_items i on i.id=p.supplier_order_item_id
  where p.supplier_order_id = '${orderId(1)}' and p.event_type='SAFISA_ITEM_READY' and p.quantity_delta=3
    and p.code_snapshot=i.code_snapshot and p.description_snapshot=i.description_snapshot`), 1, "partial 3 enqueues the canonical line snapshot and delta");
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id='${orderId(1)}' and event_type='SAFISA_FULLY_READY'`), 0);
asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(1)}', 2, '${key(12)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id='${orderId(1)}' and quantity_delta=2`), 1, "second legitimate operation reports only 2");
const replay = asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(1)}', 3, '${key(2)}')`);
assert.match(replay, /portal_event_id/);
assert.equal(number(`select ready_quantity from public.supplier_order_items where id='${lineId(1)}'`), 5);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id='${orderId(1)}'`), 2);
assert.equal(number(`select count(*) from public.safisa_portal_events where idempotency_key='${key(2)}'`), 1);
asAuthenticatedFailure(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(1)}', 4, '${key(2)}')`, /idempotency_key/i);

asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(2)}', 5, '${key(3)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(2)}' and event_type='SAFISA_ITEM_READY' and quantity_delta=5`), 1, "all remaining of one line enqueues one ITEM_READY");
asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(3)}', 5, '${key(4)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(2)}' and event_type = 'SAFISA_FULLY_READY'`), 1);
asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(3)}', 5, '${key(4)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id = '${orderId(2)}'`), 2, "replay does not duplicate either notification");
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_item_id='${lineId(3)}'`), 0, "last individual action has only FULLY_READY");

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
assert.equal(number(`select attempt_count from public.push_notification_events where supplier_order_id = '${orderId(2)}' and event_type='SAFISA_FULLY_READY'`), 1);

// Multi-line mark-all remains atomic and creates no individual source event.
psql(`insert into public.supplier_orders(id,negotiation_number,order_date,created_by,created_by_name_snapshot)
  values('${orderId(5)}','990005',current_date,'${ids.internalA}','Internal A');
  insert into public.supplier_order_items(id,supplier_order_id,item_id,code_snapshot,description_snapshot,item_type_snapshot,ordered_quantity,position)
  values('${lineId(6)}','${orderId(5)}','${itemId}','1H','SERVO 1H','ITEM',2,0),
  ('${lineId(7)}','${orderId(5)}','${itemId}','2A','SERVO 2A','ITEM',3,1),
  ('${lineId(8)}','${orderId(5)}','${itemId}','6C','SERVO 6C','ITEM',1,2);`);
asAuthenticated(ids.safisa, `select public.mark_safisa_order_remaining_ready('${orderId(5)}','${key(20)}')`);
asAuthenticated(ids.safisa, `select public.mark_safisa_order_remaining_ready('${orderId(5)}','${key(20)}')`);
assert.equal(number(`select sum(ready_quantity) from public.supplier_order_items where supplier_order_id='${orderId(5)}'`), 6);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id='${orderId(5)}'`), 1);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id='${orderId(5)}' and event_type='SAFISA_FULLY_READY'`), 1);
assert.equal(number(`select count(*) from public.safisa_portal_events where supplier_order_id='${orderId(5)}' and event_type='READY_QUANTITY_INCREMENTED'`), 0);

// Positive correction is audit only, never an item notification.
const beforeCorrection = number(`select count(*) from public.push_notification_events where supplier_order_id='${orderId(1)}'`);
const version = psql(`select updated_at from public.supplier_order_items where id='${lineId(1)}'`);
asAuthenticated(ids.safisa, `select public.correct_safisa_ready_quantity('${lineId(1)}',6,'Correcao local',true,'${version}','${key(21)}')`);
assert.equal(number(`select count(*) from public.push_notification_events where supplier_order_id='${orderId(1)}'`), beforeCorrection);

// Concurrent replay and distinct legitimate operations serialize on canonical locks.
function concurrentSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(docker, ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { windowsHide: true });
    let output = "", error = "";
    child.stdout.on("data", value => { output += value; });
    child.stderr.on("data", value => { error += value; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
  });
}
const concurrentIncrement = `begin; select set_config('request.jwt.claim.sub','${ids.safisa}',true); set local role authenticated;
  select public.increment_safisa_ready_quantity('${lineId(1)}',1,'${key(22)}'); commit;`;
await Promise.all(Array.from({ length: 4 }, () => concurrentSql(concurrentIncrement)));
assert.equal(number(`select ready_quantity from public.supplier_order_items where id='${lineId(1)}'`), 7);
assert.equal(number(`select count(*) from public.safisa_portal_events where idempotency_key='${key(22)}'`), 1);
assert.equal(number(`select count(*) from public.push_notification_events where portal_event_id in(select id from public.safisa_portal_events where idempotency_key='${key(22)}')`), 1);

const portalId = psql(`select id from public.safisa_portal_events where idempotency_key='${key(22)}'`);
asAuthenticatedFailure(ids.internalA, `select public.claim_safisa_ready_push_event('${orderId(1)}','${portalId}')`, /permission denied/i);
assert.match(asRole("anon", null, `select public.complete_safisa_ready_push_event('${portalId}',1,'SENT')`, true), /permission denied/i);
const claims = await Promise.all(Array.from({ length: 4 }, () => concurrentSql(`set role service_role; select public.claim_safisa_ready_push_event('${orderId(1)}','${portalId}');`)));
assert.equal(claims.filter(value => value.includes('"event_type"')).length, 1, "one worker wins concurrent claims");
const claimedItem = JSON.parse(claims.find(value => value.includes('"event_type"')));
assert.equal(claimedItem.quantity_delta, 1);
assert.equal(claimedItem.attempt_count, 1);
psql(`update public.push_notification_events set updated_at=now()-interval '11 minutes' where id='${claimedItem.id}'`);
const reclaimed = JSON.parse(asRole("service_role", null, `select public.claim_safisa_ready_push_event('${orderId(1)}','${portalId}')`));
assert.equal(reclaimed.attempt_count, 2);
asRole("service_role", null, `select public.complete_safisa_ready_push_event('${claimedItem.id}',1,'SENT')`);
assert.equal(psql(`select status from public.push_notification_events where id='${claimedItem.id}'`), "SENDING", "expired worker cannot finish newer claim");
asRole("service_role", null, `select public.complete_safisa_ready_push_event('${claimedItem.id}',2,'FAILED','FCM_TIMEOUT')`);
const finalClaim = JSON.parse(asRole("service_role", null, `select public.claim_safisa_ready_push_event('${orderId(1)}','${portalId}')`));
assert.equal(finalClaim.attempt_count, 3);
asRole("service_role", null, `select public.complete_safisa_ready_push_event('${claimedItem.id}',3,'FAILED')`);
assert.equal(asRole("service_role", null, `select public.claim_safisa_ready_push_event('${orderId(1)}','${portalId}')`), "");

// Hold a row lock without changing status: SKIP LOCKED must return immediately.
const lockHolder = spawn(docker, ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { windowsHide: true });
const locked = new Promise((resolve, reject) => {
  lockHolder.stdout.on("data", value => { if (value.toString().includes("ROW_LOCKED")) resolve(); });
  lockHolder.on("error", reject);
});
const lockDone = new Promise((resolve, reject) => { lockHolder.on("close", code => code === 0 ? resolve() : reject(new Error("lock-holder failed"))); });
const firstPortal = psql(`select id from public.safisa_portal_events where idempotency_key='${key(2)}'`);
lockHolder.stdin.write(`begin; select id from public.push_notification_events where portal_event_id='${firstPortal}' for update; select 'ROW_LOCKED';\n`);
await locked;
assert.equal(asRole("service_role", null, `set local statement_timeout='1s'; select public.claim_safisa_ready_push_event('${orderId(1)}','${firstPortal}')`), "", "locked row is skipped, not waited on");
lockHolder.stdin.end("rollback;\n");
await lockDone;

// FK reset order: queue before immutable portal audit, then lines/orders. Keep
// the historic deployment-reset contract fail-closed, never refresh it blindly.
assert.equal(number(`select count(*) from public.push_notification_events p left join public.safisa_portal_events e on e.id=p.portal_event_id
  where p.event_type='SAFISA_ITEM_READY' and (e.id is null or e.event_type <> 'READY_QUANTITY_INCREMENTED'
    or e.quantity_delta<>p.quantity_delta or e.supplier_order_item_id<>p.supplier_order_item_id or e.supplier_order_id<>p.supplier_order_id)`), 0);
assert.equal(psql("select has_table_privilege('authenticated','public.push_notification_events','select') or has_table_privilege('authenticated','public.push_notification_events','insert')"), "f");
assert.equal(psql("select has_function_privilege('authenticated','private.enqueue_safisa_item_ready_push()','execute')"), "f");
for (const signature of ["public.claim_safisa_ready_push_event(uuid,uuid)", "public.complete_safisa_ready_push_event(uuid,integer,text,text)"]) {
  assert.equal(psql(`select has_function_privilege('authenticated','${signature}','execute') or has_function_privilege('anon','${signature}','execute')`), "f");
  assert.equal(psql(`select has_function_privilege('service_role','${signature}','execute')`), "t");
  assert.equal(psql(`select prosecdef and array_to_string(proconfig,',')='search_path=""' from pg_proc where oid='${signature}'::regprocedure`), "t");
}
const queueBeforeReset = number("select count(*) from public.push_notification_events");
assert.ok(queueBeforeReset > 0);
psql(`begin;
  delete from public.push_notification_events;
  alter table public.safisa_portal_events disable trigger safisa_portal_events_reject_mutation;
  delete from public.safisa_portal_events where event_type in('MEMBER_STATUS_CHANGED','ORDER_PUBLISHED','ORDER_REVOKED','READY_QUANTITY_INCREMENTED','READY_QUANTITIES_ALL_MARKED');
  alter table public.safisa_portal_events enable trigger safisa_portal_events_reject_mutation;
  rollback;`);
assert.equal(number("select count(*) from public.push_notification_events"), queueBeforeReset, "local reset FK rehearsal rolls back every row");

console.log("SUBSCRIPTIONS/RLS/REASSIGNMENT: PASS");
console.log("PARTIAL/FULL/REPLAY/CANCELLATION PARITY: PASS");
console.log("ITEM DELTAS / CORRECTION / MARK-ALL ONE PUSH / CONCURRENT REPLAY / SKIP LOCKED / LEASE FENCING: PASS");
console.log("NEW RPC GRANTS / RLS / RESET FK ORDER WITH FULL ROLLBACK: PASS");
