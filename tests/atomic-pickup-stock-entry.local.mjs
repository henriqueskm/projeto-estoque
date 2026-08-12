import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const container = process.env.ATOMIC_PICKUP_TEST_DB_CONTAINER
  ?? "supabase_db_nk_current_state_baseline";
const windowsDocker = join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "DockerDesktop",
  "resources",
  "bin",
  "docker.exe",
);
const docker = existsSync(windowsDocker) ? windowsDocker : "docker";
const internal = "10000000-0000-4000-8000-000000000001";
const safisa = "10000000-0000-4000-8000-000000000002";
const item = "d9bfc725-87a3-4194-8f51-bdc49d95bd8c";
const configuration = "ffdbc822-37ab-4018-a476-b7e6e1f0e596";
const alias1 = "9ec6cc33-6b9e-4143-831a-31cb1c0571c0";
const alias2 = "781e9bec-c1d7-46a3-a4f6-0a9b7c303771";
const orderId = (n) => `10000000-0000-4000-8001-${String(n).padStart(12, "0")}`;
const lineId = (n) => `10000000-0000-4000-8002-${String(n).padStart(12, "0")}`;
const key = (n) => `10000000-0000-4000-8003-${String(n).padStart(12, "0")}`;

function psql(sql, { allowFailure = false } = {}) {
  try {
    return execFileSync(
      docker,
      ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
    throw error;
  }
}

function number(sql) {
  return Number(psql(sql).split(/\r?\n/).at(-1));
}

function jsonFrom(output) {
  const line = output.split(/\r?\n/).findLast((value) => value.startsWith("{"));
  assert.ok(line, `Expected JSON result: ${output}`);
  return JSON.parse(line);
}

function asUser(userId, statement) {
  return psql(`begin; select set_config('request.jwt.claim.sub', '${userId}', true); set local role authenticated; ${statement}; commit;`);
}

function asUserFailure(userId, statement, expected) {
  const output = psql(
    `begin; select set_config('request.jwt.claim.sub', '${userId}', true); set local role authenticated; ${statement}; commit;`,
    { allowFailure: true },
  );
  assert.match(output, expected);
  return output;
}

function concurrentUser(userId, statement) {
  const sql = `begin; select set_config('request.jwt.claim.sub', '${userId}', true); set local role authenticated; ${statement}; commit;`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      docker,
      ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
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
  const a = concurrentUser(first.userId, first.sql);
  const b = concurrentUser(second.userId, second.sql);
  return Promise.allSettled([a, b]);
}

function itemLine(n, { ordered = 10, ready, picked, position = 0 } = {}) {
  return `insert into public.supplier_order_items (
    id, supplier_order_id, item_id, code_snapshot, description_snapshot,
    item_type_snapshot, ordered_quantity, ready_quantity, picked_quantity,
    stocked_quantity, cancelled_quantity, position
  ) values (
    '${lineId(n)}', '${orderId(Math.floor(n / 10))}', '${item}', '1',
    'SERVO MBF-015', 'SERVO', ${ordered}, ${ready}, ${picked}, 0, 0, ${position}
  );`;
}

function configurationLine(n, aliasId, code, { ready, picked, position = 0 } = {}) {
  return `insert into public.supplier_order_items (
    id, supplier_order_id, commercial_configuration_id,
    commercial_configuration_code_id, code_snapshot, description_snapshot,
    item_type_snapshot, commercial_code_snapshot, ordered_quantity,
    ready_quantity, picked_quantity, stocked_quantity, cancelled_quantity,
    position
  ) values (
    '${lineId(n)}', '${orderId(Math.floor(n / 10))}', '${configuration}',
    '${aliasId}', '${code}', 'SERVO MBF-015 + KIT',
    'COMMERCIAL_CONFIGURATION', '${code}', 10, ${ready}, ${picked},
    0, 0, ${position}
  );`;
}

function order(n, lines) {
  return `insert into public.supplier_orders (
    id, negotiation_number, order_date, created_by, created_by_name_snapshot
  ) values (
    '${orderId(n)}', 'ATOMIC-${n}', current_date, '${internal}', 'Internal Local'
  ); ${lines.join("\n")}`;
}

console.log("ALVO CONFIRMADO: SUPABASE LOCAL");
assert.equal(psql("select current_database() = 'postgres'"), "t");
assert.equal(number("select count(*) from supabase_migrations.schema_migrations where version = '20260812023500'"), 1);

psql(`
  truncate table public.safisa_portal_events, public.safisa_order_authorizations,
    public.safisa_portal_members, public.supplier_order_events,
    public.supplier_order_stock_entry_lines, public.supplier_order_stock_entries,
    public.supplier_order_items, public.supplier_orders, public.inbound_batch_lines,
    public.configuration_stock_movements, public.stock_movements,
    public.movement_batches cascade;
  delete from public.profiles where id in ('${internal}', '${safisa}');
  delete from auth.users where id in ('${internal}', '${safisa}');
  insert into auth.users (id, aud, role, created_at, updated_at) values
    ('${internal}', 'authenticated', 'authenticated', now(), now()),
    ('${safisa}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active) values
    ('${internal}', 'Internal Local', true),
    ('${safisa}', 'Safisa Local', false);
  insert into public.stock_balances (item_id, quantity) values ('${item}', 10)
    on conflict (item_id) do update set quantity = excluded.quantity;
  insert into public.configuration_stock_balances (configuration_id, quantity)
  values ('${configuration}', 10)
    on conflict (configuration_id) do update set quantity = excluded.quantity;
  ${order(1, [itemLine(10, { ready: 3, picked: 1, stocked: 1 })])}
  ${order(2, [itemLine(20, { ready: 5, picked: 3, stocked: 1 })])}
  ${order(3, [itemLine(30, { ready: 1, picked: 1, stocked: 1 })])}
  ${order(4, [itemLine(40, { ready: 5, picked: 3, stocked: 3 })])}
  ${order(5, [
    itemLine(50, { ready: 3, picked: 1, stocked: 1, position: 0 }),
    configurationLine(51, alias1, "1B", { ready: 4, picked: 2, stocked: 2, position: 1 }),
  ])}
  ${order(6, [
    configurationLine(60, alias1, "1B", { ready: 1, picked: 0, stocked: 0, position: 0 }),
    configurationLine(61, alias2, "1D", { ready: 1, picked: 0, stocked: 0, position: 1 }),
  ])}
  ${order(7, [configurationLine(70, alias1, "1B", { ready: 1, picked: 0, stocked: 0 })])}
  ${order(8, [itemLine(80, { ready: 1, picked: 0, stocked: 0 })])}
  ${order(9, [itemLine(90, { ready: 2, picked: 0, stocked: 0 })])}
  ${order(10, [itemLine(100, { ready: 1, picked: 0, stocked: 0 })])}
  ${order(11, [itemLine(110, { ready: 2, picked: 1, stocked: 0 })])}
  ${order(12, [itemLine(120, { ready: 2, picked: 2, stocked: 0 })])}
  ${order(13, [itemLine(130, { ordered: 1, ready: 1, picked: 0, stocked: 0 })])}
  ${order(14, [itemLine(140, { ordered: 1, ready: 1, picked: 1, stocked: 0 })])}
  ${order(15, [itemLine(150, { ready: 2, picked: 0, stocked: 0 })])}
  ${order(16, [
    itemLine(160, { ready: 2, picked: 0, stocked: 0, position: 0 }),
    configurationLine(161, alias1, "1B", { ready: 1, picked: 0, stocked: 0, position: 1 }),
  ])}
`);
asUser(internal, `select public.set_safisa_portal_member_status('${safisa}', true, '${key(90)}')`);

function seedHistoricalStock(orderNumber, lineNumber, quantity, keyNumber) {
  const expected = psql(`select updated_at from public.supplier_orders where id = '${orderId(orderNumber)}'`);
  asUser(internal, `select public.create_supplier_order_stock_entry(
    '${orderId(orderNumber)}',
    '[{"supplier_order_item_id":"${lineId(lineNumber)}","quantity":${quantity}}]'::jsonb,
    'Fixture local de backlog',
    '${expected}'::timestamptz,
    '${key(keyNumber)}'
  )`);
}

seedHistoricalStock(1, 10, 1, 81);
seedHistoricalStock(2, 20, 1, 82);
seedHistoricalStock(3, 30, 1, 83);
seedHistoricalStock(4, 40, 3, 84);
seedHistoricalStock(5, 50, 1, 85);
seedHistoricalStock(5, 51, 2, 86);

// A: direct physical item, one newly picked unit and one stock unit.
let before = number(`select quantity from public.stock_balances where item_id = '${item}'`);
let result = jsonFrom(asUser(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(10)}', 2, null, '${key(1)}')`));
const initialPickupResult = result;
assert.equal(result.picked_quantity_delta, 1);
assert.equal(result.stock_entry_quantity, 1);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(10)}'`), 2);
assert.equal(number(`select stocked_quantity from public.supplier_order_items where id = '${lineId(10)}'`), 2);
assert.equal(number(`select quantity from public.stock_balances where item_id = '${item}'`), before + 1);

// B: historical backlog is unchanged; only the new delta enters stock.
before = number(`select quantity from public.stock_balances where item_id = '${item}'`);
result = jsonFrom(asUser(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(20)}', 4, null, '${key(2)}')`));
assert.equal(result.stock_entry_quantity, 1);
assert.equal(number(`select picked_quantity - stocked_quantity from public.supplier_order_items where id = '${lineId(20)}'`), 2);
assert.equal(number(`select quantity from public.stock_balances where item_id = '${item}'`), before + 1);

// C-D: readiness limit and reduction fail without any partial effect.
let batches = number("select count(*) from public.movement_batches");
asUserFailure(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(30)}', 2, null, '${key(3)}')`, /cannot exceed ready_quantity/i);
asUserFailure(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(40)}', 2, null, '${key(4)}')`, /cannot be reduced/i);
assert.equal(number("select count(*) from public.movement_batches"), batches);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(40)}'`), 3);

// E: mark-all uses one entry/batch for distinct physical targets.
result = jsonFrom(asUser(internal, `select public.mark_supplier_order_all_picked('${orderId(5)}', null, '${key(5)}')`));
assert.equal(result.changed_line_count, 2);
assert.equal(result.added_picked_quantity, 4);
assert.equal(result.stock_entry_line_count, 2);
assert.equal(result.stock_entry_quantity, 4);
assert.equal(number(`select count(*) from public.supplier_order_stock_entries where id = '${result.supplier_order_stock_entry_id}'`), 1);
assert.equal(number(`select count(*) from public.movement_batches where id = '${result.movement_batch_id}'`), 1);

// F: two aliases keep two order allocations but one physical configuration movement.
result = jsonFrom(asUser(internal, `select public.mark_supplier_order_all_picked('${orderId(6)}', null, '${key(6)}')`));
assert.equal(result.stock_entry_line_count, 2);
assert.equal(number(`select count(*) from public.supplier_order_stock_entry_lines where supplier_order_stock_entry_id = '${result.supplier_order_stock_entry_id}'`), 2);
assert.equal(number(`select count(*) from public.configuration_stock_movements where batch_id = '${result.movement_batch_id}'`), 1);
assert.equal(number(`select quantity_change from public.configuration_stock_movements where batch_id = '${result.movement_batch_id}'`), 2);

// G-H: identical replay is stable; key reuse with another payload is rejected.
const replay = jsonFrom(asUser(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(10)}', 2, null, '${key(1)}')`));
assert.equal(replay.idempotent_replay, true);
assert.equal(replay.movement_batch_id, initialPickupResult.movement_batch_id);
assert.equal(number(`select count(*) from public.movement_batches where user_id = '${internal}' and idempotency_key = '${key(1)}'`), 1);
asUserFailure(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(10)}', 3, null, '${key(1)}')`, /different supplier-order request/i);

// I.1: stock-stage failure rolls back the prior picked update.
psql(`update public.commercial_configuration_codes set is_active = false where id = '${alias1}'`);
before = number(`select quantity from public.configuration_stock_balances where configuration_id = '${configuration}'`);
asUserFailure(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(70)}', 1, null, '${key(7)}')`, /inactive/i);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(70)}'`), 0);
assert.equal(number(`select quantity from public.configuration_stock_balances where configuration_id = '${configuration}'`), before);
assert.equal(number(`select count(*) from public.movement_batches where idempotency_key = '${key(7)}'`), 0);
psql(`update public.commercial_configuration_codes set is_active = true where id = '${alias1}'`);

// I.2: audit-stage failure rolls back stock, entry, and pickup together.
psql(`
  create function private.fail_atomic_pickup_event_test() returns trigger
  language plpgsql set search_path = '' as $$ begin
    if new.idempotency_key = '${key(8)}' then raise exception 'forced audit failure'; end if;
    return new;
  end; $$;
  create trigger fail_atomic_pickup_event_test before insert on public.supplier_order_events
  for each row execute function private.fail_atomic_pickup_event_test();
`);
before = number(`select quantity from public.stock_balances where item_id = '${item}'`);
asUserFailure(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(80)}', 1, null, '${key(8)}')`, /forced audit failure/i);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(80)}'`), 0);
assert.equal(number(`select quantity from public.stock_balances where item_id = '${item}'`), before);
assert.equal(number(`select count(*) from public.movement_batches where idempotency_key = '${key(8)}'`), 0);
psql("drop trigger fail_atomic_pickup_event_test on public.supplier_order_events; drop function private.fail_atomic_pickup_event_test();");

