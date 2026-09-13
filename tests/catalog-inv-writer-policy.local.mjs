import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const container = process.env.CATALOG_INV_TEST_DB_CONTAINER
  ?? "supabase_db_nk_current_state_baseline";
const database = process.env.CATALOG_INV_TEST_DB_NAME ?? "postgres";
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
      where code like '8056%' or code like 'NK56-%'
    );
    delete from public.stock_balances
    where item_id in (
      select id from public.items
      where code like '8056%' or code like 'NK56-%'
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
      where code like '8056%' or code like 'NK56-%'
    );
    delete from public.items
    where code like '8056%' or code like 'NK56-%';
    delete from public.profiles where id in ('${firstUser}', '${secondUser}');
    delete from auth.users where id in ('${firstUser}', '${secondUser}');
  `);
}

assert.equal(
  scalar(`select
    to_regprocedure('private.catalog_code_write_policy(text)') is not null
    and to_regprocedure('private.catalog_codes_conflict(text,text)') is not null`),
  "t",
);
console.log("ALVO CONFIRMADO: POSTGRESQL LOCAL/DESCARTAVEL COM MIGRATION NK56");

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
