import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const container = process.env.SUPPLIER_ORDER_STALE_TEST_DB_CONTAINER
  ?? "supabase_db_nk_current_state_baseline";
const database = process.env.SUPPLIER_ORDER_STALE_TEST_DB_NAME;
const databaseUser = process.env.SUPPLIER_ORDER_STALE_TEST_DB_USER ?? "postgres";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationSql = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260914003000_protect_supplier_order_mutations_from_stale_views.sql",
  ),
  "utf8",
);
const windowsDocker = join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "DockerDesktop",
  "resources",
  "bin",
  "docker.exe",
);
const docker = existsSync(windowsDocker) ? windowsDocker : "docker";
const firstUser = "57000000-0000-4000-8000-000000000001";
const secondUser = "57000000-0000-4000-8000-000000000002";
const itemId = "d9bfc725-87a3-4194-8f51-bdc49d95bd8c";
const orderId = (value) => `57000000-0000-4000-8001-${String(value).padStart(12, "0")}`;
const lineId = (value) => `57000000-0000-4000-8002-${String(value).padStart(12, "0")}`;
const key = (value) => `57000000-0000-4000-8003-${String(value).padStart(12, "0")}`;

if (!database || database === "postgres" || !database.startsWith("nk57_")) {
  throw new Error(
    "SUPPLIER_ORDER_STALE_TEST_DB_NAME must name an nk57_ disposable database; the baseline database is never mutated.",
  );
}