// J.1: two concurrent pickup totals serialize without a lost stock delta.
let outcomes = await race(
  { userId: internal, sql: `select public.set_supplier_order_item_picked_quantity('${lineId(90)}', 1, null, '${key(9)}')` },
  { userId: internal, sql: `select public.set_supplier_order_item_picked_quantity('${lineId(90)}', 2, null, '${key(10)}')` },
);
assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(90)}'`), 2);
assert.equal(number(`select stocked_quantity from public.supplier_order_items where id = '${lineId(90)}'`), 2);

// J.2: concurrent Safisa readiness and pickup preserve every invariant.
outcomes = await race(
  { userId: safisa, sql: `select public.increment_safisa_ready_quantity('${lineId(100)}', 1, '${key(11)}')` },
  { userId: internal, sql: `select public.set_supplier_order_item_picked_quantity('${lineId(100)}', 2, null, '${key(12)}')` },
);
assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
assert.equal(number(`select count(*) from public.supplier_order_items where id = '${lineId(100)}' and (picked_quantity > ready_quantity or stocked_quantity > picked_quantity)`), 0);

// J.3: atomic pickup and standalone backlog entry serialize on the order/version.
const expectedVersion = psql(`select updated_at from public.supplier_orders where id = '${orderId(11)}'`);
outcomes = await race(
  { userId: internal, sql: `select public.set_supplier_order_item_picked_quantity('${lineId(110)}', 2, null, '${key(13)}')` },
  { userId: internal, sql: `select public.create_supplier_order_stock_entry('${orderId(11)}', '[{"supplier_order_item_id":"${lineId(110)}","quantity":1}]'::jsonb, null, '${expectedVersion}'::timestamptz, '${key(14)}')` },
);
assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(110)}'`), 2);
assert.equal(number(`select count(*) from public.supplier_order_items where id = '${lineId(110)}' and stocked_quantity > picked_quantity`), 0);

