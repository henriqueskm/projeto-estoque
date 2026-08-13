import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const container = process.env.CATALOG_ONLY_TEST_DB_CONTAINER
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
const activeUser = "30000000-0000-4000-8000-000000000001";
const secondActiveUser = "30000000-0000-4000-8000-000000000002";
const inactiveUser = "30000000-0000-4000-8000-000000000003";
const deletedProfileUser = "30000000-0000-4000-8000-000000000004";
const key = (n) => `30000000-0000-4000-8001-${String(n).padStart(12, "0")}`;

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
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
    if (allowFailure) return output;
    throw new Error(output, { cause: error });
  }
}

function scalar(sql) {
  return psql(sql).split(/\r?\n/).at(-1);
}

function number(sql) {
  return Number(scalar(sql));
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

function asActive(statement, options) {
  return asUser(activeUser, statement, options);
}

function createCall(code, description) {
  return `select public.create_loose_part('${code}', '${description}')`;
}

function jsonFrom(output) {
  const line = output.split(/\r?\n/).findLast((value) => value.startsWith("{"));
  assert.ok(line, `Expected a JSON result, received: ${output}`);
  return JSON.parse(line);
}

function concurrent(userId, statement) {
  return new Promise((resolvePromise, rejectPromise) => {
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
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(`${stdout}\n${stderr}`.trim()));
    });
  });
}

function concurrentSql(statement) {
  return new Promise((resolvePromise, rejectPromise) => {
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
        statement,
      ],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(`${stdout}\n${stderr}`.trim()));
    });
  });
}

function operationalCounts() {
  return scalar(`
    select concat_ws('|',
      (select count(*) from public.movement_batches),
      (select count(*) from public.stock_movements),
      (select count(*) from public.configuration_stock_movements),
      (select coalesce(sum(quantity), 0) from public.stock_balances),
      (select coalesce(sum(quantity), 0) from public.configuration_stock_balances),
      (select count(*) from public.supplier_orders),
      (select count(*) from public.supplier_order_stock_entries)
    )
  `);
}

console.log("ALVO CONFIRMADO: SUPABASE LOCAL DESCARTAVEL");
assert.equal(
  scalar("select current_database() = 'postgres'"),
  "t",
);
assert.equal(
  scalar("select exists(select 1 from supabase_migrations.schema_migrations where version = '20260812223114')"),
  "t",
);

psql(`
  truncate table
    public.supplier_order_stock_entry_lines,
    public.supplier_order_stock_entries,
    public.inbound_batch_lines,
    public.outbound_batch_lines,
    public.configuration_stock_movements,
    public.stock_movements,
    public.movement_batches,
    public.configuration_stock_balances,
    public.stock_balances
  cascade;

  delete from public.loose_parts
  where item_id in (select id from public.items where code like 'C3A-%');
  delete from public.items where code like 'C3A-%';
  delete from public.commercial_configuration_codes where code like 'C3A-%';
  delete from public.profiles where id in ('${activeUser}', '${secondActiveUser}', '${inactiveUser}', '${deletedProfileUser}');
  delete from auth.users where id in ('${activeUser}', '${secondActiveUser}', '${inactiveUser}', '${deletedProfileUser}');

  insert into auth.users (id, aud, role, created_at, updated_at) values
    ('${activeUser}', 'authenticated', 'authenticated', now(), now()),
    ('${secondActiveUser}', 'authenticated', 'authenticated', now(), now()),
    ('${inactiveUser}', 'authenticated', 'authenticated', now(), now()),
    ('${deletedProfileUser}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active) values
    ('${activeUser}', 'Catalog Local', true),
    ('${secondActiveUser}', 'Second Catalog Local', true),
    ('${inactiveUser}', 'Inactive Local', false),
    ('${deletedProfileUser}', 'Deleted Profile Snapshot', true);
`);

const baselineEffects = operationalCounts();

// 1-7: catalog-only creates the canonical subtype and no operational effect.
let result = jsonFrom(asActive(createCall("  C3A-P123  ", "  SUPORTE DO SERVO  ")));
assert.equal(result.created, true);
assert.equal(result.code, "C3A-P123");
assert.equal(result.description, "SUPORTE DO SERVO");
assert.equal(result.item_type, "LOOSE_PART");
const itemId = result.item_id;
assert.equal(
  scalar(`select concat_ws('|', item_type, minimum_stock, is_active, created_by, created_by_name_snapshot) from public.items where id = '${itemId}'`),
  `LOOSE_PART|0|t|${activeUser}|Catalog Local`,
);
assert.equal(number(`select count(*) from public.loose_parts where item_id = '${itemId}'`), 1);
assert.equal(number(`select count(*) from public.stock_balances where item_id = '${itemId}'`), 0);
assert.equal(
  number(`select coalesce(balance.quantity, 0) from public.items item left join public.stock_balances balance on balance.item_id = item.id where item.id = '${itemId}'`),
  0,
);
assert.equal(operationalCounts(), baselineEffects);