function psql(sql, { allowFailure = false } = {}) {
  try {
    return execFileSync(
      docker,
      [
        "exec", container, "psql", "-U", databaseUser, "-d", database,
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
    if (allowFailure) return output;
    throw new Error(output, { cause: error });
  }
}

function applyMigration() {
  execFileSync(
    docker,
    [
      "exec", "-i", container, "psql", "-U", databaseUser, "-d", database,
      "-X", "-q", "-v", "ON_ERROR_STOP=1",
    ],
    {
      encoding: "utf8",
      input: migrationSql,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

function scalar(sql) {
  return psql(sql).split(/\r?\n/).at(-1);
}

function jsonFrom(output) {
  const line = output.split(/\r?\n/).findLast((value) => value.startsWith("{"));
  assert.ok(line, `Expected JSON result: ${output}`);
  return JSON.parse(line);
}

function authSql(userId, statement) {
  return `
    begin;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    set local role authenticated;
    ${statement};
    commit;
  `;
}

function asUser(userId, statement, options) {
  return psql(authSql(userId, statement), options);
}

function spawnPsql(args, { interactive = false } = {}) {
  const child = spawn(
    docker,
    [
      "exec", ...(interactive ? ["-i"] : []), container,
      "psql", "-U", databaseUser, "-d", database,
      "-X", "-qAt", "-v", "ON_ERROR_STOP=1", ...args,
    ],
    { windowsHide: true, stdio: [interactive ? "pipe" : "ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  const outputWaiters = new Set();

  function notifyOutputWaiters() {
    for (const waiter of outputWaiters) waiter();
  }

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    notifyOutputWaiters();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    notifyOutputWaiters();
  });

  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      notifyOutputWaiters();
      if (exitCode === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(`${stdout}\n${stderr}`.trim()));
    });
  });

  async function waitForOutput(pattern, label) {
    const deadline = Date.now() + 15_000;
    while (!pattern.test(`${stdout}\n${stderr}`)) {
      const remaining = deadline - Date.now();
      assert.ok(remaining > 0, `Timed out waiting for ${label}: ${stdout}\n${stderr}`);
      await new Promise((resolvePromise) => {
        let timeoutId;
        const onOutput = () => {
          clearTimeout(timeoutId);
          outputWaiters.delete(onOutput);
          resolvePromise();
        };
        outputWaiters.add(onOutput);
        timeoutId = setTimeout(() => {
          outputWaiters.delete(onOutput);
          resolvePromise();
        }, Math.min(remaining, 250));
      });
    }
    return `${stdout}\n${stderr}`;
  }

  return { child, completion, waitForOutput };
}

function startHoldingTransaction(userId, statement) {
  const session = spawnPsql([], { interactive: true });
  session.child.stdin.write(`
    begin;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    set local role authenticated;
    select 'NK57_BACKEND:' || pg_backend_pid();
    ${statement};
    select 'NK57_LOCK_HELD';
  `);
  return session;
}

function startConcurrentUser(userId, statement, applicationName) {
  return spawnPsql([
    "-c",
    authSql(
      userId,
      `set application_name = '${applicationName}'; ${statement}`,
    ),
  ]);
}

async function waitForBackend(applicationName) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const pid = Number(scalar(`
      select coalesce(max(pid), 0)
      from pg_stat_activity
      where datname = '${database}'
        and application_name = '${applicationName}'
    `));
    if (Number.isInteger(pid) && pid > 0) return pid;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  assert.fail(`PostgreSQL never exposed application_name ${applicationName}`);
}

async function waitUntilBlocked(waitingPid, blockingPid) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const blockers = scalar(
      `select pg_blocking_pids(${waitingPid})::text`,
    );
    if (blockers
      .slice(1, -1)
      .split(",")
      .filter(Boolean)
      .map(Number)
      .includes(blockingPid)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  assert.fail(
    `PostgreSQL never reported backend ${waitingPid} blocked by ${blockingPid}`,
  );
}

function version(orderNumber) {
  return scalar(
    `select updated_at from public.supplier_orders where id = '${orderId(orderNumber)}'`,
  );
}

function snapshot(orderNumber) {
  return jsonFrom(
    scalar(`
      with target_items as materialized (
        select *
        from public.supplier_order_items
        where supplier_order_id = '${orderId(orderNumber)}'
      ),
      target_entries as materialized (
        select *
        from public.supplier_order_stock_entries
        where supplier_order_id = '${orderId(orderNumber)}'
      ),
      target_entry_lines as materialized (
        select entry_line.*
        from public.supplier_order_stock_entry_lines as entry_line
        where entry_line.supplier_order_stock_entry_id in (
          select id from target_entries
        )
      ),
      target_batches as materialized (
        select batch.*
        from public.movement_batches as batch
        where batch.id in (select movement_batch_id from target_entries)
      )
      select jsonb_build_object(
        'supplier_orders', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from public.supplier_orders as value
          where value.id = '${orderId(orderNumber)}'
        ),
        'supplier_order_items', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from target_items as value
        ),
        'supplier_order_events', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from public.supplier_order_events as value
          where value.supplier_order_id = '${orderId(orderNumber)}'
        ),
        'stock_balances', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.item_id), '[]'::jsonb)
          from public.stock_balances as value
          where value.item_id in (
            select item_id from target_items where item_id is not null
          )
        ),
        'configuration_stock_balances', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.configuration_id), '[]'::jsonb)
          from public.configuration_stock_balances as value
          where value.configuration_id in (
            select commercial_configuration_id
            from target_items
            where commercial_configuration_id is not null
          )
        ),
        'movement_batches', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from target_batches as value
        ),
        'stock_movements', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from public.stock_movements as value
          where value.batch_id in (select id from target_batches)
        ),
        'configuration_stock_movements', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from public.configuration_stock_movements as value
          where value.batch_id in (select id from target_batches)
        ),
        'inbound_batch_lines', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from public.inbound_batch_lines as value
          where value.id in (select inbound_batch_line_id from target_entry_lines)
        ),
        'supplier_order_stock_entries', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from target_entries as value
        ),
        'supplier_order_stock_entry_lines', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from target_entry_lines as value
        ),
        'all_effects', jsonb_build_object(
          'supplier_order_events', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
            from public.supplier_order_events as value
          ),
          'stock_balances', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.item_id), '[]'::jsonb)
            from public.stock_balances as value
          ),
          'configuration_stock_balances', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.configuration_id), '[]'::jsonb)
            from public.configuration_stock_balances as value
          ),
          'movement_batches', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
            from public.movement_batches as value
          ),
          'stock_movements', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
            from public.stock_movements as value
          ),
          'configuration_stock_movements', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
            from public.configuration_stock_movements as value
          ),
          'inbound_batch_lines', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
            from public.inbound_batch_lines as value
          ),
          'supplier_order_stock_entries', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
            from public.supplier_order_stock_entries as value
          ),
          'supplier_order_stock_entry_lines', (
            select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
            from public.supplier_order_stock_entry_lines as value
          )
        )
      )::text
    `),
  );
}

function linePickup(orderNumber, expectedVersion, idempotencyKey, target = 1) {
  return `select public.set_supplier_order_item_picked_quantity_checked(
    '${lineId(orderNumber)}', ${target}, null,
    '${expectedVersion}'::timestamptz, '${idempotencyKey}'
  )`;
}

function markAll(orderNumber, expectedVersion, idempotencyKey, description = null) {
  return `select public.mark_supplier_order_all_picked_checked(
    '${orderId(orderNumber)}', ${description === null ? "null" : `'${description}'`},
    '${expectedVersion}'::timestamptz, '${idempotencyKey}'
  )`;
}

function cancelAll(orderNumber, expectedVersion, idempotencyKey, note = "Cancelamento total NK57") {
  return `select public.cancel_supplier_order_checked(
    '${orderId(orderNumber)}', '${note}',
    '${expectedVersion}'::timestamptz, '${idempotencyKey}'
  )`;
}

function cancelRemaining(orderNumber, expectedVersion, idempotencyKey, note = "Cancelamento restante NK57") {
  return `select public.cancel_supplier_order_remaining_checked(
    '${orderId(orderNumber)}', '${note}',
    '${expectedVersion}'::timestamptz, '${idempotencyKey}'
  )`;
}

function seedOrder(orderNumber, { ready = 0, picked = 0, stocked = 0 } = {}) {
  psql(`
    insert into public.supplier_orders (
      id, negotiation_number, order_date, created_by, created_by_name_snapshot
    ) values (
      '${orderId(orderNumber)}', '957${String(orderNumber).padStart(3, "0")}',
      current_date, '${firstUser}', 'NK57 First User'
    );
    insert into public.supplier_order_items (
      id, supplier_order_id, item_id, code_snapshot, description_snapshot,
      item_type_snapshot, ordered_quantity, ready_quantity, picked_quantity,
      stocked_quantity, cancelled_quantity, position
    ) values (
      '${lineId(orderNumber)}', '${orderId(orderNumber)}', '${itemId}', '1',
      'SERVO MBF-015', 'SERVO', 10, ${ready}, ${picked}, ${stocked}, 0, 0
    );
  `);
}

function advanceVersion(orderNumber) {
  psql(`
    update public.supplier_orders
    set updated_at = updated_at + interval '1 second'
    where id = '${orderId(orderNumber)}'
  `);
}

console.log("ALVO CONFIRMADO: POSTGRESQL LOCAL/DESCARTAVEL NK57");
assert.equal(scalar("select current_database()"), database);
assert.equal(
  scalar("select to_regprocedure('public.cancel_supplier_order_checked(uuid,text,timestamptz,uuid)') is null"),
  "t",
);

applyMigration();

const legacySignatures = [
  "public.set_supplier_order_item_picked_quantity(uuid,integer,text,uuid)",
  "public.mark_supplier_order_all_picked(uuid,text,uuid)",
  "public.cancel_supplier_order(uuid,text,uuid)",
  "public.cancel_supplier_order_remaining(uuid,text,uuid)",
];
const checkedSignatures = [
  "public.set_supplier_order_item_picked_quantity_checked(uuid,integer,text,timestamptz,uuid)",
  "public.mark_supplier_order_all_picked_checked(uuid,text,timestamptz,uuid)",
  "public.cancel_supplier_order_checked(uuid,text,timestamptz,uuid)",
  "public.cancel_supplier_order_remaining_checked(uuid,text,timestamptz,uuid)",
];
const privateCheckedSignatures = [
  "private.set_supplier_order_item_picked_quantity_checked(uuid,integer,text,timestamptz,uuid,uuid,text)",
  "private.mark_supplier_order_all_picked_checked(uuid,text,timestamptz,uuid,uuid,text)",
  "private.cancel_supplier_order_checked(uuid,text,timestamptz,uuid,uuid,text)",
  "private.cancel_supplier_order_remaining_checked(uuid,text,timestamptz,uuid,uuid,text)",
];

for (const signature of legacySignatures) {
  assert.equal(
    scalar(`select has_function_privilege('authenticated', '${signature}', 'execute')`),
    "f",
    signature,
  );
  assert.equal(
    scalar(`select has_function_privilege('anon', '${signature}', 'execute')`),
    "f",
    signature,
  );
  assert.equal(
    scalar(`select has_function_privilege('service_role', '${signature}', 'execute')`),
    "t",
    signature,
  );
}

for (const signature of checkedSignatures) {
  assert.equal(
    scalar(`select has_function_privilege('authenticated', '${signature}', 'execute')`),
    "t",
    signature,
  );
}

// Preserve server integrations on both the legacy and checked public APIs.
for (const signature of checkedSignatures) {
  assert.equal(
    scalar(`select has_function_privilege('service_role', '${signature}', 'execute')`),
    "t",
    signature,
  );
}

for (const signature of privateCheckedSignatures) {
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(
      scalar(`select has_function_privilege('${role}', '${signature}', 'execute')`),
      "f",
      `${role}: ${signature}`,
    );
  }
}

