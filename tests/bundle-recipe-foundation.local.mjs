import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const container = process.env.BUNDLE_RECIPE_TEST_DB_CONTAINER
  ?? "supabase_db_nk_current_state_baseline";
const database = process.env.BUNDLE_RECIPE_TEST_DB_NAME;
const databaseUser = process.env.BUNDLE_RECIPE_TEST_DB_USER ?? "postgres";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260930164109_bundle_recipe_foundation.sql"),
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

const firstUser = "70000000-0000-4000-8000-000000000001";
const inactiveUser = "70000000-0000-4000-8000-000000000002";
const itemId = (value) => `70000000-0000-4000-8001-${String(value).padStart(12, "0")}`;
const key = (value) => `70000000-0000-4000-8002-${String(value).padStart(12, "0")}`;

if (!database || database === "postgres" || !database.startsWith("nk70_")) {
  throw new Error(
    "BUNDLE_RECIPE_TEST_DB_NAME must name an nk70_ disposable database; the baseline database is never mutated.",
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
      input: migration,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

function scalar(sql) {
  return psql(sql).split(/\r?\n/).at(-1);
}

function number(sql) {
  return Number(scalar(sql));
}

function jsonFrom(output) {
  const line = output.split(/\r?\n/).findLast((value) => value.startsWith("{"));
  assert.ok(line, `Expected JSON result: ${output}`);
  return JSON.parse(line);
}

function authSql(userId, statement) {
  return `
    begin;
    set local "request.jwt.claim.sub" = '${userId}';
    set local role authenticated;
    ${statement};
    commit;
  `;
}

function asUser(userId, statement, options) {
  return psql(authSql(userId, statement), options);
}

function concurrent(sql) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      docker,
      [
        "exec", container, "psql", "-U", databaseUser, "-d", database,
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql,
      ],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(`${stdout}\n${stderr}`.trim()));
    });
  });
}

function assemble(quantity, idempotencyKey, description = "Montagem NK70") {
  return `select public.assemble_commercial_bundle(
    '1HC', ${quantity}, '${idempotencyKey}', '${description}'
  )`;
}

function disassemble(quantity, idempotencyKey, description = "Desmontagem NK70") {
  return `select public.disassemble_commercial_bundle(
    '1HC', ${quantity}, '${idempotencyKey}', '${description}'
  )`;
}

function bundleState(bundleId, configurationId, loosePartIds) {
  return {
    bundle: number(`select coalesce((select quantity from public.bundle_stock_balances where bundle_id = '${bundleId}'), 0)`),
    configuration: number(`select coalesce((select quantity from public.configuration_stock_balances where configuration_id = '${configurationId}'), 0)`),
    items: loosePartIds.map((id) => number(`select coalesce((select quantity from public.stock_balances where item_id = '${id}'), 0)`)),
    batches: number("select count(*) from public.movement_batches where idempotency_key::text like '70000000-0000-4000-8002-%'"),
  };
}

console.log("ALVO CONFIRMADO: POSTGRESQL LOCAL/DESCARTAVEL NK70");

const configurationsBefore = number("select count(*) from public.commercial_configurations");
assert.equal(configurationsBefore, 80);
assert.equal(number("select count(*) from public.loose_parts"), 0);
applyMigration();
assert.equal(number("select count(*) from public.commercial_configurations"), 80);
assert.equal(number("select count(*) from public.commercial_bundles"), 0);
assert.equal(
  scalar("select to_regprocedure('private.register_1hc_bundle()') is not null"),
  "t",
);