// 8: natural idempotency returns the same active item without duplication.
result = jsonFrom(asActive(createCall("C3A-P123", "suporte do servo")));
assert.equal(result.created, false);
assert.equal(result.item_id, itemId);
assert.equal(number("select count(*) from public.items where code = 'C3A-P123'"), 1);
assert.equal(number(`select count(*) from public.loose_parts where item_id = '${itemId}'`), 1);

// 9: a conflicting description never overwrites catalog truth.
let failure = asActive(createCall("C3A-P123", "OUTRA DESCRICAO"), { allowFailure: true });
assert.match(failure, /different description/i);
assert.equal(scalar(`select description from public.items where id = '${itemId}'`), "SUPORTE DO SERVO");

const servoCode = scalar("select code from public.items where item_type = 'SERVO' order by code limit 1");
const kitCode = scalar("select code from public.items where item_type = 'INSTALLATION_KIT' order by code limit 1");
const repairCode = scalar("select code from public.items where item_type = 'REPAIR_KIT' order by code limit 1");
const commercialCode = scalar("select code from public.commercial_configuration_codes order by code limit 1");
const configurationId = scalar("select id from public.commercial_configurations order by id limit 1");

// 10-13: every cross-domain collision is rejected.
for (const [code, expected] of [
  [servoCode, /another item type/i],
  [kitCode, /another item type/i],
  [repairCode, /another item type/i],
  [commercialCode, /commercial configuration code/i],
]) {
  failure = asActive(createCall(code, "COLISAO LOCAL"), { allowFailure: true });
  assert.match(failure, expected);
}

// 14: inactive loose parts are not reactivated.
const inactiveResult = jsonFrom(asActive(createCall("C3A-INACTIVE", "PECA INATIVA")));
psql(`update public.items set is_active = false where id = '${inactiveResult.item_id}'`);
failure = asActive(createCall("C3A-INACTIVE", "PECA INATIVA"), { allowFailure: true });
assert.match(failure, /is inactive/i);
assert.equal(scalar(`select is_active from public.items where id = '${inactiveResult.item_id}'`), "f");

// 15-16: auth and active-profile gates execute before catalog creation.
failure = psql(createCall("C3A-NOAUTH", "SEM AUTH"), { allowFailure: true });
assert.match(failure, /authenticated user is required/i);
failure = asUser(inactiveUser, createCall("C3A-INACTIVE-PROFILE", "PROFILE INATIVO"), { allowFailure: true });
assert.match(failure, /active profile/i);
assert.equal(number("select count(*) from public.items where code in ('C3A-NOAUTH', 'C3A-INACTIVE-PROFILE')"), 0);

// 17: concurrent creates serialize into one item and one subtype.
const concurrentResults = await Promise.all([
  concurrent(activeUser, createCall("C3A-RACE", "PECA CONCORRENTE")),
  concurrent(secondActiveUser, createCall("C3A-RACE", "PECA CONCORRENTE")),
]);
const parsedRace = concurrentResults.map(jsonFrom);
assert.equal(new Set(parsedRace.map((entry) => entry.item_id)).size, 1);
assert.deepEqual(parsedRace.map((entry) => entry.created).sort(), [false, true]);
assert.equal(number("select count(*) from public.items where code = 'C3A-RACE'"), 1);
assert.equal(number("select count(*) from public.loose_parts where item_id = (select id from public.items where code = 'C3A-RACE')"), 1);

// Shared namespace: simultaneous inserts serialize and exactly one domain wins.
const crossDomainRace = await Promise.allSettled([
  concurrent(activeUser, createCall("C3A-XRACE", "ITEM CONCORRENTE ENTRE DOMINIOS")),
  concurrentSql(`insert into public.commercial_configuration_codes (configuration_id, code) values ('${configurationId}', 'C3A-XRACE') returning id`),
]);
assert.equal(crossDomainRace.filter((entry) => entry.status === "fulfilled").length, 1);
assert.equal(crossDomainRace.filter((entry) => entry.status === "rejected").length, 1);
assert.equal(
  number(`
    select
      (select count(*) from public.items where code = 'C3A-XRACE')
      + (select count(*) from public.commercial_configuration_codes where code = 'C3A-XRACE')
  `),
  1,
);
psql(`
  delete from public.loose_parts where item_id in (select id from public.items where code = 'C3A-XRACE');
  delete from public.items where code = 'C3A-XRACE';
  delete from public.commercial_configuration_codes where code = 'C3A-XRACE';
`);

