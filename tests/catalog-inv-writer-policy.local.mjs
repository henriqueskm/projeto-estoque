import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const container = process.env.CATALOG_INV_TEST_DB_CONTAINER
  ?? "supabase_db_nk_current_state_baseline";
const database = process.env.CATALOG_INV_TEST_DB_NAME;
const targetItemId = "efce5819-0fe5-4766-8856-29924fdc3fcd";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationSql = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260913003000_enforce_catalog_inv_writer_policy.sql",
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
const firstUser = "56000000-0000-4000-8000-000000000001";
const secondUser = "56000000-0000-4000-8000-000000000002";
const key = (value) => `56000000-0000-4000-8001-${String(value).padStart(12, "0")}`;

if (!database || database === "postgres" || !database.startsWith("nk56_")) {
  throw new Error(
    "CATALOG_INV_TEST_DB_NAME must name an nk56_ disposable database; the baseline database is never mutated.",
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
    {
      encoding: "utf8",
      input: migrationSql,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
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

function createCall(code, description = "PECA TESTE NK56") {
  return `select public.create_loose_part('${code}', '${description}')`;
}

function concurrent(userId, statement) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      docker,
      [
        "exec", container, "psql", "-U", "postgres", "-d", database,
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c",
        authSql(userId, statement),
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

function inboundCall(codes, idempotencyKey) {
  const lines = codes.map((code) => ({
    kind: "NEW_LOOSE_PART",
    code,
    description: "PECA TESTE NK56",
    quantity: 1,
  }));
  return `select public.stock_inbound_lines(
    '${JSON.stringify(lines)}'::jsonb,
    '${idempotencyKey}'::uuid,
    'Teste local NK56'
  )`;
}

function cleanup() {
  psql(`
    delete from public.stock_movements
    where item_id in (
      select id from public.items
      where code like '8056%'
        or code like 'NK56-%'
        or code in ('ABC.123', 'PEÇA-1')
    );
    delete from public.stock_balances
    where item_id in (
      select id from public.items
      where code like '8056%'
        or code like 'NK56-%'
        or code in ('ABC.123', 'PEÇA-1')
    );
    delete from public.inbound_batch_lines
    where batch_id in (
      select id from public.movement_batches
      where idempotency_key::text like '56000000-0000-4000-8001-%'
    );
    delete from public.movement_batches
    where idempotency_key::text like '56000000-0000-4000-8001-%';
    delete from public.loose_parts
    where item_id in (
      select id from public.items
      where code like '8056%'
        or code like 'NK56-%'
        or code in ('ABC.123', 'PEÇA-1')
    );
    delete from public.items
    where code like '8056%'
      or code like 'NK56-%'
      or code in ('ABC.123', 'PEÇA-1');
    delete from public.profiles where id in ('${firstUser}', '${secondUser}');
    delete from auth.users where id in ('${firstUser}', '${secondUser}');
  `);
}

console.log("ALVO CONFIRMADO: POSTGRESQL LOCAL/DESCARTAVEL ANTES DA MIGRATION NK56");

const targetItem = JSON.parse(
  scalar(`select row_to_json(item)::text
    from public.items as item
    where item.id = '${targetItemId}'::uuid`),
);
assert.deepEqual(
  {
    id: targetItem.id,
    code: targetItem.code,
    description: targetItem.description,
    itemType: targetItem.item_type,
    minimumStock: targetItem.minimum_stock,
    isActive: targetItem.is_active,
    createdBy: targetItem.created_by,
    createdByName: targetItem.created_by_name_snapshot,
  },
  {
    id: targetItemId,
    code: "7 INV",
    description: "SERVO BR-040 INVER SEM KIT",
    itemType: "LOOSE_PART",
    minimumStock: 0,
    isActive: true,
    createdBy: null,
    createdByName: null,
  },
);

const itemReferences = JSON.parse(
  scalar(`
    select coalesce(jsonb_agg(reference_row order by schema_name, table_name, column_name), '[]'::jsonb)::text
    from (
      select
        referencing_namespace.nspname as schema_name,
        referencing_table.relname as table_name,
        referencing_column.attname as column_name
      from pg_catalog.pg_constraint as constraint_record
      join lateral unnest(constraint_record.conkey) with ordinality
        as referencing_key(attnum, ordinal_position) on true
      join lateral unnest(constraint_record.confkey) with ordinality
        as referenced_key(attnum, ordinal_position)
        on referenced_key.ordinal_position = referencing_key.ordinal_position
      join pg_catalog.pg_class as referencing_table
        on referencing_table.oid = constraint_record.conrelid
      join pg_catalog.pg_namespace as referencing_namespace
        on referencing_namespace.oid = referencing_table.relnamespace
      join pg_catalog.pg_attribute as referencing_column
        on referencing_column.attrelid = constraint_record.conrelid
       and referencing_column.attnum = referencing_key.attnum
      join pg_catalog.pg_attribute as referenced_column
        on referenced_column.attrelid = constraint_record.confrelid
       and referenced_column.attnum = referenced_key.attnum
      where constraint_record.contype = 'f'
        and constraint_record.confrelid = 'public.items'::regclass
        and referenced_column.attname = 'id'
    ) as reference_row
  `),
);
assert.ok(itemReferences.length >= 14, "all current item foreign keys must be inventoried");
for (const reference of itemReferences) {
  const table = `${quoteIdentifier(reference.schema_name)}.${quoteIdentifier(reference.table_name)}`;
  const column = quoteIdentifier(reference.column_name);
  const referenceCount = number(
    `select count(*) from ${table} where ${column} = '${targetItemId}'::uuid`,
  );
  const isOwnedSubtype = reference.schema_name === "public"
    && reference.table_name === "loose_parts"
    && reference.column_name === "item_id";
  assert.equal(referenceCount, isOwnedSubtype ? 1 : 0, `${table}.${column}`);
}

const storedTables = JSON.parse(
  scalar(`
    select coalesce(jsonb_agg(table_row order by schema_name, table_name), '[]'::jsonb)::text
    from (
      select namespace_record.nspname as schema_name, table_record.relname as table_name
      from pg_catalog.pg_class as table_record
      join pg_catalog.pg_namespace as namespace_record
        on namespace_record.oid = table_record.relnamespace
      where table_record.relkind in ('r', 'p')
        and namespace_record.nspname in ('public', 'private')
    ) as table_row
  `),
);
const footprintSql = storedTables.map((table) => {
  const qualifiedTable = `${quoteIdentifier(table.schema_name)}.${quoteIdentifier(table.table_name)}`;
  return `select '${table.schema_name}.${table.table_name}' as relation,
    count(*) filter (where row_to_json(stored_row)::text like '%${targetItemId}%') as uuid_count,
    count(*) filter (where row_to_json(stored_row)::text like '%7 INV%') as code_count
    from ${qualifiedTable} as stored_row`;
}).join(" union all ");
const footprint = psql(`${footprintSql} order by relation`)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [relation, uuidCount, codeCount] = line.split("|");
    return { relation, uuidCount: Number(uuidCount), codeCount: Number(codeCount) };
  })
  .filter((entry) => entry.uuidCount > 0 || entry.codeCount > 0);
assert.deepEqual(footprint, [
  { relation: "public.items", uuidCount: 1, codeCount: 1 },
  { relation: "public.loose_parts", uuidCount: 1, codeCount: 0 },
]);

const itemIdsBefore = new Set(
  psql("select id from public.items order by id").split(/\r?\n/).filter(Boolean),
);
applyMigration();
const itemIdsAfter = new Set(
  psql("select id from public.items order by id").split(/\r?\n/).filter(Boolean),
);
assert.deepEqual(
  [...itemIdsBefore].filter((itemId) => !itemIdsAfter.has(itemId)),
  [targetItemId],
);
assert.deepEqual(
  [...itemIdsAfter].filter((itemId) => !itemIdsBefore.has(itemId)),
  [],
);
assert.equal(number(`select count(*) from public.items where id = '${targetItemId}'::uuid`), 0);
assert.equal(number(`select count(*) from public.loose_parts where item_id = '${targetItemId}'::uuid`), 0);
assert.equal(number("select count(*) from public.items where code in ('7INV015', '7INV028')"), 2);
assert.equal(number("select count(*) from public.items where code = '091/VF'"), 1);
assert.equal(
  scalar(`select
    to_regprocedure('private.catalog_code_write_policy(text)') is not null
    and to_regprocedure('private.catalog_codes_conflict(text,text)') is not null`),
  "t",
);
console.log("MIGRATION NK56 APLICADA; REMOCAO ORFA E EXCLUSIVA CONFIRMADA");

cleanup();

try {
  psql(`
    insert into auth.users (id, aud, role, created_at, updated_at) values
      ('${firstUser}', 'authenticated', 'authenticated', now(), now()),
      ('${secondUser}', 'authenticated', 'authenticated', now(), now());
    insert into public.profiles (id, name, is_active) values
      ('${firstUser}', 'NK56 Local One', true),
      ('${secondUser}', 'NK56 Local Two', true);
  `);

  assert.equal(
    scalar("select has_function_privilege('authenticated', 'private.resolve_or_create_loose_part(text,text,uuid,text)', 'execute')"),
    "f",
  );

  const movementCount = number("select count(*) from public.stock_movements");
  asUser(firstUser, createCall("NK56-CATALOG"));
  assert.equal(number("select count(*) from public.items where code = 'NK56-CATALOG' and minimum_stock = 0"), 1);
  assert.equal(number("select count(*) from public.stock_movements"), movementCount);

  for (const code of ["ABC.123", "PEÇA-1"]) {
    asUser(firstUser, createCall(code));
    assert.equal(number(`select count(*) from public.items where code = '${code}'`), 1);
    assert.equal(number("select count(*) from public.stock_movements"), movementCount);
  }

  asUser(firstUser, createCall("091/VF", "TAMPA INTERMEDIARIA VF - 024,5"));
  assert.equal(number("select count(*) from public.items where code = '091/VF'"), 1);
  assert.equal(number("select count(*) from public.stock_movements"), movementCount);

  asUser(firstUser, inboundCall(["NK56-INBOUND"], key(1)));
  assert.equal(number("select quantity from public.stock_balances where item_id = (select id from public.items where code = 'NK56-INBOUND')"), 1);
  assert.equal(number("select count(*) from public.stock_movements where item_id = (select id from public.items where code = 'NK56-INBOUND')"), 1);

  for (const code of ["1-INV", "5-INV", "5INV", "7-INV", "7INV"]) {
    const failure = asUser(firstUser, createCall(code), { allowFailure: true });
    assert.match(failure, /conflicts with existing catalog code/i, code);
  }

  for (const code of [
    "5-INV-015",
    "5INV-015",
    "5 INV 015",
    "7 INV",
    "7‑INV",
    "7 INV",
    "７-INV",
    "７－ＩＮＶ",
  ]) {
    const failure = asUser(firstUser, createCall(code), { allowFailure: true });
    assert.match(failure, /unsupported/i, code);
    assert.equal(number(`select count(*) from public.items where code = '${code}'`), 0);
  }

  for (const [index, codes] of [
    [2, ["80561-INV", "80561INV1"]],
    [3, ["80562INV1", "80562-INV"]],
  ]) {
    const failure = asUser(firstUser, inboundCall(codes, key(index)), { allowFailure: true });
    assert.match(failure, /conflicts with existing catalog code/i);
    assert.equal(number(`select count(*) from public.items where code = any(array['${codes.join("','")}'])`), 0);
  }

  const race = await Promise.allSettled([
    concurrent(firstUser, createCall("80563-INV")),
    concurrent(secondUser, createCall("80563INV")),
  ]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);
  assert.match(race.find((result) => result.status === "rejected").reason.message, /conflicts with existing catalog code/i);
  assert.equal(number("select count(*) from public.items where code in ('80563-INV', '80563INV')"), 1);

  assert.equal(
    number(`
      select count(*)
      from public.items as left_item
      join public.items as right_item
        on left_item.id < right_item.id
       and private.catalog_codes_conflict(left_item.code, right_item.code)
    `),
    0,
  );
} finally {
  cleanup();
}

console.log("CATALOG_INV_WRITER_POLICY_LOCAL_TESTS_PASSED");