for (const table of [
  "commercial_bundles",
  "commercial_bundle_codes",
  "commercial_bundle_components",
  "bundle_stock_balances",
  "bundle_stock_movements",
  "bundle_assembly_operations",
]) {
  assert.equal(
    scalar(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`),
    "t",
    table,
  );
  assert.equal(
    scalar(`select has_table_privilege('authenticated', 'public.${table}', 'select')`),
    "t",
  );
  assert.equal(
    scalar(`select has_table_privilege('authenticated', 'public.${table}', 'insert')`),
    "f",
  );
}

for (const signature of [
  "public.assemble_commercial_bundle(text,integer,uuid,text)",
  "public.disassemble_commercial_bundle(text,integer,uuid,text)",
  "public.adjust_commercial_bundle_stock_checked(uuid,integer,integer,text,uuid)",
  "public.get_commercial_bundle_maximum_assemblable(uuid)",
]) {
  assert.equal(scalar(`select has_function_privilege('authenticated', '${signature}', 'execute')`), "t");
  assert.equal(scalar(`select has_function_privilege('anon', '${signature}', 'execute')`), "f");
}

assert.match(
  psql("select private.register_1hc_bundle()", { allowFailure: true }),
  /requires active LOOSE_PART items CIL, EMP, RES, and COT/i,
);

psql(`
  insert into auth.users (id, aud, role, created_at, updated_at) values
    ('${firstUser}', 'authenticated', 'authenticated', now(), now()),
    ('${inactiveUser}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active) values
    ('${firstUser}', 'NK70 Active', true),
    ('${inactiveUser}', 'NK70 Inactive', false);
  insert into public.items (id, code, description, item_type, is_active) values
    ('${itemId(1)}', 'CIL', 'CIL NK70', 'LOOSE_PART', true),
    ('${itemId(2)}', 'EMP', 'EMP NK70', 'LOOSE_PART', true),
    ('${itemId(3)}', 'RES', 'RES NK70', 'LOOSE_PART', true),
    ('${itemId(4)}', 'COT', 'COT NK70', 'LOOSE_PART', true);
  insert into public.loose_parts (item_id) values
    ('${itemId(1)}'), ('${itemId(2)}'), ('${itemId(3)}'), ('${itemId(4)}');
`);

const bundleId = scalar("select private.register_1hc_bundle()");
assert.match(bundleId, /^[0-9a-f-]{36}$/i);
assert.equal(scalar("select private.register_1hc_bundle()"), bundleId);
const configurationId = scalar(`
  select configuration_id
  from public.commercial_configuration_codes
  where code = '1H'
`);
const loosePartIds = [itemId(1), itemId(2), itemId(3), itemId(4)];
assert.equal(number(`select count(*) from public.commercial_bundle_components where bundle_id = '${bundleId}'`), 5);
assert.equal(number("select count(*) from public.commercial_bundle_codes where code = '1HC'"), 1);

assert.equal(
  asUser(inactiveUser, "select count(*) from public.commercial_bundles")
    .split(/\r?\n/).at(-1),
  "0",
);
assert.match(
  asUser(inactiveUser, assemble(1, key(1)), { allowFailure: true }),
  /active profile/i,
);
assert.match(
  psql(assemble(1, key(2)), { allowFailure: true }),
  /authenticated user/i,
);
assert.match(
  asUser(firstUser, `insert into public.bundle_stock_balances (bundle_id, quantity) values ('${bundleId}', 1)`, { allowFailure: true }),
  /permission denied/i,
);

function setFreeBalances(configurationQuantity, itemQuantities, bundleQuantity) {
  psql(`
    insert into public.configuration_stock_balances (configuration_id, quantity)
    values ('${configurationId}', ${configurationQuantity})
    on conflict (configuration_id) do update set quantity = excluded.quantity;
    ${loosePartIds.map((id, index) => `
      insert into public.stock_balances (item_id, quantity)
      values ('${id}', ${itemQuantities[index]})
      on conflict (item_id) do update set quantity = excluded.quantity;
    `).join("\n")}
    insert into public.bundle_stock_balances (bundle_id, quantity)
    values ('${bundleId}', ${bundleQuantity})
    on conflict (bundle_id) do update set quantity = excluded.quantity;
  `);
}

setFreeBalances(10, [10, 10, 10, 10], 0);
assert.equal(asUser(firstUser, `select public.get_commercial_bundle_maximum_assemblable('${bundleId}')`), "10");

const one = jsonFrom(asUser(firstUser, assemble(1, key(10))));
assert.equal(one.bundle_quantity_before, 0);
assert.equal(one.bundle_quantity_after, 1);
assert.equal(one.component_movements.length, 5);
assert.deepEqual(jsonFrom(asUser(firstUser, assemble(1, key(10)))), one);
assert.match(
  asUser(firstUser, assemble(2, key(10)), { allowFailure: true }),
  /different commercial bundle operation/i,
);

jsonFrom(asUser(firstUser, assemble(2, key(11))));
assert.deepEqual(bundleState(bundleId, configurationId, loosePartIds).items, [7, 7, 7, 7]);
jsonFrom(asUser(firstUser, disassemble(1, key(12))));
jsonFrom(asUser(firstUser, disassemble(2, key(13))));
assert.deepEqual(bundleState(bundleId, configurationId, loosePartIds).items, [10, 10, 10, 10]);
assert.equal(bundleState(bundleId, configurationId, loosePartIds).bundle, 0);

for (const [index, target] of [configurationId, ...loosePartIds].entries()) {
  setFreeBalances(5, [5, 5, 5, 5], 0);
  if (index === 0) {
    psql(`update public.configuration_stock_balances set quantity = 0 where configuration_id = '${target}'`);
  } else {
    psql(`update public.stock_balances set quantity = 0 where item_id = '${target}'`);
  }
  const before = bundleState(bundleId, configurationId, loosePartIds);
  assert.match(
    asUser(firstUser, assemble(1, key(20 + index)), { allowFailure: true }),
    /Insufficient free component stock/i,
  );
  assert.deepEqual(bundleState(bundleId, configurationId, loosePartIds), before);
}

setFreeBalances(5, [5, 5, 5, 5], 0);
psql(`delete from public.stock_balances where item_id = '${loosePartIds[0]}'`);
assert.equal(asUser(firstUser, `select public.get_commercial_bundle_maximum_assemblable('${bundleId}')`), "0");
assert.match(asUser(firstUser, assemble(1, key(30)), { allowFailure: true }), /maximum 0/i);
assert.match(asUser(firstUser, disassemble(1, key(31)), { allowFailure: true }), /Insufficient assembled stock/i);

setFreeBalances(1, [1, 1, 1, 1], 0);
const races = await Promise.allSettled([
  concurrent(authSql(firstUser, assemble(1, key(40)))),
  concurrent(authSql(firstUser, assemble(1, key(41)))),
]);
assert.equal(races.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(races.filter((result) => result.status === "rejected").length, 1);
assert.equal(bundleState(bundleId, configurationId, loosePartIds).bundle, 1);
assert.deepEqual(bundleState(bundleId, configurationId, loosePartIds).items, [0, 0, 0, 0]);

setFreeBalances(3, [3, 3, 3, 3], 1);
const deadlockRace = await Promise.all([
  concurrent(authSql(firstUser, `set local statement_timeout = '5s'; ${assemble(1, key(50))}`)),
  concurrent(authSql(firstUser, `set local statement_timeout = '5s'; ${disassemble(1, key(51))}`)),
]);
assert.equal(deadlockRace.length, 2);
assert.equal(bundleState(bundleId, configurationId, loosePartIds).bundle, 1);
assert.deepEqual(bundleState(bundleId, configurationId, loosePartIds).items, [3, 3, 3, 3]);

setFreeBalances(2, [2, 2, 2, 2], 0);
const oneHCodeId = scalar("select id from public.commercial_configuration_codes where code = '1H'");
const outputPayload = JSON.stringify([
  { kind: "COMMERCIAL_CODE", commercial_code_id: oneHCodeId, quantity: 1 },
]);
const outputRace = await Promise.allSettled([
  concurrent(authSql(firstUser, `set local statement_timeout = '5s'; ${assemble(1, key(60))}`)),
  concurrent(authSql(firstUser, `set local statement_timeout = '5s'; select public.stock_outbound_items('${outputPayload}'::jsonb, '${key(61)}', 'Saida concorrente NK70', false)`)),
]);
assert.equal(outputRace.filter((result) => result.status === "fulfilled").length, 2);
assert.equal(number(`select quantity from public.configuration_stock_balances where configuration_id = '${configurationId}'`), 0);
assert.equal(number(`select quantity from public.bundle_stock_balances where bundle_id = '${bundleId}'`), 1);

setFreeBalances(5, [5, 5, 5, 5], 0);
const adjusted = jsonFrom(asUser(firstUser, `select public.adjust_commercial_bundle_stock_checked('${bundleId}', 1, 0, 'Contagem NK70', '${key(70)}')`));
assert.equal(adjusted.quantity_after, 1);
assert.deepEqual(jsonFrom(asUser(firstUser, `select public.adjust_commercial_bundle_stock_checked('${bundleId}', 1, 0, 'Contagem NK70', '${key(70)}')`)), adjusted);
assert.match(
  asUser(firstUser, `select public.adjust_commercial_bundle_stock_checked('${bundleId}', 2, 1, 'Outra contagem NK70', '${key(70)}')`, { allowFailure: true }),
  /different commercial bundle adjustment/i,
);
assert.match(
  asUser(firstUser, `select public.adjust_commercial_bundle_stock_checked('${bundleId}', 2, 0, 'Contagem stale NK70', '${key(71)}')`, { allowFailure: true }),
  /bundle_stock_adjustment_quantity_conflict/i,
);
assert.equal(number(`select count(*) from public.bundle_assembly_operations where batch_id = '${adjusted.movement_batch_id}'`), 0);

setFreeBalances(2147483647, [2147483647, 2147483647, 2147483647, 2147483647], 1);
const overflowBefore = bundleState(bundleId, configurationId, loosePartIds);
assert.match(
  asUser(firstUser, disassemble(1, key(72)), { allowFailure: true }),
  /would overflow a component balance/i,
);
assert.deepEqual(bundleState(bundleId, configurationId, loosePartIds), overflowBefore);

for (const statement of [
  `update public.commercial_bundle_components set quantity_per_bundle = 2 where bundle_id = '${bundleId}' and item_id = '${loosePartIds[0]}'`,
  `delete from public.commercial_bundle_components where bundle_id = '${bundleId}' and item_id = '${loosePartIds[0]}'`,
  `insert into public.commercial_bundle_components (bundle_id, quantity_per_bundle, item_id) values ('${bundleId}', 1, (select id from public.items where item_type = 'REPAIR_KIT' limit 1))`,
]) {
  assert.match(psql(statement, { allowFailure: true }), /immutable after first use/i);
}

assert.match(
  psql("begin; insert into public.commercial_bundles (description) values ('EMPTY NK70'); commit;", { allowFailure: true }),
  /must have a non-empty recipe/i,
);

const recipeSourceBundle = scalar("insert into public.commercial_bundles (description, is_active) values ('Recipe source NK70', false) returning id");
const recipeTargetBundle = scalar("insert into public.commercial_bundles (description, is_active) values ('Recipe target NK70', false) returning id");
psql(`
  insert into public.commercial_bundle_components (bundle_id, quantity_per_bundle, item_id)
  values ('${recipeSourceBundle}', 1, (select id from public.items where item_type = 'REPAIR_KIT' limit 1));
  update public.commercial_bundles set is_active = true where id = '${recipeSourceBundle}';
`);
assert.match(
  psql(`begin; update public.commercial_bundle_components set bundle_id = '${recipeTargetBundle}' where bundle_id = '${recipeSourceBundle}'; commit;`, { allowFailure: true }),
  /must have a non-empty recipe/i,
);
assert.equal(number(`select count(*) from public.commercial_bundle_components where bundle_id = '${recipeSourceBundle}'`), 1);

const inactiveBundleId = scalar("insert into public.commercial_bundles (description, is_active) values ('Namespace race NK70', false) returning id");
const namespaceRace = await Promise.allSettled([
  concurrent(`begin; insert into public.items (id, code, description, item_type) values ('${itemId(20)}', 'NK70-RACE', 'Race item', 'LOOSE_PART'); insert into public.loose_parts (item_id) values ('${itemId(20)}'); commit;`),
  concurrent(`insert into public.commercial_bundle_codes (bundle_id, code) values ('${inactiveBundleId}', 'nk70-race')`),
]);
assert.equal(namespaceRace.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(namespaceRace.filter((result) => result.status === "rejected").length, 1);

setFreeBalances(0, [0, 0, 0, 0], 0);
const servoId = scalar(`select servo_id from public.commercial_configurations where id = '${configurationId}'`);
const kitId = scalar(`select installation_kit_id from public.commercial_configurations where id = '${configurationId}'`);
psql(`
  insert into public.stock_balances (item_id, quantity) values
    ('${servoId}', 1), ('${kitId}', 1)
  on conflict (item_id) do update set quantity = excluded.quantity;
`);
jsonFrom(asUser(firstUser, `select public.assemble_commercial_configuration('${configurationId}', 1, '${key(80)}', '1H', 'Legacy NK70')`));
jsonFrom(asUser(firstUser, `select public.disassemble_commercial_configuration('${configurationId}', 1, '${key(81)}', '1H', 'Legacy NK70')`));
assert.equal(number("select count(*) from public.commercial_configurations"), 80);

assert.match(
  psql(`update public.bundle_stock_balances set quantity = -1 where bundle_id = '${bundleId}'`, { allowFailure: true }),
  /bundle_stock_balances_quantity_check/i,
);
assert.match(
  psql(`insert into public.bundle_stock_movements (batch_id, bundle_id, quantity_change, quantity_before, quantity_after) values ((select id from public.movement_batches limit 1), '${bundleId}', 1, 0, 2)`, { allowFailure: true }),
  /bundle_stock_movements_quantity_consistency_check/i,
);

console.log("BUNDLE RECIPE FOUNDATION LOCAL TESTS PASSED");
