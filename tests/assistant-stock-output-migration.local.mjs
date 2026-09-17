import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const container = process.env.ASSISTANT_OUTPUT_TEST_DB_CONTAINER
  ?? "supabase_db_nk_current_state_baseline";
const database = process.env.ASSISTANT_OUTPUT_TEST_DB_NAME;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationSql = readFileSync(
  resolve(repositoryRoot, "supabase/migrations/20260917120000_add_stock_outbound_auto_assembly_policy.sql"),
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
const userId = "67000000-0000-4000-8000-000000000001";
const key = (value) => `67000000-0000-4000-8001-${String(value).padStart(12, "0")}`;

if (!database || database === "postgres" || !database.startsWith("nk_assistant_output_")) {
  throw new Error(
    "ASSISTANT_OUTPUT_TEST_DB_NAME must name an nk_assistant_output_ disposable database; the baseline database is never mutated.",
  );
}

function psql(sql, { allowFailure = false } = {}) {
  try {
    return execFileSync(
      docker,
      [
        "exec", container, "psql", "-U", "postgres", "-d", database,
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

function scalar(sql) {
  return psql(sql).split(/\r?\n/).at(-1);
}

function applyMigration() {
  execFileSync(
    docker,
    [
      "exec", "-i", container, "psql", "-U", "postgres", "-d", database,
      "-X", "-q", "-v", "ON_ERROR_STOP=1",
    ],
    { encoding: "utf8", input: migrationSql, stdio: ["pipe", "pipe", "pipe"] },
  );
}

function authSql(statement) {
  return `
    begin;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    set local role authenticated;
    ${statement};
    commit;
  `;
}

function asUser(statement, options) {
  return psql(authSql(statement), options);
}

function concurrent(statement) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      docker,
      [
        "exec", container, "psql", "-U", "postgres", "-d", database,
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", authSql(statement),
      ],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolvePromise(stdout.trim().split(/\r?\n/).at(-1));
      else rejectPromise(new Error(`${stdout}\n${stderr}`.trim()));
    });
  });
}

function callSql(commercialCodeId, quantity, idempotencyKey, allowAutoAssembly, description = "Teste local Assistente NK") {
  const lines = JSON.stringify([{
    kind: "COMMERCIAL_CODE",
    commercial_code_id: commercialCodeId,
    quantity,
  }]);
  const policy = allowAutoAssembly === null ? "" : `, ${allowAutoAssembly ? "true" : "false"}`;
  return `select public.stock_outbound_items(
    '${lines}'::jsonb,
    '${idempotencyKey}'::uuid,
    '${description}'${policy}
  )::text`;
}

function receipt(output) {
  return JSON.parse(output.split(/\r?\n/).at(-1));
}

function testFootprint(configurationId, servoId, kitId) {
  return JSON.parse(scalar(`
    select jsonb_build_object(
      'batches', (select count(*) from public.movement_batches where user_id = '${userId}'::uuid),
      'lines', (select count(*) from public.outbound_batch_lines where batch_id in (select id from public.movement_batches where user_id = '${userId}'::uuid)),
      'stock_movements', (select count(*) from public.stock_movements where batch_id in (select id from public.movement_batches where user_id = '${userId}'::uuid)),
      'configuration_movements', (select count(*) from public.configuration_stock_movements where batch_id in (select id from public.movement_batches where user_id = '${userId}'::uuid)),
      'assemblies', (select count(*) from public.assembly_operations where batch_id in (select id from public.movement_batches where user_id = '${userId}'::uuid)),
      'configuration_balance', coalesce((select quantity from public.configuration_stock_balances where configuration_id = '${configurationId}'::uuid), 0),
      'servo_balance', coalesce((select quantity from public.stock_balances where item_id = '${servoId}'::uuid), 0),
      'kit_balance', coalesce((select quantity from public.stock_balances where item_id = '${kitId}'::uuid), 0)
    )::text
  `));
}

function setBalances(configurationId, servoId, kitId, mounted, servo, kit) {
  psql(`
    insert into public.configuration_stock_balances (configuration_id, quantity)
    values ('${configurationId}'::uuid, ${mounted})
    on conflict (configuration_id) do update set quantity = excluded.quantity;
    insert into public.stock_balances (item_id, quantity) values
      ('${servoId}'::uuid, ${servo}),
      ('${kitId}'::uuid, ${kit})
    on conflict (item_id) do update set quantity = excluded.quantity;
  `);
}

