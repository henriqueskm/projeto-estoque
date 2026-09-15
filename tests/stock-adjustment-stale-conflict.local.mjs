import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const container = process.env.STOCK_ADJUSTMENT_STALE_TEST_DB_CONTAINER
  ?? "supabase_db_nk_current_state_baseline";
const database = process.env.STOCK_ADJUSTMENT_STALE_TEST_DB_NAME;
const databaseUser = process.env.STOCK_ADJUSTMENT_STALE_TEST_DB_USER ?? "postgres";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationSql = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260915003000_protect_absolute_stock_adjustments_from_stale_views.sql",
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
const firstUser = "58000000-0000-4000-8000-000000000001";
const secondUser = "58000000-0000-4000-8000-000000000002";
const initialBalanceItem = "58000000-0000-4000-8000-000000000003";
const key = (value) =>
  `58000000-0000-4000-8001-${String(value).padStart(12, "0")}`;

if (!database || database === "postgres" || !database.startsWith("nk58_")) {
  throw new Error(
    "STOCK_ADJUSTMENT_STALE_TEST_DB_NAME must name an nk58_ disposable database; the baseline database is never mutated.",
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
    {
      windowsHide: true,
      stdio: [interactive ? "pipe" : "ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  const waiters = new Set();

  function notify() {
    for (const waiter of waiters) waiter();
  }

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    notify();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    notify();
  });

  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      notify();
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
          waiters.delete(onOutput);
          resolvePromise();
        };
        waiters.add(onOutput);
        timeoutId = setTimeout(() => {
          waiters.delete(onOutput);
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
    select 'NK58_BACKEND:' || pg_backend_pid();
    ${statement};
    select 'NK58_LOCK_HELD';
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
    const blockers = scalar(`select pg_blocking_pids(${waitingPid})::text`);
    if (
      blockers
        .slice(1, -1)
        .split(",")
        .filter(Boolean)
        .map(Number)
        .includes(blockingPid)
    ) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  assert.fail(
    `PostgreSQL never reported backend ${waitingPid} blocked by ${blockingPid}`,
  );
}

function itemCall(itemId, counted, expected, idempotencyKey, reason = "Contagem NK58") {
  return `select public.adjust_item_stock_checked(
    '${itemId}', ${counted}, ${expected}, '${reason}', '${idempotencyKey}'
  )`;
}

function configurationCall(
  configurationId,
  counted,
  expected,
  idempotencyKey,
  reason = "Contagem NK58",
) {
  return `select public.adjust_configuration_stock_checked(
    '${configurationId}', ${counted}, ${expected}, '${reason}', '${idempotencyKey}'
  )`;
}

function setBalance(target, quantity) {
  if (target.kind === "ITEM") {
    psql(`
      insert into public.stock_balances (item_id, quantity)
      values ('${target.id}', ${quantity})
      on conflict (item_id) do update
      set quantity = excluded.quantity,
          updated_at = clock_timestamp()
    `);
    return;
  }

  psql(`
    insert into public.configuration_stock_balances (configuration_id, quantity)
    values ('${target.id}', ${quantity})
    on conflict (configuration_id) do update
    set quantity = excluded.quantity,
        updated_at = clock_timestamp()
  `);
}

function currentQuantity(target) {
  return Number(
    scalar(
      target.kind === "ITEM"
        ? `select quantity from public.stock_balances where item_id = '${target.id}'`
        : `select quantity from public.configuration_stock_balances where configuration_id = '${target.id}'`,
    ),
  );
}

function callFor(target, counted, expected, idempotencyKey, reason) {
  return target.kind === "ITEM"
    ? itemCall(target.id, counted, expected, idempotencyKey, reason)
    : configurationCall(target.id, counted, expected, idempotencyKey, reason);
}

function snapshot() {
  return jsonFrom(
    scalar(`
      select jsonb_build_object(
        'stock_adjustment_requests', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.id), '[]'::jsonb)
          from private.stock_adjustment_requests as value
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
        'stock_balances', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.item_id), '[]'::jsonb)
          from public.stock_balances as value
        ),
        'configuration_stock_balances', (
          select coalesce(jsonb_agg(to_jsonb(value) order by value.configuration_id), '[]'::jsonb)
          from public.configuration_stock_balances as value
        )
      )::text
    `),
  );
}

function effectCounts(state) {
  return {
    requests: state.stock_adjustment_requests.length,
    batches: state.movement_batches.length,
    itemMovements: state.stock_movements.length,
    configurationMovements: state.configuration_stock_movements.length,
  };
}

console.log("ALVO CONFIRMADO: POSTGRESQL LOCAL/DESCARTAVEL NK58");
assert.equal(scalar("select current_database()"), database);
assert.equal(
  scalar("select to_regprocedure('public.adjust_item_stock_checked(uuid,integer,integer,text,uuid)') is null"),
  "t",
);

applyMigration();

const legacySignatures = [
  "public.adjust_item_stock(uuid,integer,text,uuid)",
  "public.adjust_configuration_stock(uuid,integer,text,uuid)",
];
const checkedSignatures = [
  "public.adjust_item_stock_checked(uuid,integer,integer,text,uuid)",
  "public.adjust_configuration_stock_checked(uuid,integer,integer,text,uuid)",
];
const privateSignatures = [
  "private.adjust_inventory_stock(text,uuid,integer,text,uuid,uuid,text)",
  "private.adjust_inventory_stock_checked(text,uuid,integer,integer,text,uuid,uuid,text)",
  "private.stock_adjustment_checked_existing_result(text,uuid,integer,text,uuid,uuid)",
];

for (const signature of legacySignatures) {
  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      scalar(`select has_function_privilege('${role}', '${signature}', 'execute')`),
      "f",
      `${role}: ${signature}`,
    );
  }
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

for (const signature of privateSignatures) {
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
    ('${firstUser}', 'NK58 First User', true),
    ('${secondUser}', 'NK58 Second User', true);
  insert into public.items (id, code, description, item_type)
  values ('${initialBalanceItem}', 'NK58-ABSENT', 'NK58 absent balance', 'LOOSE_PART');
  insert into public.loose_parts (item_id)
  values ('${initialBalanceItem}');
`);

const itemTypes = ["SERVO", "INSTALLATION_KIT", "REPAIR_KIT", "LOOSE_PART"];
const targets = itemTypes.map((itemType) => ({
  kind: "ITEM",
  itemType,
  id: scalar(`
    select id
    from public.items
    where item_type = '${itemType}'
      and id <> '${initialBalanceItem}'
    order by id
    limit 1
  `),
}));
targets.push({
  kind: "CONFIGURATION",
  itemType: "CONFIGURATION",
  id: scalar("select id from public.commercial_configurations order by id limit 1"),
});
for (const target of targets) assert.match(target.id, /^[0-9a-f-]{36}$/i);

for (const statement of [
  `select public.adjust_item_stock('${targets[0].id}', 1, 'Legacy blocked', '${key(1)}')`,
  `select public.adjust_configuration_stock('${targets.at(-1).id}', 1, 'Legacy blocked', '${key(2)}')`,
]) {
  assert.match(asUser(firstUser, statement, { allowFailure: true }), /permission denied/i);
}

// Every physical item type and an assembled configuration reject a stale
// absolute count without changing any balance, request, audit, or timestamp.
for (const [index, target] of targets.entries()) {
  setBalance(target, 10);
  const bKey = key(10 + index * 3);
  const staleKey = key(11 + index * 3);
  const successKey = key(12 + index * 3);
  const bResult = jsonFrom(
    asUser(secondUser, callFor(target, 15, 10, bKey, "Contagem B NK58")),
  );
  assert.equal(bResult.quantity_before, 10);
  assert.equal(bResult.quantity_change, 5);
  assert.equal(bResult.quantity_after, 15);

  const beforeStale = snapshot();
  const staleFailure = asUser(
    firstUser,
    callFor(target, 12, 10, staleKey, "Contagem A stale NK58"),
    { allowFailure: true },
  );
  assert.match(staleFailure, /stock_adjustment_quantity_conflict/i);
  assert.equal(currentQuantity(target), 15);
  assert.deepEqual(snapshot(), beforeStale);

  const success = jsonFrom(
    asUser(firstUser, callFor(target, 12, 15, successKey, "Contagem A NK58")),
  );
  assert.equal(success.quantity_before, 15);
  assert.equal(success.quantity_change, -3);
  assert.equal(success.quantity_after, 12);
  assert.equal(success.adjustment_applied, true);
  assert.equal(currentQuantity(target), 12);

  const afterSuccess = snapshot();
  const replay = jsonFrom(
    asUser(firstUser, callFor(target, 12, 15, successKey, "Contagem A NK58")),
  );
  assert.deepEqual(replay, success);
  assert.deepEqual(snapshot(), afterSuccess);

  const mismatch = asUser(
    firstUser,
    callFor(target, 13, 12, successKey, "Contagem A NK58"),
    { allowFailure: true },
  );
  assert.match(mismatch, /different stock adjustment request/i);
  assert.deepEqual(snapshot(), afterSuccess);
}

console.log("5 ALVOS STALE + RELOAD/SUCCESS + REPLAY/PAYLOAD: PASS");

// A correct no-op completes its request but creates no batch or movement and
// does not touch the already-existing balance timestamp.
const noOpTarget = targets[0];
const noOpBefore = snapshot();
const noOpCountsBefore = effectCounts(noOpBefore);
const noOpBalanceBefore = noOpBefore.stock_balances.find(
  (balance) => balance.item_id === noOpTarget.id,
);
const noOpResult = jsonFrom(
  asUser(firstUser, callFor(noOpTarget, 12, 12, key(90), "Conferência sem ajuste NK58")),
);
const noOpAfter = snapshot();
const noOpCountsAfter = effectCounts(noOpAfter);
const noOpBalanceAfter = noOpAfter.stock_balances.find(
  (balance) => balance.item_id === noOpTarget.id,
);
assert.equal(noOpResult.adjustment_applied, false);
assert.equal(noOpResult.quantity_change, 0);
assert.equal(noOpResult.movement_batch_id, null);
assert.deepEqual(noOpBalanceAfter, noOpBalanceBefore);
assert.equal(noOpCountsAfter.requests, noOpCountsBefore.requests + 1);
assert.equal(noOpCountsAfter.batches, noOpCountsBefore.batches);
assert.equal(noOpCountsAfter.itemMovements, noOpCountsBefore.itemMovements);
assert.equal(
  noOpCountsAfter.configurationMovements,
  noOpCountsBefore.configurationMovements,
);

const invalidBefore = snapshot();
for (const statement of [
  itemCall(noOpTarget.id, -1, 12, key(91), "Negativo NK58"),
  itemCall(noOpTarget.id, 12, -1, key(92), "Negativo NK58"),
]) {
  assert.match(asUser(firstUser, statement, { allowFailure: true }), /non-negative/i);
  assert.deepEqual(snapshot(), invalidBefore);
}

// Missing balance rows behave as locked zero. A stale expected value rolls the
// inserted row back; expected zero can complete a no-op without a movement.
const absentTarget = { kind: "ITEM", itemType: "LOOSE_PART", id: initialBalanceItem };
assert.equal(
  scalar(`select count(*) from public.stock_balances where item_id = '${initialBalanceItem}'`),
  "0",
);
const absentBefore = snapshot();
assert.match(
  asUser(
    firstUser,
    itemCall(initialBalanceItem, 2, 1, key(93), "Saldo ausente stale NK58"),
    { allowFailure: true },
  ),
  /stock_adjustment_quantity_conflict/i,
);
assert.deepEqual(snapshot(), absentBefore);
const absentNoOp = jsonFrom(
  asUser(
    firstUser,
    itemCall(initialBalanceItem, 0, 0, key(94), "Saldo ausente zero NK58"),
  ),
);
assert.equal(absentNoOp.adjustment_applied, false);
assert.equal(absentNoOp.quantity_before, 0);
assert.equal(currentQuantity(absentTarget), 0);

console.log("NO-OP + NONNEGATIVE + SALDO INICIAL AUSENTE: PASS");

async function runBlockedRace({
  target,
  firstStatement,
  secondStatement,
  applicationName,
  secondShouldFail,
  firstUserId = secondUser,
  secondUserId = firstUser,
}) {
  const first = startHoldingTransaction(firstUserId, firstStatement);
  const firstOutput = await first.waitForOutput(/NK58_LOCK_HELD/, "first lock marker");
  const firstPid = Number(firstOutput.match(/NK58_BACKEND:(\d+)/)?.[1]);
  assert.ok(Number.isInteger(firstPid), firstOutput);

  const second = startConcurrentUser(secondUserId, secondStatement, applicationName);
  const secondPid = await waitForBackend(applicationName);
  await waitUntilBlocked(secondPid, firstPid);
  assert.equal(
    scalar(`select ${firstPid} = any(pg_blocking_pids(${secondPid}))`),
    "t",
  );

  first.child.stdin.write("commit;\n\\q\n");
  const outcomes = await Promise.allSettled([first.completion, second.completion]);
  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, secondShouldFail ? "rejected" : "fulfilled");
  if (secondShouldFail) {
    assert.match(outcomes[1].reason.message, /stock_adjustment_quantity_conflict/i);
  } else {
    assert.deepEqual(jsonFrom(outcomes[1].value), jsonFrom(outcomes[0].value));
  }
  return { before: null, after: snapshot(), target };
}

// Different-key races: the waiter is observably blocked, then sees the new
// locked quantity and fails stale. Exactly the first request/effect commits.
for (const [index, target] of [targets[1], targets.at(-1)].entries()) {
  setBalance(target, 10);
  const before = snapshot();
  const beforeCounts = effectCounts(before);
  const firstKey = key(100 + index * 2);
  const secondKey = key(101 + index * 2);
  const race = await runBlockedRace({
    target,
    firstStatement: callFor(target, 15, 10, firstKey, "Race first NK58"),
    secondStatement: callFor(target, 12, 10, secondKey, "Race stale NK58"),
    applicationName: `nk58_stale_waiter_${index}`,
    secondShouldFail: true,
  });
  const afterCounts = effectCounts(race.after);
  assert.equal(currentQuantity(target), 15);
  assert.equal(afterCounts.requests, beforeCounts.requests + 1);
  assert.equal(afterCounts.batches, beforeCounts.batches + 1);
  assert.equal(
    afterCounts.itemMovements + afterCounts.configurationMovements,
    beforeCounts.itemMovements + beforeCounts.configurationMovements + 1,
  );
}

// Same-key concurrent retries block on the same official balance row; after
// the first commit the waiter returns the identical completed receipt.
for (const [index, target] of [targets[2], targets.at(-1)].entries()) {
  setBalance(target, 10);
  const beforeCounts = effectCounts(snapshot());
  const sameKey = key(110 + index);
  const statement = callFor(target, 14, 10, sameKey, "Race replay NK58");
  const race = await runBlockedRace({
    target,
    firstStatement: statement,
    secondStatement: statement,
    applicationName: `nk58_replay_waiter_${index}`,
    secondShouldFail: false,
    firstUserId: firstUser,
    secondUserId: firstUser,
  });
  const afterCounts = effectCounts(race.after);
  assert.equal(currentQuantity(target), 14);
  assert.equal(afterCounts.requests, beforeCounts.requests + 1);
  assert.equal(afterCounts.batches, beforeCounts.batches + 1);
  assert.equal(
    afterCounts.itemMovements + afterCounts.configurationMovements,
    beforeCounts.itemMovements + beforeCounts.configurationMovements + 1,
  );
}

console.log("4 CORRIDAS COM pg_blocking_pids OBSERVADO: PASS");
console.log("STOCK_ADJUSTMENT_STALE_CONFLICT_LOCAL_TESTS_PASSED");
