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
  internal: "10000000-0000-4000-8000-000000000101",
  safisa: "10000000-0000-4000-8000-000000000102",
  item: "d9bfc725-87a3-4194-8f51-bdc49d95bd8c",
};
const orderId = (suffix) =>
  `10000000-0000-4000-8000-${String(200 + suffix).padStart(12, "0")}`;
const lineId = (suffix) =>
  `10000000-0000-4000-8000-${String(300 + suffix).padStart(12, "0")}`;
const key = (suffix) =>
  `10000000-0000-4000-8000-${String(500 + suffix).padStart(12, "0")}`;

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

function authSql(userId, statement) {
  return `
    begin;
    do $context$ begin
      perform set_config('request.jwt.claim.sub', '${userId}', true);
    end $context$;
    set local role authenticated;
    ${statement};
    commit;
  `;
}

function asAuthenticated(userId, statement) {
  return psql(authSql(userId, statement));
}

function asAuthenticatedFailure(userId, statement, expected) {
  assert.match(psql(authSql(userId, statement), { allowFailure: true }), expected);
}

function number(sql) {
  return Number(psql(sql).split(/\r?\n/).at(-1));
}

function jsonFrom(output) {
  const line = output.split(/\r?\n/).findLast((value) => value.startsWith("{"));
  assert.ok(line, `Expected JSON, received: ${output}`);
  return JSON.parse(line);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function concurrent(userId, statement) {
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
        authSql(userId, statement),
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
  const firstPromise = concurrent(first.userId, first.sql);
  await delay(150);
  const secondPromise = concurrent(second.userId, second.sql);
  return Promise.allSettled([firstPromise, secondPromise]);
}

function expectOneFailure(results, pattern) {
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.match(
    results.find(({ status }) => status === "rejected").reason.message,
    pattern,
  );
}

function orderSql(suffix) {
  return `
    insert into public.supplier_orders (
      id, negotiation_number, order_date, created_by, created_by_name_snapshot
    ) values (
      '${orderId(suffix)}', '921${String(suffix).padStart(3, "0")}', current_date,
      '${ids.internal}', 'Internal Local'
    );
  `;
}

function lineSql(suffix, orderSuffix, position, { ordered = 5, picked = 0, stocked = 0, cancelled = 0 } = {}) {
  return `
    insert into public.supplier_order_items (
      id, supplier_order_id, item_id, code_snapshot, description_snapshot,
      model_snapshot, item_type_snapshot, ordered_quantity, ready_quantity,
      picked_quantity, stocked_quantity, cancelled_quantity, position
    ) values (
      '${lineId(suffix)}', '${orderId(orderSuffix)}', '${ids.item}', '1',
      'SERVO MBF-015', 'MBF-015', 'SERVO', ${ordered}, ${picked}, ${picked},
      ${stocked}, ${cancelled}, ${position}
    );
  `;
}

console.log("ALVO CONFIRMADO: SUPABASE LOCAL");
assert.equal(psql("select current_database() = 'postgres'"), "t");
assert.equal(
  psql("select exists(select 1 from supabase_migrations.schema_migrations where version = '20260807091653')"),
  "t",
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
  delete from auth.users where id in ('${ids.internal}', '${ids.safisa}');
  insert into auth.users (id, aud, role, created_at, updated_at)
  values
    ('${ids.internal}', 'authenticated', 'authenticated', now(), now()),
    ('${ids.safisa}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active)
  values
    ('${ids.internal}', 'Internal Local', true),
    ('${ids.safisa}', 'Safisa Local', false);

  ${Array.from({ length: 10 }, (_, index) => orderSql(index + 1)).join("\n")}

  ${lineSql(1, 1, 0, { ordered: 10, picked: 3 })}
  ${lineSql(2, 1, 1, { ordered: 1 })}
  ${lineSql(3, 1, 2, { ordered: 4 })}
  ${lineSql(4, 2, 0, { picked: 2 })}
  ${lineSql(5, 2, 1)}
  ${lineSql(6, 2, 2)}
  ${lineSql(7, 3, 0, { picked: 1 })}
  ${lineSql(8, 3, 1)}
  ${lineSql(9, 3, 2)}
  ${lineSql(10, 4, 0, { picked: 2 })}
  ${lineSql(11, 4, 1)}
  ${lineSql(12, 4, 2)}
  ${lineSql(13, 5, 0, { picked: 1 })}
  ${lineSql(14, 5, 1)}

  ${lineSql(15, 6, 0, { ordered: 10 })}
  ${lineSql(16, 7, 0, { ordered: 10, picked: 3 })}
  ${lineSql(17, 8, 0, { ordered: 10 })}
  ${lineSql(18, 9, 0, { ordered: 10, picked: 3 })}
  ${lineSql(19, 10, 0, { ordered: 10, picked: 3 })}
`);

// Build the already-stocked fixture through the canonical local RPC so the
// linked batch, inbound line, and allocation invariants remain truthful.
for (const [lineSuffix, orderSuffix, quantity, keySuffix] of [
  [1, 1, 1, 41],
  [4, 2, 1, 42],
  [10, 4, 2, 43],
]) {
  asAuthenticated(
    ids.internal,
    `select public.create_supplier_order_stock_entry(
      '${orderId(orderSuffix)}',
      '[{"supplier_order_item_id":"${lineId(lineSuffix)}","quantity":${quantity}}]'::jsonb,
      'Local transition fixture',
      (select updated_at from public.supplier_orders where id = '${orderId(orderSuffix)}'),
      '${key(keySuffix)}'
    )`,
  );
}

// Five active legacy orders reproduce the aggregate shape without real data.
assert.equal(number("select count(*) from public.supplier_orders where id in ('10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000202','10000000-0000-4000-8000-000000000203','10000000-0000-4000-8000-000000000204','10000000-0000-4000-8000-000000000205')"), 5);
assert.equal(number("select count(*) from public.supplier_order_items where supplier_order_id in ('10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000202','10000000-0000-4000-8000-000000000203','10000000-0000-4000-8000-000000000204','10000000-0000-4000-8000-000000000205')"), 14);
assert.equal(number("select sum(ordered_quantity - picked_quantity - cancelled_quantity) from public.supplier_order_items where supplier_order_id in ('10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000202','10000000-0000-4000-8000-000000000203','10000000-0000-4000-8000-000000000204','10000000-0000-4000-8000-000000000205')"), 61);
assert.equal(number("select count(*) from public.safisa_order_authorizations"), 0);
assert.equal(number("select count(*) from public.safisa_portal_members"), 0);
assert.equal(number("select count(*) from public.safisa_portal_events"), 0);

// Legacy single-line pickup advances ready atomically and does not touch stock.
let result = jsonFrom(asAuthenticated(
  ids.internal,
  `select public.set_supplier_order_item_picked_quantity('${lineId(1)}', 5, 'Legacy local pickup', '${key(1)}')`,
));
assert.equal(result.new_picked_quantity, 5);
assert.equal(result.ready_quantity, 5);
assert.equal(number(`select stocked_quantity from public.supplier_order_items where id = '${lineId(1)}'`), 1);
assert.equal(number("select count(*) from public.safisa_order_authorizations"), 0);
assert.equal(number("select count(*) from public.safisa_portal_events"), 0);

// Publication is the irreversible transition to Safisa-managed behavior.
asAuthenticated(
  ids.internal,
  `select public.publish_supplier_order_to_safisa('${orderId(1)}', '${key(2)}')`,
);
asAuthenticatedFailure(
  ids.internal,
  `select public.set_supplier_order_item_picked_quantity('${lineId(1)}', 6, null, '${key(3)}')`,
  /cannot exceed ready_quantity/i,
);
asAuthenticated(
  ids.internal,
  `select public.set_safisa_portal_member_status('${ids.safisa}', true, '${key(4)}')`,
);
asAuthenticated(
  ids.safisa,
  `select public.increment_safisa_ready_quantity('${lineId(1)}', 2, '${key(5)}')`,
);
asAuthenticated(
  ids.internal,
  `select public.set_supplier_order_item_picked_quantity('${lineId(1)}', 7, null, '${key(6)}')`,
);
asAuthenticated(
  ids.internal,
  `select public.revoke_supplier_order_from_safisa('${orderId(1)}', '${key(7)}')`,
);
asAuthenticatedFailure(
  ids.internal,
  `select public.set_supplier_order_item_picked_quantity('${lineId(1)}', 8, null, '${key(8)}')`,
  /cannot exceed ready_quantity/i,
);
assert.equal(
  psql(`select is_authorized from public.safisa_order_authorizations where supplier_order_id = '${orderId(1)}'`),
  "f",
);

// Legacy bulk pickup uses the old uncancelled target and advances ready.
result = jsonFrom(asAuthenticated(
  ids.internal,
  `select public.mark_supplier_order_all_picked('${orderId(2)}', 'Legacy bulk pickup', '${key(9)}')`,
));
assert.equal(result.changed_line_count, 3);
assert.equal(number(`select count(*) from public.supplier_order_items where supplier_order_id = '${orderId(2)}' and picked_quantity = ordered_quantity - cancelled_quantity and ready_quantity = picked_quantity`), 3);
assert.equal(number(`select sum(stocked_quantity) from public.supplier_order_items where supplier_order_id = '${orderId(2)}'`), 1);
assert.equal(number(`select count(*) from public.safisa_portal_events where supplier_order_id = '${orderId(2)}'`), 0);

// Managed bulk pickup remains ready-only.
asAuthenticated(ids.internal, `select public.publish_supplier_order_to_safisa('${orderId(3)}', '${key(10)}')`);
asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(7)}', 2, '${key(11)}')`);
asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(8)}', 2, '${key(12)}')`);
asAuthenticated(ids.internal, `select public.mark_supplier_order_all_picked('${orderId(3)}', null, '${key(13)}')`);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(7)}'`), 3);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(8)}'`), 2);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(9)}'`), 0);

