import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const container = process.env.CATALOG_INV_TEST_DB_CONTAINER
  ?? "supabase_db_nk_current_state_baseline";
const legacyDatabase = process.env.CATALOG_INV_LEGACY_TEST_DB_NAME;
const authoredDatabase = process.env.CATALOG_INV_AUTHORED_TEST_DB_NAME;
const targetItemId = "efce5819-0fe5-4766-8856-29924fdc3fcd";
const expectedCreatorId = "cc7fafb6-7dd1-465a-b6e5-dfbb00b8aab9";
const divergentCreatorId = "cc7fafb6-7dd1-465a-b6e5-dfbb00b8aaba";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prepareMigrationSql = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260913002900_prepare_7_inv_test_item_removal.sql",
  ),
  "utf8",
);
const policyMigrationSql = readFileSync(
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

for (const [name, database, prefix] of [
  ["CATALOG_INV_LEGACY_TEST_DB_NAME", legacyDatabase, "nk_prepare7inv_legacy_"],
  ["CATALOG_INV_AUTHORED_TEST_DB_NAME", authoredDatabase, "nk_prepare7inv_authored_"],
]) {
  if (!database || database === "postgres" || !database.startsWith(prefix)) {
    throw new Error(
      `${name} must name a ${prefix} disposable database; the baseline database is never mutated.`,
    );
  }
}

if (legacyDatabase === authoredDatabase) {
  throw new Error("Legacy and authored scenarios must use separate disposable databases.");
}

function createClient(database) {
  function psql(sql, { allowFailure = false, role = "postgres" } = {}) {
    try {
      return execFileSync(
        docker,
        [
          "exec", container, "psql", "-U", role, "-d", database,
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

  function applySql(sql, { allowFailure = false } = {}) {
    try {
      return execFileSync(
        docker,
        [
          "exec", "-i", container, "psql", "-U", "supabase_admin", "-d", database,
          "-X", "-q", "-v", "ON_ERROR_STOP=1",
        ],
        {
          encoding: "utf8",
          input: sql,
          stdio: ["pipe", "pipe", "pipe"],
        },
      ).trim();
    } catch (error) {
      const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
      if (allowFailure) return output;
      throw new Error(output, { cause: error });
    }
  }

  function scalar(sql, options) {
    return psql(sql, options).split(/\r?\n/).at(-1);
  }

  function number(sql) {
    return Number(scalar(sql));
  }

  function itemIds() {
    return psql("select id from public.items order by id").split(/\r?\n/).filter(Boolean);
  }

  function catalogSnapshot() {
    return scalar(`
      select jsonb_build_object(
        'items', (
          select coalesce(jsonb_agg(to_jsonb(item_record) order by item_record.id), '[]'::jsonb)
          from public.items as item_record
          where item_record.id <> '${targetItemId}'::uuid
        ),
        'servo_models', (
          select coalesce(jsonb_agg(to_jsonb(subtype_record) order by subtype_record.item_id), '[]'::jsonb)
          from public.servo_models as subtype_record
        ),
        'installation_kits', (
          select coalesce(jsonb_agg(to_jsonb(subtype_record) order by subtype_record.item_id), '[]'::jsonb)
          from public.installation_kits as subtype_record
        ),
        'repair_kits', (
          select coalesce(jsonb_agg(to_jsonb(subtype_record) order by subtype_record.item_id), '[]'::jsonb)
          from public.repair_kits as subtype_record
        ),
        'loose_parts', (
          select coalesce(jsonb_agg(to_jsonb(subtype_record) order by subtype_record.item_id), '[]'::jsonb)
          from public.loose_parts as subtype_record
          where subtype_record.item_id <> '${targetItemId}'::uuid
        ),
        'commercial_configurations', (
          select coalesce(jsonb_agg(to_jsonb(configuration_record) order by configuration_record.id), '[]'::jsonb)
          from public.commercial_configurations as configuration_record
        ),
        'commercial_configuration_codes', (
          select coalesce(jsonb_agg(to_jsonb(code_record) order by code_record.id), '[]'::jsonb)
          from public.commercial_configuration_codes as code_record
        ),
        'servo_repair_compatibility', (
          select coalesce(
            jsonb_agg(
              to_jsonb(compatibility_record)
              order by compatibility_record.servo_id, compatibility_record.repair_kit_id
            ),
            '[]'::jsonb
          )
          from public.servo_repair_compatibility as compatibility_record
        )
      )::text
    `);
  }

  function expectPrepareFailure(pattern) {
    const failure = applySql(prepareMigrationSql, { allowFailure: true });
    assert.match(failure, pattern);
    assert.equal(number(`select count(*) from public.items where id = '${targetItemId}'::uuid`), 1);
  }

  return {
    applySql,
    catalogSnapshot,
    database,
    expectPrepareFailure,
    itemIds,
    number,
    psql,
    scalar,
  };
}

function targetIdentity(client) {
  return JSON.parse(client.scalar(`
    select jsonb_build_object(
      'id', item.id,
      'code', item.code,
      'description', item.description,
      'item_type', item.item_type,
      'minimum_stock', item.minimum_stock,
      'is_active', item.is_active,
      'created_by', item.created_by,
      'created_by_name_snapshot', item.created_by_name_snapshot
    )::text
    from public.items as item
    where item.id = '${targetItemId}'::uuid
  `));
}

function assertPrePolicyBaseline(client) {
  assert.equal(client.scalar("select current_database()"), client.database);
  assert.equal(
    client.scalar("select exists(select 1 from supabase_migrations.schema_migrations where version = '20260812223114')"),
    "t",
  );
  assert.equal(
    client.scalar("select exists(select 1 from supabase_migrations.schema_migrations where version = '20260913003000')"),
    "f",
  );
}

function assertPolicyInstalled(client) {
  assert.equal(
    client.scalar(`select
      to_regprocedure('private.catalog_code_write_policy(text)') is not null
      and to_regprocedure('private.catalog_codes_conflict(text,text)') is not null
      and to_regprocedure('private.enforce_catalog_code_namespace()') is not null
      and to_regprocedure('private.resolve_or_create_loose_part(text,text,uuid,text)') is not null
      and to_regprocedure('public.stock_inbound_lines(jsonb,uuid,text)') is not null`),
    "t",
  );
  assert.equal(
    client.number(`
      select count(*)
      from pg_catalog.pg_trigger
      where not tgisinternal
        and tgname in (
          'items_enforce_catalog_code_namespace',
          'commercial_configuration_codes_enforce_catalog_code_namespace'
        )
    `),
    2,
  );
  assert.equal(
    client.scalar(`select
      not has_function_privilege('authenticated', 'private.catalog_code_write_policy(text)', 'execute')
      and not has_function_privilege('authenticated', 'private.catalog_codes_conflict(text,text)', 'execute')
      and not has_function_privilege('authenticated', 'private.enforce_catalog_code_namespace()', 'execute')
      and not has_function_privilege('authenticated', 'private.resolve_or_create_loose_part(text,text,uuid,text)', 'execute')
      and has_function_privilege('authenticated', 'public.stock_inbound_lines(jsonb,uuid,text)', 'execute')`),
    "t",
  );
  assert.equal(
    client.scalar(
      `select canonical_code from private.catalog_code_write_policy('7INV015')`,
      { role: "supabase_admin" },
    ),
    "7INV015",
  );
}

assert.match(prepareMigrationSql, /^begin;[\s\S]*commit;\s*$/i);
assert.doesNotMatch(prepareMigrationSql, /\bcascade\b/i);
assert.match(prepareMigrationSql, /for update/i);
assert.match(prepareMigrationSql, /created_by is null[\s\S]*created_by_name_snapshot is null[\s\S]*return;/i);
assert.match(prepareMigrationSql, /get diagnostics v_deleted_count = row_count/gi);

const legacy = createClient(legacyDatabase);
console.log("CENARIO LEGADO: BASELINE CANONICO INTACTO EM POSTGRESQL DESCARTAVEL");
assertPrePolicyBaseline(legacy);
assert.deepEqual(targetIdentity(legacy), {
  id: targetItemId,
  code: "7 INV",
  description: "SERVO BR-040 INVER SEM KIT",
  item_type: "LOOSE_PART",
  minimum_stock: 0,
  is_active: true,
  created_by: null,
  created_by_name_snapshot: null,
});

const legacyItemBefore = legacy.scalar(`
  select row_to_json(item)::text
  from public.items as item
  where item.id = '${targetItemId}'::uuid
`);
const legacySubtypeBefore = legacy.scalar(`
  select row_to_json(loose_part)::text
  from public.loose_parts as loose_part
  where loose_part.item_id = '${targetItemId}'::uuid
`);
const legacyItemIdsBefore = legacy.itemIds();
const legacyCatalogBefore = legacy.catalogSnapshot();

legacy.applySql(prepareMigrationSql);
assert.equal(
  legacy.scalar(`select row_to_json(item)::text from public.items as item where item.id = '${targetItemId}'::uuid`),
  legacyItemBefore,
);
assert.equal(
  legacy.scalar(`select row_to_json(loose_part)::text from public.loose_parts as loose_part where loose_part.item_id = '${targetItemId}'::uuid`),
  legacySubtypeBefore,
);
assert.deepEqual(legacy.itemIds(), legacyItemIdsBefore);
assert.equal(legacy.catalogSnapshot(), legacyCatalogBefore);

legacy.applySql(policyMigrationSql);
const legacyItemIdsAfter = legacy.itemIds();
assert.deepEqual(
  legacyItemIdsBefore.filter((itemId) => !legacyItemIdsAfter.includes(itemId)),
  [targetItemId],
);
assert.deepEqual(
  legacyItemIdsAfter.filter((itemId) => !legacyItemIdsBefore.includes(itemId)),
  [],
);
assert.equal(legacy.number(`select count(*) from public.items where id = '${targetItemId}'::uuid`), 0);
assert.equal(legacy.number(`select count(*) from public.loose_parts where item_id = '${targetItemId}'::uuid`), 0);
assert.equal(legacy.catalogSnapshot(), legacyCatalogBefore);
assertPolicyInstalled(legacy);

const authored = createClient(authoredDatabase);
console.log("CENARIO AUTHORED: REMOCAO FAIL-CLOSED EM CLONE POSTGRESQL SEPARADO");
assertPrePolicyBaseline(authored);
assert.deepEqual(targetIdentity(authored), {
  id: targetItemId,
  code: "7 INV",
  description: "SERVO BR-040 INVER SEM KIT",
  item_type: "LOOSE_PART",
  minimum_stock: 0,
  is_active: true,
  created_by: null,
  created_by_name_snapshot: null,
});

authored.psql(`
  insert into auth.users (id, aud, role, created_at, updated_at) values
    ('${expectedCreatorId}', 'authenticated', 'authenticated', now(), now()),
    ('${divergentCreatorId}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active) values
    ('${expectedCreatorId}', 'Henrique Klein', true),
    ('${divergentCreatorId}', 'Outro Autor', true);
  update public.items
  set created_by = '${expectedCreatorId}'::uuid,
      created_by_name_snapshot = 'Henrique Klein'
  where id = '${targetItemId}'::uuid;
`);

assert.deepEqual(targetIdentity(authored), {
  id: targetItemId,
  code: "7 INV",
  description: "SERVO BR-040 INVER SEM KIT",
  item_type: "LOOSE_PART",
  minimum_stock: 0,
  is_active: true,
  created_by: expectedCreatorId,
  created_by_name_snapshot: "Henrique Klein",
});

const authoredCatalogBefore = authored.catalogSnapshot();

authored.psql(`update public.items set code = '7 INV TEST' where id = '${targetItemId}'::uuid`);
authored.expectPrepareFailure(/exact commercial identity changed/i);
authored.psql(`update public.items set code = '7 INV' where id = '${targetItemId}'::uuid`);

authored.psql(`update public.items set description = 'DESCRICAO DIVERGENTE' where id = '${targetItemId}'::uuid`);
authored.expectPrepareFailure(/exact commercial identity changed/i);
authored.psql(`update public.items set description = 'SERVO BR-040 INVER SEM KIT' where id = '${targetItemId}'::uuid`);

authored.psql(`update public.items set created_by = '${divergentCreatorId}'::uuid where id = '${targetItemId}'::uuid`);
authored.expectPrepareFailure(/exact audit signature changed/i);
authored.psql(`update public.items set created_by = '${expectedCreatorId}'::uuid where id = '${targetItemId}'::uuid`);

authored.psql(`update public.items set created_by_name_snapshot = 'Henrique K.' where id = '${targetItemId}'::uuid`);
authored.expectPrepareFailure(/exact audit signature changed/i);
authored.psql(`update public.items set created_by_name_snapshot = 'Henrique Klein' where id = '${targetItemId}'::uuid`);

authored.psql(`update public.items set created_by = null where id = '${targetItemId}'::uuid`);
authored.expectPrepareFailure(/exact audit signature changed/i);
authored.psql(`update public.items set created_by = '${expectedCreatorId}'::uuid where id = '${targetItemId}'::uuid`);

const rejectedPartialAudit = authored.psql(
  `update public.items set created_by_name_snapshot = null where id = '${targetItemId}'::uuid`,
  { allowFailure: true },
);
assert.match(rejectedPartialAudit, /items_created_by_name_snapshot_check/i);
assert.deepEqual(targetIdentity(authored), {
  id: targetItemId,
  code: "7 INV",
  description: "SERVO BR-040 INVER SEM KIT",
  item_type: "LOOSE_PART",
  minimum_stock: 0,
  is_active: true,
  created_by: expectedCreatorId,
  created_by_name_snapshot: "Henrique Klein",
});

authored.psql(`insert into public.stock_balances (item_id, quantity) values ('${targetItemId}'::uuid, 0)`);
authored.expectPrepareFailure(/public\.stock_balances\.item_id contains 1 reference/i);
assert.equal(authored.number(`select count(*) from public.stock_balances where item_id = '${targetItemId}'::uuid`), 1);
authored.psql(`delete from public.stock_balances where item_id = '${targetItemId}'::uuid`);

authored.psql(`delete from public.loose_parts where item_id = '${targetItemId}'::uuid`);
authored.expectPrepareFailure(/loose-part subtype is missing or duplicated/i);
authored.psql(`insert into public.loose_parts (item_id) values ('${targetItemId}'::uuid)`);

const duplicateSubtypeFailure = authored.psql(
  `insert into public.loose_parts (item_id) values ('${targetItemId}'::uuid)`,
  { allowFailure: true },
);
assert.match(duplicateSubtypeFailure, /duplicate key value|loose_parts_pkey/i);
assert.equal(authored.number(`select count(*) from public.loose_parts where item_id = '${targetItemId}'::uuid`), 1);

const authoredItemIdsBefore = authored.itemIds();
authored.applySql(prepareMigrationSql);
const authoredItemIdsAfter = authored.itemIds();
assert.deepEqual(
  authoredItemIdsBefore.filter((itemId) => !authoredItemIdsAfter.includes(itemId)),
  [targetItemId],
);
assert.deepEqual(
  authoredItemIdsAfter.filter((itemId) => !authoredItemIdsBefore.includes(itemId)),
  [],
);
assert.equal(authored.number(`select count(*) from public.items where id = '${targetItemId}'::uuid`), 0);
assert.equal(authored.number(`select count(*) from public.loose_parts where item_id = '${targetItemId}'::uuid`), 0);

authored.applySql(prepareMigrationSql);
assert.equal(authored.number(`select count(*) from public.items where id = '${targetItemId}'::uuid`), 0);

authored.applySql(policyMigrationSql);
assert.equal(authored.catalogSnapshot(), authoredCatalogBefore);
assertPolicyInstalled(authored);

console.log("CATALOG_INV_TEST_ITEM_REMOVAL_LOCAL_TESTS_PASSED");
console.log("LEGACY_BASELINE_PASS_THROUGH_AND_HISTORICAL_REPLAY_VERIFIED");
console.log("AUTHORED_EXACT_REMOVAL_AND_FAIL_CLOSED_GUARDS_VERIFIED");