// Commercial-first and item-first inserts reject the second domain deterministically.
psql(`insert into public.commercial_configuration_codes (configuration_id, code) values ('${configurationId}', 'C3A-COMM-FIRST')`);
failure = asActive(createCall("C3A-COMM-FIRST", "ITEM DEVE FALHAR"), { allowFailure: true });
assert.match(failure, /commercial configuration code/i);
assert.equal(number("select count(*) from public.items where code = 'C3A-COMM-FIRST'"), 0);

const itemFirst = jsonFrom(asActive(createCall("C3A-ITEM-FIRST", "ITEM PRIMEIRO")));
failure = psql(
  `insert into public.commercial_configuration_codes (configuration_id, code) values ('${configurationId}', 'C3A-ITEM-FIRST')`,
  { allowFailure: true },
);
assert.match(failure, /physical catalog item/i);
assert.equal(number("select count(*) from public.commercial_configuration_codes where code = 'C3A-ITEM-FIRST'"), 0);

// UPDATE is protected in both directions, not only INSERT.
psql(`insert into public.commercial_configuration_codes (configuration_id, code) values ('${configurationId}', 'C3A-COMM-UPDATE')`);
failure = psql(`update public.items set code = 'C3A-COMM-UPDATE' where id = '${itemFirst.item_id}'`, { allowFailure: true });
assert.match(failure, /commercial configuration code/i);
assert.equal(scalar(`select code from public.items where id = '${itemFirst.item_id}'`), "C3A-ITEM-FIRST");
failure = psql(
  `update public.commercial_configuration_codes set code = 'C3A-ITEM-FIRST' where code = 'C3A-COMM-UPDATE'`,
  { allowFailure: true },
);
assert.match(failure, /physical catalog item/i);
assert.equal(number("select count(*) from public.commercial_configuration_codes where code = 'C3A-COMM-UPDATE'"), 1);

// 18: any subtype failure rolls the parent item insert back atomically.
psql(`
  create function public.c3a_reject_test_subtype()
  returns trigger language plpgsql set search_path = '' as $$
  begin
    if exists (select 1 from public.items where id = new.item_id and code = 'C3A-ROLLBACK') then
      raise exception 'forced subtype failure';
    end if;
    return new;
  end;
  $$;
  create trigger c3a_reject_test_subtype
  before insert on public.loose_parts
  for each row execute function public.c3a_reject_test_subtype();
`);
failure = asActive(createCall("C3A-ROLLBACK", "ROLLBACK LOCAL"), { allowFailure: true });
assert.match(failure, /forced subtype failure/i);
assert.equal(number("select count(*) from public.items where code = 'C3A-ROLLBACK'"), 0);
psql(`
  drop trigger c3a_reject_test_subtype on public.loose_parts;
  drop function public.c3a_reject_test_subtype();
`);

// Authorship supports exactly the four reviewed lifecycle states.
assert.ok(
  number("select count(*) from public.items where code not like 'C3A-%' and created_by is null and created_by_name_snapshot is null") > 0,
  "legacy catalog rows must remain null/null",
);
assert.equal(
  scalar(`select concat_ws('|', created_by, created_by_name_snapshot) from public.items where id = '${itemId}'`),
  `${activeUser}|Catalog Local`,
);
const deletedProfileItem = jsonFrom(
  asUser(deletedProfileUser, createCall("C3A-DELETED-PROFILE", "SNAPSHOT PRESERVADO")),
);
psql(`delete from public.profiles where id = '${deletedProfileUser}'`);
assert.equal(
  scalar(`select concat_ws('|', coalesce(created_by::text, 'NULL'), created_by_name_snapshot) from public.items where id = '${deletedProfileItem.item_id}'`),
  "NULL|Deleted Profile Snapshot",
);
failure = psql(
  `update public.items set created_by = '${activeUser}', created_by_name_snapshot = null where id = '${itemId}'`,
  { allowFailure: true },
);
assert.match(failure, /items_created_by_name_snapshot_check/i);
failure = psql(
  `update public.items set created_by_name_snapshot = '   ' where id = '${itemId}'`,
  { allowFailure: true },
);
assert.match(failure, /items_created_by_name_snapshot_check/i);
assert.equal(
  scalar(`select concat_ws('|', created_by, created_by_name_snapshot) from public.items where id = '${itemId}'`),
  `${activeUser}|Catalog Local`,
);
assert.equal(
  number("select count(*) from pg_indexes where schemaname = 'public' and indexname = 'items_created_by_idx'"),
  1,
);