// Legacy ready surplus is excluded from Safisa alerts until first publication.
asAuthenticated(ids.internal, `select public.set_supplier_order_item_picked_quantity('${lineId(11)}', 2, null, '${key(14)}')`);
asAuthenticated(ids.internal, `select public.set_supplier_order_item_picked_quantity('${lineId(11)}', 1, null, '${key(15)}')`);
let alerts = jsonFrom(asAuthenticated(ids.internal, "select public.list_safisa_ready_pickup_alerts(100)"));
assert.equal(alerts.alerts.some((alert) => alert.supplier_order_id === orderId(4)), false);
asAuthenticated(ids.internal, `select public.publish_supplier_order_to_safisa('${orderId(4)}', '${key(16)}')`);
alerts = jsonFrom(asAuthenticated(ids.internal, "select public.list_safisa_ready_pickup_alerts(100)"));
assert.equal(alerts.alerts.some((alert) => alert.supplier_order_id === orderId(4)), true);

// Concurrency 1: two legacy pickups serialize; one checked version wins.
let version = psql(`select updated_at from public.supplier_orders where id = '${orderId(6)}'`);
let outcomes = await race(
  { userId: ids.internal, sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(15)}', 2, null, '${version}', '${key(20)}'); select pg_sleep(1)` },
  { userId: ids.internal, sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(15)}', 3, null, '${version}', '${key(21)}')` },
);
expectOneFailure(outcomes, /version_conflict/i);
assert.equal(psql(`select ready_quantity = picked_quantity from public.supplier_order_items where id = '${lineId(15)}'`), "t");