psql(`
  insert into auth.users (id, aud, role, created_at, updated_at) values
    ('${firstUser}', 'authenticated', 'authenticated', now(), now()),
    ('${secondUser}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active) values
    ('${firstUser}', 'NK57 First User', true),
    ('${secondUser}', 'NK57 Second User', true);
`);

for (const statement of [
  `select public.set_supplier_order_item_picked_quantity('${lineId(99)}', 1, null, '${key(99)}')`,
  `select public.mark_supplier_order_all_picked('${orderId(99)}', null, '${key(100)}')`,
  `select public.cancel_supplier_order('${orderId(99)}', 'Legacy blocked', '${key(101)}')`,
  `select public.cancel_supplier_order_remaining('${orderId(99)}', 'Legacy blocked', '${key(102)}')`,
]) {
  assert.match(asUser(firstUser, statement, { allowFailure: true }), /permission denied/i);
}

// Four stale attempts: B advances the version, then A's V1 attempt has no effect.
seedOrder(1, { ready: 2 });
seedOrder(2, { ready: 2 });
seedOrder(3);
seedOrder(4, { ready: 2, picked: 2 });
const staleCalls = [linePickup, markAll, cancelAll, cancelRemaining];

for (const [index, call] of staleCalls.entries()) {
  const orderNumber = index + 1;
  const v1 = version(orderNumber);
  advanceVersion(orderNumber);
  const before = snapshot(orderNumber);
  const failure = asUser(
    firstUser,
    call(orderNumber, v1, key(110 + index)),
    { allowFailure: true },
  );
  assert.match(failure, /supplier_order_version_conflict/i);
  assert.deepEqual(snapshot(orderNumber), before);
}

