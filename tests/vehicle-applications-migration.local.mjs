import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const container =
  process.env.VEHICLE_APPLICATIONS_TEST_DB_CONTAINER ??
  "supabase_db_nk_current_state_baseline";
const database = process.env.VEHICLE_APPLICATIONS_TEST_DB_NAME;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationSql = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260916090000_create_vehicle_applications.sql",
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
const activeUser = "60000000-0000-4000-8000-000000000001";
const inactiveUser = "60000000-0000-4000-8000-000000000002";

if (!database || !database.startsWith("nk60_")) {
  throw new Error(
    "VEHICLE_APPLICATIONS_TEST_DB_NAME must name an nk60_ disposable database; the baseline database is never mutated.",
  );
}

function psql(sql, { allowFailure = false } = {}) {
  try {
    return execFileSync(
      docker,
      [
        "exec",
        container,
        "psql",
        "-U",
        "supabase_admin",
        "-d",
        database,
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

function applyMigration() {
  execFileSync(
    docker,
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      encoding: "utf8",
      input: migrationSql,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

function catalogDigest() {
  return scalar(`
    select md5(jsonb_build_object(
      'items', (select jsonb_agg(to_jsonb(item) order by item.id) from public.items as item),
      'servo_models', (select jsonb_agg(to_jsonb(servo) order by servo.item_id) from public.servo_models as servo),
      'installation_kits', (select jsonb_agg(to_jsonb(kit) order by kit.item_id) from public.installation_kits as kit),
      'configurations', (select jsonb_agg(to_jsonb(configuration) order by configuration.id) from public.commercial_configurations as configuration),
      'codes', (select jsonb_agg(to_jsonb(code) order by code.id) from public.commercial_configuration_codes as code)
    )::text)
  `);
}

function authSql(userId, role, statement) {
  return `
    begin;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    set local role ${role};
    ${statement};
    rollback;
  `;
}

console.log("ALVO CONFIRMADO: POSTGRESQL LOCAL/DESCARTAVEL ANTES DA MIGRATION NK60");

const catalogBefore = catalogDigest();
assert.equal(scalar("select to_regclass('public.vehicle_applications') is null"), "t");
applyMigration();
assert.equal(catalogDigest(), catalogBefore, "the master catalog must remain unchanged");

assert.equal(number("select count(*) from public.vehicle_application_brands"), 8);
assert.equal(number("select count(*) from public.vehicle_applications"), 295);
assert.equal(
  number("select count(*) from public.vehicle_applications where application_kind = 'NORMAL'"),
  294,
);
assert.equal(
  number("select count(*) from public.vehicle_applications where application_kind = 'RESTRICTION'"),
  1,
);
assert.equal(
  number("select count(*) from public.vehicle_applications where catalog_resolution_status = 'RESOLVED' and commercial_configuration_code_id is not null"),
  283,
);
assert.equal(
  number("select count(*) from public.vehicle_applications where catalog_resolution_status = 'UNRESOLVED' and commercial_configuration_code_id is null"),
  11,
);
assert.equal(
  scalar(`
    select string_agg(distinct source_kit_code, ',' order by source_kit_code)
    from public.vehicle_applications
    where catalog_resolution_status = 'UNRESOLVED'
  `),
  "7B,7C,7G,7I,7J,7K,7L,7M,7O",
);
assert.equal(
  number(`
    select count(*)
    from public.vehicle_applications as application
    join public.commercial_configuration_codes as code
      on code.id = application.commercial_configuration_code_id
    join public.commercial_configurations as configuration
      on configuration.id = code.configuration_id
    join public.servo_models as servo
      on servo.item_id = configuration.servo_id
    join public.installation_kits as kit
      on kit.item_id = configuration.installation_kit_id
    where application.catalog_resolution_status = 'RESOLVED'
      and code.code = application.source_kit_code
  `),
  283,
);
assert.equal(
  scalar(`
    select concat_ws('|', brand.slug, application.vehicle_model, application.observation,
      application.application_kind, application.catalog_resolution_status,
      application.source_kit_code, application.source_servo_label,
      application.commercial_configuration_code_id)
    from public.vehicle_applications as application
    join public.vehicle_application_brands as brand on brand.id = application.brand_id
    where application.application_kind = 'RESTRICTION'
  `),
  "mercedes-benz|2423 Câmbio ZF|NÃO DÁ INSTALAÇÃO|RESTRICTION|NOT_APPLICABLE",
);

assert.equal(
  scalar("select has_table_privilege('anon', 'public.vehicle_applications', 'select')"),
  "f",
);
assert.equal(
  scalar("select has_table_privilege('authenticated', 'public.vehicle_applications', 'select')"),
  "t",
);
for (const privilege of ["insert", "update", "delete"]) {
  assert.equal(
    scalar(`select has_table_privilege('authenticated', 'public.vehicle_applications', '${privilege}')`),
    "f",
  );
}

psql(`
  insert into auth.users (id, aud, role, created_at, updated_at) values
    ('${activeUser}', 'authenticated', 'authenticated', now(), now()),
    ('${inactiveUser}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active) values
    ('${activeUser}', 'NK60 Active', true),
    ('${inactiveUser}', 'NK60 Inactive', false);
`);

try {
  assert.equal(
    scalar(authSql(activeUser, "authenticated", "select count(*) from public.vehicle_applications")),
    "295",
  );
  assert.equal(
    scalar(authSql(inactiveUser, "authenticated", "select count(*) from public.vehicle_applications")),
    "0",
  );
  assert.match(
    psql(authSql(activeUser, "anon", "select count(*) from public.vehicle_applications"), {
      allowFailure: true,
    }),
    /permission denied/i,
  );

  const brandId = scalar(
    "select id from public.vehicle_application_brands where slug = 'mercedes-benz'",
  );
  const codeId = scalar(
    "select id from public.commercial_configuration_codes where code = '7A'",
  );
  const invalidRestriction = psql(
    `insert into public.vehicle_applications (
      brand_id, category, vehicle_model, application_kind, source_kit_code,
      source_servo_label, commercial_configuration_code_id,
      catalog_resolution_status, observation, source_sheet, source_row, sort_order
    ) values (
      '${brandId}', 'TRUCK', 'TESTE', 'RESTRICTION', '7A', 'BR-040',
      '${codeId}', 'NOT_APPLICABLE', 'NÃO DÁ', 'TEST', 1, 1000
    )`,
    { allowFailure: true },
  );
  assert.match(invalidRestriction, /resolution_consistency_check/i);

  const invalidUnresolved = psql(
    `insert into public.vehicle_applications (
      brand_id, category, vehicle_model, application_kind, source_kit_code,
      source_servo_label, commercial_configuration_code_id,
      catalog_resolution_status, observation, source_sheet, source_row, sort_order
    ) values (
      '${brandId}', 'TRUCK', 'TESTE', 'NORMAL', '7B', 'BR-040',
      '${codeId}', 'UNRESOLVED', null, 'TEST', 2, 1001
    )`,
    { allowFailure: true },
  );
  assert.match(invalidUnresolved, /resolution_consistency_check/i);

  const duplicateSource = psql(
    `insert into public.vehicle_applications (
      brand_id, category, vehicle_model, application_kind, source_kit_code,
      source_servo_label, commercial_configuration_code_id,
      catalog_resolution_status, observation, source_sheet, source_row, sort_order
    ) select brand_id, category, 'OUTRO MODELO', application_kind, source_kit_code,
      source_servo_label, commercial_configuration_code_id,
      catalog_resolution_status, observation, source_sheet, source_row, 1002
    from public.vehicle_applications where source_sheet = 'MERCEDES-BENZ' and source_row = 51`,
    { allowFailure: true },
  );
  assert.match(duplicateSource, /source_location_key/i);
} finally {
  psql(`
    delete from public.profiles where id in ('${activeUser}', '${inactiveUser}');
    delete from auth.users where id in ('${activeUser}', '${inactiveUser}');
  `);
}

console.log("VEHICLE_APPLICATIONS_MIGRATION_LOCAL_TESTS_PASSED");