// 19-20: traditional NEW_LOOSE_PART still creates one inbound and one balance delta.
const beforeInbound = operationalCounts();
const inboundCall = `select public.stock_inbound_lines(
  '[{"kind":"NEW_LOOSE_PART","code":"C3A-INBOUND","description":"PECA COM ENTRADA","quantity":2}]'::jsonb,
  '${key(1)}'::uuid,
  'Entrada local de regressao'
)`;
const inboundResult = jsonFrom(asActive(inboundCall));
assert.ok(inboundResult.movement_batch_id);
const inboundItemId = scalar("select id from public.items where code = 'C3A-INBOUND'");
assert.equal(scalar(`select concat_ws('|', item_type, created_by, created_by_name_snapshot) from public.items where id = '${inboundItemId}'`), `LOOSE_PART|${activeUser}|Catalog Local`);
assert.equal(number(`select quantity from public.stock_balances where item_id = '${inboundItemId}'`), 2);
assert.equal(number(`select count(*) from public.stock_movements where item_id = '${inboundItemId}' and quantity_change = 2`), 1);
assert.equal(number(`select count(*) from public.movement_batches where id = '${inboundResult.movement_batch_id}'`), 1);
const afterInbound = operationalCounts();
assert.notEqual(afterInbound, beforeInbound);

const replay = jsonFrom(asActive(inboundCall));
assert.equal(replay.movement_batch_id, inboundResult.movement_batch_id);
assert.equal(number(`select quantity from public.stock_balances where item_id = '${inboundItemId}'`), 2);
assert.equal(number(`select count(*) from public.stock_movements where item_id = '${inboundItemId}'`), 1);

// Reusing an idempotency key with a different payload rejects and rolls back the attempted catalog item.
const effectsBeforeConflictingReplay = operationalCounts();
const conflictingInbound = `select public.stock_inbound_lines(
  '[{"kind":"NEW_LOOSE_PART","code":"C3A-INBOUND-CONFLICT","description":"NAO DEVE EXISTIR","quantity":3}]'::jsonb,
  '${key(1)}'::uuid,
  'Payload conflitante local'
)`;
failure = asActive(conflictingInbound, { allowFailure: true });
assert.match(failure, /idempotency|different payload|already used/i);
assert.equal(number("select count(*) from public.items where code = 'C3A-INBOUND-CONFLICT'"), 0);
assert.equal(operationalCounts(), effectsBeforeConflictingReplay);

// 21: another catalog-only create after inbound still has zero operational effect.
const effectsBeforeFinalCatalogCreate = operationalCounts();
result = jsonFrom(asActive(createCall("C3A-FINAL", "SOMENTE CATALOGO")));
assert.equal(result.created, true);
assert.equal(operationalCounts(), effectsBeforeFinalCatalogCreate);

assert.equal(
  scalar("select has_function_privilege('authenticated', 'public.create_loose_part(text,text)', 'execute')"),
  "t",
);
assert.equal(
  scalar("select has_function_privilege('anon', 'public.create_loose_part(text,text)', 'execute')"),
  "f",
);
assert.equal(
  scalar("select has_function_privilege('authenticated', 'private.resolve_or_create_loose_part(text,text,uuid,text)', 'execute')"),
  "f",
);
assert.equal(
  number(`
    select count(*)
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'items_enforce_catalog_code_namespace',
        'commercial_configuration_codes_enforce_catalog_code_namespace'
      )
  `),
  2,
);

console.log("CATALOG_ONLY_LOOSE_PART_TESTS_PASSED");
console.log("CATALOG_CODE_NAMESPACE_CONCURRENCY_VERIFIED");
console.log("CATALOG_AUTHORSHIP_FK_INDEX_VERIFIED");
console.log("LOOSE_PART_CREATION_DOES_NOT_MOVE_STOCK");
console.log("EXISTING_INBOUND_LOOSE_PART_FLOW_PRESERVED");