console.log("4 OPERACOES STALE SEM EFEITO: PASS");

// Correct V1 succeeds; replay with the now-old V1 returns the committed result.
seedOrder(5, { ready: 2 });
seedOrder(6, { ready: 2 });
seedOrder(7);
seedOrder(8, { ready: 2, picked: 2 });
const successCalls = [linePickup, markAll, cancelAll, cancelRemaining];
const expectedSuccessState = [
  { pickedQuantity: 1, cancelledQuantity: 0, movementCount: 1 },
  { pickedQuantity: 2, cancelledQuantity: 0, movementCount: 1 },
  { pickedQuantity: 0, cancelledQuantity: 10, movementCount: 0 },
  { pickedQuantity: 2, cancelledQuantity: 8, movementCount: 0 },
];

for (const [index, call] of successCalls.entries()) {
  const orderNumber = index + 5;
  const v1 = version(orderNumber);
  const idempotencyKey = key(120 + index);
  const first = jsonFrom(asUser(firstUser, call(orderNumber, v1, idempotencyKey)));
  assert.equal(first.idempotent_replay, false);
  const afterSuccess = snapshot(orderNumber);
  const replay = jsonFrom(asUser(firstUser, call(orderNumber, v1, idempotencyKey)));
  assert.equal(replay.idempotent_replay, true);
  assert.deepEqual(snapshot(orderNumber), afterSuccess);
  const orderItem = afterSuccess.supplier_order_items[0];
  assert.equal(afterSuccess.supplier_order_events.length, 1);
  assert.equal(
    orderItem.picked_quantity,
    expectedSuccessState[index].pickedQuantity,
  );
  assert.equal(
    orderItem.cancelled_quantity,
    expectedSuccessState[index].cancelledQuantity,
  );
  assert.equal(
    afterSuccess.stock_movements.length,
    expectedSuccessState[index].movementCount,
  );

  const differentPayload =
    index === 0
      ? linePickup(orderNumber, v1, idempotencyKey, 2)
      : index === 1
        ? markAll(orderNumber, v1, idempotencyKey, "Payload diferente")
        : index === 2
          ? cancelAll(orderNumber, v1, idempotencyKey, "Outro cancelamento total")
          : cancelRemaining(orderNumber, v1, idempotencyKey, "Outro cancelamento restante");
  const mismatch = asUser(firstUser, differentPayload, { allowFailure: true });
  assert.match(mismatch, /different supplier-order request/i);
  assert.deepEqual(snapshot(orderNumber), afterSuccess);
}