function cleanup() {
  psql(`
    delete from public.outbound_batch_lines where batch_id in (select id from public.movement_batches where user_id = '${userId}'::uuid);
    delete from public.assembly_operations where batch_id in (select id from public.movement_batches where user_id = '${userId}'::uuid);
    delete from public.stock_movements where batch_id in (select id from public.movement_batches where user_id = '${userId}'::uuid);
    delete from public.configuration_stock_movements where batch_id in (select id from public.movement_batches where user_id = '${userId}'::uuid);
    delete from public.movement_batches where user_id = '${userId}'::uuid;
  `);
}

console.log("ALVO CONFIRMADO: POSTGRESQL LOCAL/DESCARTAVEL PARA SAIDA DA ASSISTENTE");
assert.equal(scalar("select current_database()"), database);
assert.equal(scalar("select to_regprocedure('public.stock_outbound_items(jsonb,uuid,text)') is not null"), "t");
const target = JSON.parse(scalar(`
  select row_to_json(target_row)::text
  from (
    select
      configuration.id as configuration_id,
      configuration.servo_id,
      configuration.installation_kit_id as kit_id,
      commercial_code.id as commercial_code_id
    from public.commercial_configurations as configuration
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.configuration_id = configuration.id
     and commercial_code.is_active
    join public.items as servo on servo.id = configuration.servo_id and servo.is_active
    join public.items as kit on kit.id = configuration.installation_kit_id and kit.is_active
    where configuration.is_active
    order by configuration.id, commercial_code.id
    limit 1
  ) as target_row
`));
assert.ok(target, "the disposable baseline needs one active commercial configuration");
const originalBalances = testFootprint(target.configuration_id, target.servo_id, target.kit_id);

applyMigration();
assert.equal(scalar("select to_regprocedure('public.stock_outbound_items(jsonb,uuid,text,boolean)') is not null"), "t");
assert.equal(scalar("select has_function_privilege('authenticated', 'public.stock_outbound_items(jsonb,uuid,text,boolean)', 'execute')"), "t");
assert.equal(scalar("select has_function_privilege('anon', 'public.stock_outbound_items(jsonb,uuid,text,boolean)', 'execute')"), "f");
assert.equal(scalar("select has_function_privilege('service_role', 'public.stock_outbound_items(jsonb,uuid,text,boolean)', 'execute')"), "f");
assert.equal(scalar("select has_function_privilege('service_role', 'public.stock_outbound_items(jsonb,uuid,text)', 'execute')"), "f");

psql(`
  insert into auth.users (id, aud, role, created_at, updated_at)
  values ('${userId}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active)
  values ('${userId}', 'Assistente Output Local', true);
`);