// Concurrency 2: legacy pickup versus linked stock entry has one stale loser.
version = psql(`select updated_at from public.supplier_orders where id = '${orderId(7)}'`);
outcomes = await race(
  { userId: ids.internal, sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(16)}', 4, null, '${version}', '${key(22)}'); select pg_sleep(1)` },
  { userId: ids.internal, sql: `select public.create_supplier_order_stock_entry('${orderId(7)}', jsonb_build_array(jsonb_build_object('supplier_order_item_id','${lineId(16)}','quantity',1)), null, '${version}', '${key(23)}')` },
);
expectOneFailure(outcomes, /version_conflict|changed after it was loaded/i);
assert.equal(psql(`select ready_quantity >= picked_quantity and stocked_quantity <= picked_quantity from public.supplier_order_items where id = '${lineId(16)}'`), "t");

// Concurrency 3: managed pickups preserve the existing ready bound.
asAuthenticated(ids.internal, `select public.publish_supplier_order_to_safisa('${orderId(8)}', '${key(24)}')`);
asAuthenticated(ids.safisa, `select public.increment_safisa_ready_quantity('${lineId(17)}', 2, '${key(25)}')`);
version = psql(`select updated_at from public.supplier_orders where id = '${orderId(8)}'`);
outcomes = await race(
  { userId: ids.internal, sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(17)}', 1, null, '${version}', '${key(26)}'); select pg_sleep(1)` },
  { userId: ids.internal, sql: `select public.set_supplier_order_item_picked_quantity_checked('${lineId(17)}', 2, null, '${version}', '${key(27)}')` },
);
expectOneFailure(outcomes, /version_conflict/i);
assert.equal(psql(`select picked_quantity <= ready_quantity from public.supplier_order_items where id = '${lineId(17)}'`), "t");

// Concurrency 4: publication first makes the waiting pickup managed.
outcomes = await race(
  { userId: ids.internal, sql: `select public.publish_supplier_order_to_safisa('${orderId(9)}', '${key(28)}'); select pg_sleep(1)` },
  { userId: ids.internal, sql: `select public.set_supplier_order_item_picked_quantity('${lineId(18)}', 5, null, '${key(29)}')` },
);
expectOneFailure(outcomes, /cannot exceed ready_quantity/i);
assert.equal(number(`select count(*) from public.safisa_order_authorizations where supplier_order_id = '${orderId(9)}'`), 1);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(18)}'`), 3);

// Concurrency 5: pickup first completes as legacy, then publication is safe.
outcomes = await race(
  { userId: ids.internal, sql: `select public.set_supplier_order_item_picked_quantity('${lineId(19)}', 5, null, '${key(30)}'); select pg_sleep(1)` },
  { userId: ids.internal, sql: `select public.publish_supplier_order_to_safisa('${orderId(10)}', '${key(31)}')` },
);
assert.equal(outcomes.every(({ status }) => status === "fulfilled"), true);
assert.equal(psql(`select ready_quantity = 5 and picked_quantity = 5 from public.supplier_order_items where id = '${lineId(19)}'`), "t");
assert.equal(number(`select count(*) from public.safisa_order_authorizations where supplier_order_id = '${orderId(10)}'`), 1);

assert.equal(
  number("select count(*) from public.supplier_order_items where ready_quantity < picked_quantity or ready_quantity + cancelled_quantity > ordered_quantity or stocked_quantity > picked_quantity"),
  0,
);

console.log("LEGACY TRANSITION: PASS");
console.log("CONCURRENCY (5 two-session scenarios): PASS");