console.log("4 OPERACOES VERSAO CORRETA + REPLAY + PAYLOAD DIVERGENTE: PASS");

// Two authenticated PostgreSQL sessions race from the same version. Exactly
// one commits, while the waiter observes the new version and fails stale.
seedOrder(9, { ready: 2 });
seedOrder(10, { ready: 2 });
seedOrder(11);
seedOrder(12, { ready: 2, picked: 2 });
const raceCalls = [linePickup, markAll, cancelAll, cancelRemaining];

for (const [index, call] of raceCalls.entries()) {
  const orderNumber = index + 9;
  const v1 = version(orderNumber);
  const first = startHoldingTransaction(
    firstUser,
    call(orderNumber, v1, key(130 + index * 2)),
  );
  const firstOutput = await first.waitForOutput(/NK57_LOCK_HELD/, "first lock marker");
  const firstPid = Number(firstOutput.match(/NK57_BACKEND:(\d+)/)?.[1]);
  assert.ok(Number.isInteger(firstPid), firstOutput);

  const second = startConcurrentUser(
    secondUser,
    call(orderNumber, v1, key(131 + index * 2)),
    `nk57_waiter_${index}`,
  );
  const secondPid = await waitForBackend(`nk57_waiter_${index}`);

  // This observed database handshake is the proof of overlap: session two is
  // waiting on the row/advisory locks retained by session one's open tx.
  await waitUntilBlocked(secondPid, firstPid);
  assert.equal(
    scalar(`select ${firstPid} = any(pg_blocking_pids(${secondPid}))`),
    "t",
  );

  first.child.stdin.write("commit;\n\\q\n");
  const outcomes = await Promise.allSettled([first.completion, second.completion]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.match(
    outcomes.find((outcome) => outcome.status === "rejected").reason.message,
    /supplier_order_version_conflict/i,
  );
  const afterRace = snapshot(orderNumber);
  assert.equal(afterRace.supplier_order_events.length, 1);
  assert.equal(
    afterRace.stock_movements.length,
    expectedSuccessState[index].movementCount,
  );
}

console.log("4 CORRIDAS COM BLOQUEIO POSTGRESQL OBSERVADO: PASS");
console.log("SUPPLIER_ORDER_STALE_CONFLICT_LOCAL_TESTS_PASSED");