try {
  cleanup();
  setBalances(target.configuration_id, target.servo_id, target.kit_id, 0, 5, 5);
  let before = testFootprint(target.configuration_id, target.servo_id, target.kit_id);
  let failure = asUser(callSql(target.commercial_code_id, 2, key(1), false), { allowFailure: true });
  assert.match(failure, /Automatic assembly is disabled/);
  assert.deepEqual(testFootprint(target.configuration_id, target.servo_id, target.kit_id), before);

  const autoReceipt = receipt(asUser(callSql(target.commercial_code_id, 2, key(2), true)));
  assert.equal(autoReceipt.auto_assembled_quantity, 2);
  assert.equal(Number(scalar(`select count(*) from public.assembly_operations where batch_id = '${autoReceipt.movement_batch_id}'::uuid`)), 1);

  cleanup();
  setBalances(target.configuration_id, target.servo_id, target.kit_id, 0, 5, 5);
  const legacyReceipt = receipt(asUser(callSql(target.commercial_code_id, 1, key(3), null)));
  assert.equal(legacyReceipt.auto_assembled_quantity, 1);

  cleanup();
  setBalances(target.configuration_id, target.servo_id, target.kit_id, 2, 5, 5);
  const firstReceipt = receipt(asUser(callSql(target.commercial_code_id, 1, key(4), false)));
  assert.equal(firstReceipt.auto_assembled_quantity, 0);
  setBalances(target.configuration_id, target.servo_id, target.kit_id, 0, 5, 5);
  const replayReceipt = receipt(asUser(callSql(target.commercial_code_id, 1, key(4), false)));
  assert.deepEqual(replayReceipt, firstReceipt);
  before = testFootprint(target.configuration_id, target.servo_id, target.kit_id);
  failure = asUser(callSql(target.commercial_code_id, 1, key(5), false), { allowFailure: true });
  assert.match(failure, /Automatic assembly is disabled/);
  assert.deepEqual(testFootprint(target.configuration_id, target.servo_id, target.kit_id), before);

  cleanup();
  setBalances(target.configuration_id, target.servo_id, target.kit_id, 1, 5, 5);
  asUser(callSql(target.commercial_code_id, 1, key(6), false));
  const componentsAfterConsumption = testFootprint(target.configuration_id, target.servo_id, target.kit_id);
  failure = asUser(callSql(target.commercial_code_id, 1, key(7), false), { allowFailure: true });
  assert.match(failure, /Automatic assembly is disabled/);
  assert.deepEqual(testFootprint(target.configuration_id, target.servo_id, target.kit_id), componentsAfterConsumption);

  cleanup();
  setBalances(target.configuration_id, target.servo_id, target.kit_id, 1, 5, 5);
  const concurrentSql = callSql(target.commercial_code_id, 1, key(8), false);
  const [concurrentFirst, concurrentSecond] = await Promise.all([
    concurrent(concurrentSql),
    concurrent(concurrentSql),
  ]);
  assert.deepEqual(receipt(concurrentFirst), receipt(concurrentSecond));
  assert.equal(Number(scalar(`select count(*) from public.movement_batches where user_id = '${userId}'::uuid and idempotency_key = '${key(8)}'::uuid`)), 1);

  cleanup();
  setBalances(target.configuration_id, target.servo_id, target.kit_id, 1, 5, 5);
  const staleRace = await Promise.allSettled([
    concurrent(callSql(target.commercial_code_id, 1, key(9), false)),
    concurrent(callSql(target.commercial_code_id, 1, key(10), false)),
  ]);
  assert.equal(staleRace.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(staleRace.filter((result) => result.status === "rejected").length, 1);
  const raceFootprint = testFootprint(target.configuration_id, target.servo_id, target.kit_id);
  assert.equal(raceFootprint.batches, 1);
  assert.equal(raceFootprint.configuration_balance, 0);
  assert.equal(raceFootprint.servo_balance, 5);
  assert.equal(raceFootprint.kit_balance, 5);
  assert.equal(raceFootprint.assemblies, 0);

  cleanup();
  setBalances(target.configuration_id, target.servo_id, target.kit_id, 0, 5, 5);
  before = testFootprint(target.configuration_id, target.servo_id, target.kit_id);
  psql(`
    create function private.fail_assistant_output_movement_test()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      raise exception 'forced assistant output rollback';
    end;
    $$;
    create trigger fail_assistant_output_movement_test
    before insert on public.stock_movements
    for each row execute function private.fail_assistant_output_movement_test();
  `);
  failure = asUser(callSql(target.commercial_code_id, 1, key(11), true), { allowFailure: true });
  assert.match(failure, /forced assistant output rollback/);
  assert.deepEqual(testFootprint(target.configuration_id, target.servo_id, target.kit_id), before);
  psql("drop trigger fail_assistant_output_movement_test on public.stock_movements; drop function private.fail_assistant_output_movement_test();");
} finally {
  psql("drop trigger if exists fail_assistant_output_movement_test on public.stock_movements; drop function if exists private.fail_assistant_output_movement_test();");
  cleanup();
  setBalances(
    target.configuration_id,
    target.servo_id,
    target.kit_id,
    originalBalances.configuration_balance,
    originalBalances.servo_balance,
    originalBalances.kit_balance,
  );
  psql(`delete from public.profiles where id = '${userId}'::uuid; delete from auth.users where id = '${userId}'::uuid;`);
}

console.log("SAIDA DA ASSISTENTE: POLITICA, REPLAY, CONCORRENCIA, ACL E ROLLBACK CONFIRMADOS");