// K: NK-ORD-006 standalone backlog entry still works through the shared core.
const order12Version = psql(`select updated_at from public.supplier_orders where id = '${orderId(12)}'`);
result = jsonFrom(asUser(internal, `select public.create_supplier_order_stock_entry('${orderId(12)}', '[{"supplier_order_item_id":"${lineId(120)}","quantity":1}]'::jsonb, null, '${order12Version}'::timestamptz, '${key(15)}')`));
assert.equal(result.stock_entry_quantity, 1);
assert.equal(number(`select picked_quantity from public.supplier_order_items where id = '${lineId(120)}'`), 2);
assert.equal(number(`select stocked_quantity from public.supplier_order_items where id = '${lineId(120)}'`), 1);
assert.equal(number(`select count(*) from public.supplier_order_events where supplier_order_id = '${orderId(12)}' and event_type = 'STOCK_ENTRY_CREATED'`), 1);

// L: finalization rules are unchanged and finalized backlog remains enterable.
const order13Before = psql(`select updated_at from public.supplier_orders where id = '${orderId(13)}'`);
asUserFailure(internal, `select public.finalize_supplier_order('${orderId(13)}', '${order13Before}'::timestamptz, null, '${key(16)}')`, /pickup|completed|retirada/i);
asUser(internal, `select public.set_supplier_order_item_picked_quantity('${lineId(130)}', 1, null, '${key(17)}')`);
const order13After = psql(`select updated_at from public.supplier_orders where id = '${orderId(13)}'`);
asUser(internal, `select public.finalize_supplier_order('${orderId(13)}', '${order13After}'::timestamptz, null, '${key(18)}')`);
const order14Version = psql(`select updated_at from public.supplier_orders where id = '${orderId(14)}'`);
asUser(internal, `select public.finalize_supplier_order('${orderId(14)}', '${order14Version}'::timestamptz, null, '${key(19)}')`);
const finalizedBacklogVersion = psql(`select updated_at from public.supplier_orders where id = '${orderId(14)}'`);
asUser(internal, `select public.create_supplier_order_stock_entry('${orderId(14)}', '[{"supplier_order_item_id":"${lineId(140)}","quantity":1}]'::jsonb, null, '${finalizedBacklogVersion}'::timestamptz, '${key(20)}')`);
assert.equal(number(`select stocked_quantity from public.supplier_order_items where id = '${lineId(140)}'`), 1);

