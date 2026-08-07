import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const container =
  process.env.SAFISA_TEST_DB_CONTAINER ??
  "supabase_db_nk_current_state_baseline";
const windowsDocker = join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "DockerDesktop",
  "resources",
  "bin",
  "docker.exe",
);
const docker = existsSync(windowsDocker) ? windowsDocker : "docker";

const ids = {
  internal: "00000000-0000-4000-8000-000000000101",
  safisaA: "00000000-0000-4000-8000-000000000102",
  safisaB: "00000000-0000-4000-8000-000000000103",
  outsider: "00000000-0000-4000-8000-000000000104",
  item: "d9bfc725-87a3-4194-8f51-bdc49d95bd8c",
};

const orderId = (suffix) =>
  `00000000-0000-4000-8000-${String(200 + suffix).padStart(12, "0")}`;
const lineId = (suffix) =>
  `00000000-0000-4000-8000-${String(300 + suffix).padStart(12, "0")}`;
const key = (suffix) =>
  `00000000-0000-4000-8000-${String(500 + suffix).padStart(12, "0")}`;

function psql(sql, { allowFailure = false } = {}) {
  try {
    return execFileSync(
      docker,
      [
        "exec",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    if (allowFailure) {
      return `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
    }
    throw error;
  }
}

function asAuthenticated(userId, statement) {
  return psql(`
    begin;
    do $context$ begin
      perform set_config('request.jwt.claim.sub', '${userId}', true);
    end $context$;
    set local role authenticated;
    ${statement};
    commit;
  `);
}

function asAuthenticatedFailure(userId, statement, expected) {
  const output = psql(
    `
      begin;
      do $context$ begin
        perform set_config('request.jwt.claim.sub', '${userId}', true);
      end $context$;
      set local role authenticated;
      ${statement};
      commit;
    `,
    { allowFailure: true },
  );
  assert.match(output, expected);
}

function number(sql) {
  return Number(psql(sql).split(/\r?\n/).at(-1));
}

function jsonFrom(output) {
  const line = output.split(/\r?\n/).findLast((value) => value.startsWith("{"));
  assert.ok(line, `Expected a JSON result, received: ${output}`);
  return JSON.parse(line);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function concurrentAuthenticated(userId, statement) {
  const sql = `
    begin;
    do $context$ begin
      perform set_config('request.jwt.claim.sub', '${userId}', true);
    end $context$;
    set local role authenticated;
    ${statement};
    commit;
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      docker,
      [
        "exec",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${stdout}\n${stderr}`.trim()));
    });
  });
}

async function race(first, second) {
  const firstPromise = concurrentAuthenticated(first.userId, first.sql);
  await delay(150);
  const secondPromise = concurrentAuthenticated(second.userId, second.sql);
  return Promise.allSettled([firstPromise, secondPromise]);
}

function expectOneConflict(results, pattern) {
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.match(rejected.reason.message, pattern);
}

function fixtureOrder(suffix, { ready = 0, picked = 0, cancelled = 0, closed = false } = {}) {
  return `
    insert into public.supplier_orders (
      id, negotiation_number, order_date, created_by,
      created_by_name_snapshot${closed ? ", finalized_at, finalized_by, finalized_by_name_snapshot" : ""}
    ) values (
      '${orderId(suffix)}', 'SAF-LOCAL-${suffix}', current_date, '${ids.internal}',
      'Internal Local'${closed ? `, now(), '${ids.internal}', 'Internal Local'` : ""}
    );
    insert into public.supplier_order_items (
      id, supplier_order_id, item_id, code_snapshot, description_snapshot,
      model_snapshot, item_type_snapshot, ordered_quantity, ready_quantity,
      picked_quantity, stocked_quantity, cancelled_quantity, position
    ) values (
      '${lineId(suffix)}', '${orderId(suffix)}', '${ids.item}', '1',
      'SERVO MBF-015', 'MBF-015', 'SERVO', 10, ${ready}, ${picked}, 0,
      ${cancelled}, 0
    );
  `;
}

console.log("ALVO CONFIRMADO: SUPABASE LOCAL");
assert.equal(
  psql("select current_database() = 'postgres';"),
  "t",
  "The disposable local postgres container must be available",
);

psql(`
  truncate table
    public.safisa_portal_events,
    public.safisa_order_authorizations,
    public.safisa_portal_members,
    public.supplier_order_events,
    public.supplier_order_items,
    public.supplier_orders
  cascade;
  delete from auth.users where id in (
    '${ids.internal}', '${ids.safisaA}', '${ids.safisaB}', '${ids.outsider}'
  );
  insert into auth.users (id, aud, role, created_at, updated_at)
  values
    ('${ids.internal}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.safisaA}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.safisaB}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.outsider}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active)
  values
    ('${ids.internal}', 'Internal Local', true),
    ('${ids.safisaA}', 'Safisa A', false),
    ('${ids.safisaB}', 'Safisa B', false),
    ('${ids.outsider}', 'External Local', false);
  ${Array.from({ length: 14 }, (_, index) =>
    fixtureOrder(index + 1, {
      ready: index === 1 ? 4 : index >= 9 ? (index === 11 ? 5 : index === 12 ? 2 : index === 13 ? 3 : 0) : 0,
      picked: 0,
      closed: index === 1,
    }),
  ).join("\n")}
`);

// A. Membership and identity isolation.
asAuthenticatedFailure(
  ids.outsider,
  "select public.list_safisa_authorized_orders(50, 0)",
  /active Safisa portal membership/i,
);
asAuthenticated(
  ids.internal,
  `select public.set_safisa_portal_member_status('${ids.safisaA}', true, '${key(1)}')`,
);
asAuthenticated(
  ids.internal,
  `select public.set_safisa_portal_member_status('${ids.safisaB}', true, '${key(2)}')`,
);
assert.equal(
  psql(`select is_active from public.profiles where id = '${ids.safisaA}'`),
  "f",
);
asAuthenticated(ids.safisaA, "select public.list_safisa_authorized_orders(50, 0)");
asAuthenticated(
  ids.internal,
  `select public.set_safisa_portal_member_status('${ids.safisaB}', false, '${key(3)}')`,
);
asAuthenticatedFailure(
  ids.safisaB,
  "select public.list_safisa_authorized_orders(50, 0)",
  /active Safisa portal membership/i,
);
asAuthenticated(
  ids.internal,
  `select public.set_safisa_portal_member_status('${ids.safisaB}', true, '${key(4)}')`,
);

// B. Explicit publication, isolated visibility, revocation, and closed read-only state.
let list = jsonFrom(
  asAuthenticated(ids.safisaA, "select public.list_safisa_authorized_orders(50, 0)"),
);
assert.equal(list.total, 0);
asAuthenticated(
  ids.internal,
  `select public.publish_supplier_order_to_safisa('${orderId(1)}', '${key(5)}')`,
);
list = jsonFrom(
  asAuthenticated(ids.safisaA, "select public.list_safisa_authorized_orders(50, 0)"),
);
assert.equal(list.total, 1);
assert.equal(list.orders[0].supplier_order_id, orderId(1));
asAuthenticated(
  ids.internal,
  `select public.revoke_supplier_order_from_safisa('${orderId(1)}', '${key(6)}')`,
);
list = jsonFrom(
  asAuthenticated(ids.safisaA, "select public.list_safisa_authorized_orders(50, 0)"),
);
assert.equal(list.total, 0);
asAuthenticated(
  ids.internal,
  `select public.publish_supplier_order_to_safisa('${orderId(1)}', '${key(7)}')`,
);
asAuthenticated(
  ids.internal,
  `select public.publish_supplier_order_to_safisa('${orderId(2)}', '${key(8)}')`,
);
const closedOrder = jsonFrom(
  asAuthenticated(ids.safisaA, `select public.get_safisa_authorized_order('${orderId(2)}')`),
);
assert.equal(closedOrder.is_read_only, true);
asAuthenticatedFailure(
  ids.safisaA,
  `select public.increment_safisa_ready_quantity('${lineId(2)}', 1, '${key(9)}')`,
  /closed supplier order/i,
);

// C. Ready quantity, bounds, replay, key conflict, and exact remainder.
const increment = jsonFrom(
  asAuthenticated(
    ids.safisaA,
    `select public.increment_safisa_ready_quantity('${lineId(1)}', 2, '${key(10)}')`,
  ),
);
assert.equal(increment.new_ready_quantity, 2);
const replay = jsonFrom(
  asAuthenticated(
    ids.safisaA,
    `select public.increment_safisa_ready_quantity('${lineId(1)}', 2, '${key(10)}')`,
  ),
);
assert.equal(replay.idempotent_replay, true);
assert.equal(
  number(`select count(*) from public.safisa_portal_events where idempotency_key = '${key(10)}'`),
  1,
);
asAuthenticatedFailure(
  ids.safisaA,
  `select public.increment_safisa_ready_quantity('${lineId(1)}', 1, '${key(10)}')`,
  /different Safisa portal request/i,
);
asAuthenticatedFailure(
  ids.safisaA,
  `select public.increment_safisa_ready_quantity('${lineId(1)}', 9, '${key(11)}')`,
  /cannot exceed/i,
);
jsonFrom(
  asAuthenticated(
    ids.safisaA,
    `select public.increment_safisa_ready_quantity('${lineId(1)}', 8, '${key(12)}')`,
  ),
);
assert.equal(number(`select ready_quantity from public.supplier_order_items where id = '${lineId(1)}'`), 10);

// A/G. A second Safisa identity remains individually attributable.
asAuthenticated(
  ids.internal,
  `select public.publish_supplier_order_to_safisa('${orderId(3)}', '${key(13)}')`,
);
asAuthenticated(
  ids.safisaB,
  `select public.increment_safisa_ready_quantity('${lineId(3)}', 1, '${key(14)}')`,
);
assert.equal(
  psql(`select actor_name_snapshot from public.safisa_portal_events where idempotency_key = '${key(14)}'`),
  "Safisa B",
);

// D. Absolute correction requirements, optimistic versioning, and lower bound.
asAuthenticated(
  ids.internal,
  `select public.publish_supplier_order_to_safisa('${orderId(4)}', '${key(15)}')`,
);
let version = psql(`select updated_at from public.supplier_order_items where id = '${lineId(4)}'`);
asAuthenticatedFailure(
  ids.safisaA,
  `select public.correct_safisa_ready_quantity('${lineId(4)}', 2, '', true, '${version}', '${key(16)}')`,
  /justification/i,
);
asAuthenticatedFailure(
  ids.safisaA,
  `select public.correct_safisa_ready_quantity('${lineId(4)}', 2, 'Local correction', false, '${version}', '${key(17)}')`,
  /explicit confirmation/i,
);
const corrected = jsonFrom(
  asAuthenticated(
    ids.safisaA,
    `select public.correct_safisa_ready_quantity('${lineId(4)}', 3, 'Local correction', true, '${version}', '${key(18)}')`,
  ),
);
assert.equal(corrected.new_ready_quantity, 3);
asAuthenticatedFailure(
  ids.safisaA,
  `select public.correct_safisa_ready_quantity('${lineId(4)}', 4, 'Stale local correction', true, '${version}', '${key(19)}')`,
  /version_conflict/i,
);

// E. Internal pickup is bounded by ready quantity and bulk pickup uses ready only.
asAuthenticated(
  ids.internal,
  `select public.set_supplier_order_item_picked_quantity('${lineId(4)}', 2, null, '${key(20)}')`,
);
version = psql(`select updated_at from public.supplier_order_items where id = '${lineId(4)}'`);
asAuthenticatedFailure(
  ids.safisaA,
  `select public.correct_safisa_ready_quantity('${lineId(4)}', 1, 'Below picked', true, '${version}', '${key(21)}')`,
  /lower than picked_quantity/i,
);
asAuthenticatedFailure(
  ids.safisaA,
  `select public.set_supplier_order_item_picked_quantity('${lineId(4)}', 3, null, '${key(22)}')`,
  /active profile/i,
);
asAuthenticatedFailure(
  ids.internal,
  `select public.set_supplier_order_item_picked_quantity('${lineId(4)}', 4, null, '${key(23)}')`,
  /cannot exceed ready_quantity/i,
);
asAuthenticated(
  ids.internal,
  `select public.mark_supplier_order_all_picked('${orderId(4)}', null, '${key(24)}')`,
);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(4)}'`), 3);

// F. Cancellation/edit invariants are enforced atomically by constraints/triggers.
psql(`begin; update public.supplier_order_items set cancelled_quantity = 7 where id = '${lineId(4)}'; rollback;`);
assert.match(
  psql(`begin; update public.supplier_order_items set cancelled_quantity = 8 where id = '${lineId(4)}'; commit;`, { allowFailure: true }),
  /not ready|violates check constraint/i,
);
assert.match(
  psql(`begin; update public.supplier_order_items set ordered_quantity = 2 where id = '${lineId(4)}'; commit;`, { allowFailure: true }),
  /not ready|cannot be lower|violates check constraint/i,
);
const beforeAtomic = number(`select ready_quantity from public.supplier_order_items where id = '${lineId(4)}'`);
psql(`
  begin;
  update public.supplier_order_items set notes = 'temporary local change' where id = '${lineId(4)}';
  update public.supplier_order_items set ordered_quantity = 1 where id = '${lineId(4)}';
  commit;
`, { allowFailure: true });
assert.equal(number(`select ready_quantity from public.supplier_order_items where id = '${lineId(4)}'`), beforeAtomic);
assert.equal(psql(`select notes is null from public.supplier_order_items where id = '${lineId(4)}'`), "t");

// G. Audit targets, deltas, justification, timestamps, and immutable rows.
assert.equal(
  number(`select count(*) from public.safisa_portal_events where actor_user_id in ('${ids.safisaA}', '${ids.safisaB}') and created_at is not null`),
  4,
);
assert.equal(
  psql(`select justification from public.safisa_portal_events where idempotency_key = '${key(18)}'`),
  "Local correction",
);
assert.match(
  psql("update public.safisa_portal_events set actor_name_snapshot = 'tampered'", { allowFailure: true }),
  /immutable/i,
);

// H. Grants and runtime authorization prevent direct Safisa/internal crossover.
assert.equal(
  psql("select has_table_privilege('authenticated', 'public.supplier_orders', 'update')"),
  "f",
);
assert.equal(
  psql("select has_table_privilege('authenticated', 'public.safisa_portal_members', 'select')"),
  "f",
);
assert.equal(
  psql("select has_function_privilege('authenticated', 'public.increment_safisa_ready_quantity(uuid,integer,uuid)', 'execute')"),
  "t",
);
asAuthenticatedFailure(
  ids.internal,
  "select public.list_safisa_authorized_orders(50, 0)",
  /active Safisa portal membership/i,
);
asAuthenticatedFailure(
  ids.safisaA,
  "update public.supplier_orders set notes = 'forbidden'",
  /permission denied/i,
);

// Publish the five independent concurrency fixtures.
for (let suffix = 10; suffix <= 14; suffix += 1) {
  asAuthenticated(
    ids.internal,
    `select public.publish_supplier_order_to_safisa('${orderId(suffix)}', '${key(30 + suffix)}')`,
  );
}

// C1. Two real sessions increment the same line without a lost update.
let results = await race(
  {
    userId: ids.safisaA,
    sql: `select public.increment_safisa_ready_quantity('${lineId(10)}', 1, '${key(50)}'); select pg_sleep(1)`,
  },
  {
    userId: ids.safisaB,
    sql: `select public.increment_safisa_ready_quantity('${lineId(10)}', 1, '${key(51)}')`,
  },
);
assert.equal(results.every(({ status }) => status === "fulfilled"), true);
assert.equal(number(`select ready_quantity from public.supplier_order_items where id = '${lineId(10)}'`), 2);

// C2. An increment makes a concurrent absolute correction stale.
version = psql(`select updated_at from public.supplier_order_items where id = '${lineId(11)}'`);
results = await race(
  {
    userId: ids.safisaA,
    sql: `select public.increment_safisa_ready_quantity('${lineId(11)}', 1, '${key(52)}'); select pg_sleep(1)`,
  },
  {
    userId: ids.safisaB,
    sql: `select public.correct_safisa_ready_quantity('${lineId(11)}', 2, 'Concurrent correction', true, '${version}', '${key(53)}')`,
  },
);
expectOneConflict(results, /version_conflict/i);
assert.equal(number(`select ready_quantity from public.supplier_order_items where id = '${lineId(11)}'`), 1);

// C3. Two pickups with the same order version cannot both commit.
let orderVersion = psql(`select updated_at from public.supplier_orders where id = '${orderId(12)}'`);
results = await race(
  {
    userId: ids.internal,
    sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(12)}', 2, null, '${orderVersion}', '${key(54)}'); select pg_sleep(1)`,
  },
  {
    userId: ids.internal,
    sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(12)}', 3, null, '${orderVersion}', '${key(55)}')`,
  },
);
expectOneConflict(results, /version_conflict/i);
assert.ok([2, 3].includes(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(12)}'`)));

// C4. Pickup versus increment serializes and rejects the stale pickup version.
orderVersion = psql(`select updated_at from public.supplier_orders where id = '${orderId(13)}'`);
results = await race(
  {
    userId: ids.safisaA,
    sql: `select public.increment_safisa_ready_quantity('${lineId(13)}', 1, '${key(56)}'); select pg_sleep(1)`,
  },
  {
    userId: ids.internal,
    sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(13)}', 1, null, '${orderVersion}', '${key(57)}')`,
  },
);
expectOneConflict(results, /version_conflict/i);
assert.equal(number(`select ready_quantity from public.supplier_order_items where id = '${lineId(13)}'`), 3);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(13)}'`), 0);

// C5. Correction versus pickup also rejects the stale order operation.
version = psql(`select updated_at from public.supplier_order_items where id = '${lineId(14)}'`);
orderVersion = psql(`select updated_at from public.supplier_orders where id = '${orderId(14)}'`);
results = await race(
  {
    userId: ids.safisaA,
    sql: `select public.correct_safisa_ready_quantity('${lineId(14)}', 4, 'Concurrent correction', true, '${version}', '${key(58)}'); select pg_sleep(1)`,
  },
  {
    userId: ids.internal,
    sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(14)}', 2, null, '${orderVersion}', '${key(59)}')`,
  },
);
expectOneConflict(results, /version_conflict/i);
assert.equal(number(`select ready_quantity from public.supplier_order_items where id = '${lineId(14)}'`), 4);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(14)}'`), 0);

assert.equal(
  number("select count(*) from public.supplier_order_items where ready_quantity < picked_quantity or ready_quantity + cancelled_quantity > ordered_quantity"),
  0,
);

console.log("A-H: PASS");
console.log("CONCURRENCY (5 two-session scenarios): PASS");
