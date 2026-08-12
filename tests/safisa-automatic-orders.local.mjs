import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const container = process.env.SAFISA_TEST_DB_CONTAINER ?? "supabase_db_nk_current_state_baseline";
const windowsDocker = join(process.env.LOCALAPPDATA ?? "", "Programs", "DockerDesktop", "resources", "bin", "docker.exe");
const docker = existsSync(windowsDocker) ? windowsDocker : "docker";
const ids = {
  internal: "00000000-0000-4000-8000-000000000901",
  safisaA: "00000000-0000-4000-8000-000000000902",
  safisaB: "00000000-0000-4000-8000-000000000903",
  outsider: "00000000-0000-4000-8000-000000000904",
  item: "d9bfc725-87a3-4194-8f51-bdc49d95bd8c",
};
const orderId = (suffix) => `00000000-0000-4000-8000-${String(900 + suffix).padStart(12, "0")}`;
const lineId = (suffix) => `00000000-0000-4000-8000-${String(950 + suffix).padStart(12, "0")}`;
const key = (suffix) => `00000000-0000-4000-8000-${String(990 + suffix).padStart(12, "0")}`;

function psql(sql, { allowFailure = false } = {}) {
  try {
    return execFileSync(docker, ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
    throw error;
  }
}
function asAuthenticated(userId, statement) {
  return psql(`begin; select set_config('request.jwt.claim.sub', '${userId}', true); set local role authenticated; ${statement}; commit;`);
}
function asAuthenticatedFailure(userId, statement, expected) {
  assert.match(psql(`begin; select set_config('request.jwt.claim.sub', '${userId}', true); set local role authenticated; ${statement}; commit;`, { allowFailure: true }), expected);
}
function jsonFrom(output) {
  const value = output.split(/\r?\n/).findLast((line) => line.startsWith("{"));
  assert.ok(value, `Expected JSON: ${output}`);
  return JSON.parse(value);
}
function number(sql) { return Number(psql(sql).split(/\r?\n/).at(-1)); }
function concurrentAuthenticated(userId, statement) {
  const sql = `begin; select set_config('request.jwt.claim.sub', '${userId}', true); set local role authenticated; ${statement}; commit;`;
  return new Promise((resolve, reject) => {
    const child = spawn(docker, ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${stdout}\n${stderr}`.trim())));
  });
}
async function race(first, second) {
  const firstPromise = concurrentAuthenticated(first.userId, first.sql);
  await new Promise((resolve) => setTimeout(resolve, 150));
  return Promise.allSettled([firstPromise, concurrentAuthenticated(second.userId, second.sql)]);
}
function fixtureOrder(suffix, { ready = 0, picked = 0, cancelled = 0 } = {}) {
  return `
    insert into public.supplier_orders (id, negotiation_number, order_date, created_by, created_by_name_snapshot)
    values ('${orderId(suffix)}', '922${String(suffix).padStart(3, "0")}', current_date, '${ids.internal}', 'Internal Local');
    insert into public.supplier_order_items (
      id, supplier_order_id, item_id, code_snapshot, description_snapshot, model_snapshot,
      item_type_snapshot, ordered_quantity, ready_quantity, picked_quantity, stocked_quantity,
      cancelled_quantity, position
    ) values ('${lineId(suffix)}', '${orderId(suffix)}', '${ids.item}', '1', 'SERVO MBF-015',
      'MBF-015', 'SERVO', 10, ${ready}, ${picked}, 0, ${cancelled}, 0);`;
}

console.log("ALVO CONFIRMADO: SUPABASE LOCAL");
assert.equal(psql("select current_database() = 'postgres'"), "t");
psql(`
  truncate table public.safisa_portal_events, public.safisa_order_authorizations,
    public.safisa_portal_members, public.supplier_order_events, public.supplier_order_items,
    public.supplier_orders cascade;
  delete from auth.users where id in ('${ids.internal}', '${ids.safisaA}', '${ids.safisaB}', '${ids.outsider}');
  insert into auth.users (id, aud, role, created_at, updated_at) values
    ('${ids.internal}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.safisaA}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.safisaB}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.outsider}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active) values
    ('${ids.internal}', 'Internal Local', true), ('${ids.safisaA}', 'Safisa A', false),
    ('${ids.safisaB}', 'Safisa B', false), ('${ids.outsider}', 'Outsider', false);
  ${fixtureOrder(1)} ${fixtureOrder(2)} ${fixtureOrder(3)} ${fixtureOrder(4)}
  ${fixtureOrder(5, { ready: 3, picked: 3 })} ${fixtureOrder(6)}
  ${fixtureOrder(7, { ready: 2 })} ${fixtureOrder(8, { ready: 3, picked: 3 })}
  ${fixtureOrder(9)} ${fixtureOrder(10)} ${fixtureOrder(11, { ready: 2 })}
`);

// A-F: all non-cancelled orders are visible solely by their state to every active membership.
asAuthenticatedFailure(ids.outsider, "select public.list_safisa_orders('ACTIVE', 50, 0)", /active Safisa portal membership/i);
asAuthenticated(ids.internal, `select public.set_safisa_portal_member_status('${ids.safisaA}', true, '${key(1)}')`);
asAuthenticated(ids.internal, `select public.set_safisa_portal_member_status('${ids.safisaB}', true, '${key(2)}')`);
asAuthenticated(ids.internal, `select public.publish_supplier_order_to_safisa('${orderId(2)}', '${key(3)}')`);
asAuthenticated(ids.internal, `select public.publish_supplier_order_to_safisa('${orderId(3)}', '${key(4)}')`);
asAuthenticated(ids.internal, `select public.revoke_supplier_order_from_safisa('${orderId(3)}', '${key(5)}')`);
let active = jsonFrom(asAuthenticated(ids.safisaA, "select public.list_safisa_orders('ACTIVE', 100, 0)"));
assert.equal(active.orders.some((order) => order.supplier_order_id === orderId(1)), true, "old order without authorization is visible");
assert.equal(active.orders.some((order) => order.supplier_order_id === orderId(2)), true, "active authorization does not change visibility");
assert.equal(active.orders.some((order) => order.supplier_order_id === orderId(3)), true, "revoked authorization does not change visibility");
assert.equal(active.orders.some((order) => order.supplier_order_id === orderId(4)), true, "new order is automatic");
assert.deepEqual(
  jsonFrom(asAuthenticated(ids.safisaB, "select public.list_safisa_orders('ACTIVE', 100, 0)")).orders.map((order) => order.supplier_order_id).sort(),
  active.orders.map((order) => order.supplier_order_id).sort(),
);

// G-K: strict readiness and atomic stock entry for newly picked deltas.
asAuthenticatedFailure(ids.internal, `select public.set_supplier_order_item_picked_quantity('${lineId(1)}', 1, null, '${key(6)}')`, /cannot exceed ready_quantity/i);
asAuthenticated(ids.safisaA, `select public.increment_safisa_ready_quantity('${lineId(1)}', 3, '${key(7)}')`);
asAuthenticated(ids.internal, `select public.set_supplier_order_item_picked_quantity('${lineId(1)}', 3, null, '${key(8)}')`);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(1)}'`), 3);
asAuthenticated(ids.safisaA, `select public.increment_safisa_ready_quantity('${lineId(5)}', 7, '${key(9)}')`);
asAuthenticated(ids.internal, `select public.mark_supplier_order_all_picked('${orderId(5)}', null, '${key(10)}')`);
active = jsonFrom(asAuthenticated(ids.safisaA, "select public.list_safisa_orders('ACTIVE', 100, 0)"));
assert.equal(active.orders.some((order) => order.supplier_order_id === orderId(5)), false);
const completed = jsonFrom(asAuthenticated(ids.safisaA, "select public.list_safisa_orders('COMPLETED', 100, 0)"));
assert.equal(completed.orders.some((order) => order.supplier_order_id === orderId(5)), true);
assert.equal(jsonFrom(asAuthenticated(ids.safisaA, `select public.get_safisa_order('${orderId(5)}')`)).is_read_only, true);
assert.equal(number(`select stocked_quantity from public.supplier_order_items where id = '${lineId(5)}'`), 7);

// L-N: cancellation is auditable, preserves picked quantities, and blocks ready pending pickup.
asAuthenticated(ids.internal, `select public.cancel_supplier_order('${orderId(6)}', 'Local audited cancellation', '${key(11)}')`);
assert.equal(number(`select count(*) from public.supplier_order_events where supplier_order_id = '${orderId(6)}' and event_type = 'ORDER_CANCELLED'`), 1);
assert.equal(jsonFrom(asAuthenticated(ids.safisaA, "select public.list_safisa_orders('ACTIVE', 100, 0)")).orders.some((order) => order.supplier_order_id === orderId(6)), false);
asAuthenticatedFailure(ids.internal, `select public.cancel_supplier_order('${orderId(7)}', 'Must fail ready pending', '${key(12)}')`, /ready quantities still awaiting pickup/i);
assert.equal(number(`select cancelled_quantity from public.supplier_order_items where id = '${lineId(7)}'`), 0);
asAuthenticated(ids.internal, `select public.cancel_supplier_order_remaining('${orderId(8)}', 'Preserve local pickup', '${key(13)}')`);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(8)}'`), 3);
assert.equal(number(`select cancelled_quantity from public.supplier_order_items where id = '${lineId(8)}'`), 7);

// O: historical authorization remains, but no longer controls pickup or visibility.
assert.equal(number(`select count(*) from public.safisa_order_authorizations where supplier_order_id = '${orderId(2)}'`), 1);
asAuthenticatedFailure(ids.internal, `select public.set_supplier_order_item_picked_quantity('${lineId(2)}', 1, null, '${key(14)}')`, /cannot exceed ready_quantity/i);

// Four real two-session races: no mock concurrency and no invariant breach.
let outcomes = await race(
  { userId: ids.safisaA, sql: `select public.increment_safisa_ready_quantity('${lineId(9)}', 1, '${key(15)}'); select pg_sleep(1)` },
  { userId: ids.internal, sql: `select public.cancel_supplier_order('${orderId(9)}', 'Concurrent cancel', '${key(16)}')` },
);
assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
outcomes = await race(
  { userId: ids.internal, sql: `select public.cancel_supplier_order('${orderId(10)}', 'Concurrent cancel first', '${key(17)}'); select pg_sleep(1)` },
  { userId: ids.safisaB, sql: `select public.increment_safisa_ready_quantity('${lineId(10)}', 1, '${key(18)}')` },
);
assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
outcomes = await race(
  { userId: ids.safisaA, sql: `select public.increment_safisa_ready_quantity('${lineId(11)}', 8, '${key(19)}'); select pg_sleep(1)` },
  { userId: ids.internal, sql: `select public.set_supplier_order_item_picked_quantity('${lineId(11)}', 1, null, '${key(20)}')` },
);
assert.ok(outcomes.filter((outcome) => outcome.status === "fulfilled").length >= 1);
const listDuringFinalPickup = concurrentAuthenticated(ids.safisaA, "select public.list_safisa_orders('ACTIVE', 100, 0)");
asAuthenticated(ids.internal, `select public.mark_supplier_order_all_picked('${orderId(11)}', null, '${key(21)}')`);
await listDuringFinalPickup;
assert.equal(jsonFrom(asAuthenticated(ids.safisaA, "select public.list_safisa_orders('COMPLETED', 100, 0)")).orders.some((order) => order.supplier_order_id === orderId(11)), true);

assert.equal(number("select count(*) from public.supplier_order_items where ready_quantity < picked_quantity or ready_quantity + cancelled_quantity > ordered_quantity or picked_quantity + cancelled_quantity > ordered_quantity or stocked_quantity > picked_quantity"), 0);
console.log("A-O: PASS");
console.log("CONCURRENCY (4 two-session scenarios): PASS");