// M: checked wrappers preserve optimistic concurrency, receipts, and replay.
const order15Version = psql(`select updated_at from public.supplier_orders where id = '${orderId(15)}'`);
result = jsonFrom(asUser(internal, `select public.set_supplier_order_item_picked_quantity_checked('${lineId(150)}', 1, null, '${order15Version}'::timestamptz, '${key(21)}')`));
assert.equal(result.picked_quantity_delta, 1);
assert.equal(result.stock_entry_quantity, 1);
assert.equal(result.idempotent_replay, false);
const checkedReplay = jsonFrom(asUser(internal, `select public.set_supplier_order_item_picked_quantity_checked('${lineId(150)}', 1, null, '${order15Version}'::timestamptz, '${key(21)}')`));
assert.equal(checkedReplay.idempotent_replay, true);
assert.equal(checkedReplay.movement_batch_id, result.movement_batch_id);
const order16Version = psql(`select updated_at from public.supplier_orders where id = '${orderId(16)}'`);
result = jsonFrom(asUser(internal, `select public.mark_supplier_order_all_picked_checked('${orderId(16)}', null, '${order16Version}'::timestamptz, '${key(22)}')`));
assert.equal(result.added_picked_quantity, 3);
assert.equal(result.stock_entry_quantity, 3);
assert.equal(result.stock_entry_line_count, 2);
assert.equal(result.idempotent_replay, false);

assert.equal(number("select count(*) from public.supplier_order_items where stocked_quantity > picked_quantity or picked_quantity > ready_quantity or ready_quantity + cancelled_quantity > ordered_quantity"), 0);
console.log("A-M: PASS");
console.log("CONCURRENCY (3 two-session scenarios): PASS");
console.log("ROLLBACK (stock and audit failure): PASS");
