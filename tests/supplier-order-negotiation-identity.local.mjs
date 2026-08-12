import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = resolve(
  repositoryRoot,
  "supabase",
  "migrations",
  "20260812133046_enforce_supplier_order_negotiation_identity.sql",
);
const container = process.env.NEGOTIATION_IDENTITY_TEST_DB_CONTAINER
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
const userId = "20000000-0000-4000-8000-000000000001";
const itemId = "d9bfc725-87a3-4194-8f51-bdc49d95bd8c";
const migrationContainerPath = "/tmp/20260812133046_enforce_supplier_order_negotiation_identity.sql";
const legacy = [
  ["26e08e22-a2fb-4e8d-8605-4ccdb57d4773", "teste 00", "99990000", true],
  ["db02621b-b6c1-4e7a-8fef-b63fc3e60d50", "teste 01", "99990001", false],
  ["e92bc06f-5721-4082-b77a-def6954e3300", "teste 03", "99990003", true],
  ["af7a39f6-c4a2-4e92-b183-d8196aa775d1", "Teste 04", "99990004", false],
];

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

function psqlFile({ allowFailure = false } = {}) {
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
        "-f",
        migrationContainerPath,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
    if (allowFailure) return output;
    throw new Error(output, { cause: error });
  }
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

function asAuthenticated(statement, options) {
  return psql(authSql(statement), options);
}

function concurrent(statement) {
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
        authSql(statement),
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

function scalar(sql) {
  return psql(sql).split(/\r?\n/).at(-1);
}

function createCall(negotiation, key, quantity = 1) {
  return `select public.create_supplier_order(
    '${negotiation}',
    current_date,
    null,
    jsonb_build_array(jsonb_build_object(
      'kind', 'ITEM',
      'item_id', '${itemId}',
      'quantity', ${quantity}
    )),
    '${key}'::uuid
  )`;
}

console.log("ALVO CONFIRMADO: SUPABASE LOCAL DESCARTÁVEL");
assert.equal(
  scalar("select exists(select 1 from supabase_migrations.schema_migrations where version = '20260812023500')"),
  "t",
);
assert.equal(
  scalar("select exists(select 1 from supabase_migrations.schema_migrations where version = '20260812133046')"),
  "f",
);

execFileSync(docker, ["cp", migrationPath, `${container}:${migrationContainerPath}`]);

psql(`
  truncate table
    public.safisa_portal_events,
    public.safisa_order_authorizations,
    public.safisa_portal_members,
    public.supplier_order_events,
    public.supplier_order_items,
    public.supplier_orders
  cascade;
  delete from auth.users where id = '${userId}';
  insert into auth.users (id, aud, role, created_at, updated_at)
  values ('${userId}', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, name, is_active)
  values ('${userId}', 'Internal Local', true);

  ${legacy.map(([id, negotiation, , finalized]) => `
    insert into public.supplier_orders (
      id, negotiation_number, order_date, notes, created_by,
      created_by_name_snapshot, finalized_at, finalized_by,
      finalized_by_name_snapshot, finalization_note
    ) values (
      '${id}', '${negotiation}', date '2026-07-24', 'Legacy fixture',
      '${userId}', 'Internal Local',
      ${finalized ? "timestamptz '2026-08-01 12:00:00+00'" : "null"},
      ${finalized ? `'${userId}'` : "null"},
      ${finalized ? "'Internal Local'" : "null"},
      ${finalized ? "'Legacy fixture finalized'" : "null"}
    );
  `).join("\n")}

  ${legacy.map(([id], index) => `
    insert into public.supplier_order_items (
      id, supplier_order_id, item_id, code_snapshot, description_snapshot,
      model_snapshot, item_type_snapshot, ordered_quantity, ready_quantity,
      picked_quantity, stocked_quantity, cancelled_quantity, position
    ) values (
      '21000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}',
      '${id}', '${itemId}', '1', 'SERVO MBF-015', 'MBF-015', 'SERVO',
      ${5 + index}, ${index}, ${index}, 0, 0, 0
    );
  `).join("\n")}

  ${legacy.map(([id, negotiation], index) => `
    insert into public.supplier_order_events (
      supplier_order_id, event_type, user_id, user_name_snapshot,
      idempotency_key, details
    ) values (
      '${id}', 'ORDER_CREATED', '${userId}', 'Internal Local',
      '22000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}',
      jsonb_build_object(
        'request', jsonb_build_object('negotiation_number', '${negotiation}'),
        'result', jsonb_build_object('negotiation_number', '${negotiation}')
      )
    );
  `).join("\n")}

  insert into public.safisa_order_authorizations (
    supplier_order_id, is_authorized, published_at, published_by,
    published_by_name_snapshot
  ) values (
    '${legacy[1][0]}', true, now(), '${userId}', 'Internal Local'
  );
`);

const preservedBefore = scalar(`
  select md5(jsonb_build_object(
    'orders', (
      select jsonb_agg(to_jsonb(o) - 'negotiation_number' - 'updated_at' order by id)
      from public.supplier_orders o
    ),
    'items', (
      select jsonb_agg(to_jsonb(i) order by id)
      from public.supplier_order_items i
    ),
    'authorization', (
      select jsonb_agg(to_jsonb(a) order by supplier_order_id)
      from public.safisa_order_authorizations a
    )
  )::text)
`);
const eventCountBefore = Number(scalar("select count(*) from public.supplier_order_events"));

// A mismatched fourth precondition fails after earlier logical loop steps. The
// explicit transaction and DO statement must leave no partial update or event.
psql(`update public.supplier_orders set negotiation_number = 'Unexpected' where id = '${legacy[3][0]}'`);
const rollbackFailure = psqlFile({ allowFailure: true });
assert.match(rollbackFailure, /does not have the approved identity/i);
assert.equal(
  scalar("select string_agg(negotiation_number, '|' order by id) from public.supplier_orders"),
  "teste 00|Unexpected|teste 01|teste 03",
);
assert.equal(Number(scalar("select count(*) from public.supplier_order_events")), eventCountBefore);
assert.equal(
  scalar("select to_regclass('public.supplier_orders_negotiation_number_key') is null"),
  "t",
);
psql(`update public.supplier_orders set negotiation_number = 'Teste 04' where id = '${legacy[3][0]}'`);

psqlFile();

assert.equal(
  scalar("select string_agg(negotiation_number, '|' order by id) from public.supplier_orders"),
  "99990000|99990004|99990001|99990003",
);
assert.equal(
  scalar("select count(*) = 4 from public.supplier_orders where negotiation_number ~ '^[0-9]+$'"),
  "t",
);
assert.equal(
  scalar("select count(*) from public.supplier_order_events where user_id is null and user_name_snapshot = 'MIG-ORD-008A'"),
  "4",
);
assert.equal(
  scalar("select count(*) from public.supplier_order_events where details #>> '{reason}' = 'legacy_negotiation_identity_migration'"),
  "4",
);
assert.equal(
  scalar("select count(*) from public.supplier_order_events where details #>> '{request,negotiation_number}' in ('teste 00','teste 01','teste 03','Teste 04')"),
  "4",
);
assert.equal(scalar("select to_regclass('public.supplier_orders_negotiation_number_idx') is null"), "t");
assert.equal(scalar("select to_regclass('public.supplier_orders_negotiation_number_key') is not null"), "t");
assert.equal(scalar("select pg_typeof(negotiation_number)::text from public.supplier_orders limit 1"), "text");
assert.equal(scalar("select count(*) from public.supplier_order_items"), "4");
assert.equal(scalar("select count(*) from public.safisa_order_authorizations"), "1");
assert.equal(scalar("select md5(jsonb_build_object('orders', (select jsonb_agg(to_jsonb(o) - 'negotiation_number' - 'updated_at' order by id) from public.supplier_orders o), 'items', (select jsonb_agg(to_jsonb(i) order by id) from public.supplier_order_items i), 'authorization', (select jsonb_agg(to_jsonb(a) order by supplier_order_id) from public.safisa_order_authorizations a))::text)"), preservedBefore);

const createKeys = {
  twelve: "23000000-0000-4000-8000-000000000001",
  zeroTwelve: "23000000-0000-4000-8000-000000000002",
  duplicate: "23000000-0000-4000-8000-000000000003",
  cancelled: "23000000-0000-4000-8000-000000000004",
  cancelledDuplicate: "23000000-0000-4000-8000-000000000005",
  finalized: "23000000-0000-4000-8000-000000000006",
  finalizedDuplicate: "23000000-0000-4000-8000-000000000007",
  raceA: "23000000-0000-4000-8000-000000000008",
  raceB: "23000000-0000-4000-8000-000000000009",
};

const firstCreate = asAuthenticated(createCall("1212", createKeys.twelve));
const replayCreate = asAuthenticated(createCall("1212", createKeys.twelve));
assert.equal(
  JSON.parse(firstCreate.split(/\r?\n/).findLast((line) => line.startsWith("{"))).supplier_order_id,
  JSON.parse(replayCreate.split(/\r?\n/).findLast((line) => line.startsWith("{"))).supplier_order_id,
);
asAuthenticated(createCall("001212", createKeys.zeroTwelve));
assert.equal(
  scalar("select count(*) from public.supplier_orders where negotiation_number in ('1212','001212')"),
  "2",
);

for (const invalid of ["ABC123", "12 12", "12-12", "12/12", "   "]) {
  assert.match(
    asAuthenticated(
      createCall(invalid, crypto.randomUUID()),
      { allowFailure: true },
    ),
    /must contain only digits 0-9/i,
  );
}

assert.match(
  asAuthenticated(createCall("1212", createKeys.duplicate), { allowFailure: true }),
  /supplier order negotiation already exists/i,
);
assert.match(
  asAuthenticated(createCall("1212", createKeys.twelve, 2), { allowFailure: true }),
  /idempotency/i,
);

const cancelledResult = asAuthenticated(createCall("777", createKeys.cancelled));
const cancelledId = JSON.parse(cancelledResult.split(/\r?\n/).findLast((line) => line.startsWith("{"))).supplier_order_id;
psql(`update public.supplier_orders set cancelled_at = now(), cancelled_by = '${userId}', cancelled_by_name_snapshot = 'Internal Local' where id = '${cancelledId}'`);
assert.match(
  asAuthenticated(createCall("777", createKeys.cancelledDuplicate), { allowFailure: true }),
  /supplier order negotiation already exists/i,
);

const finalizedResult = asAuthenticated(createCall("888", createKeys.finalized));
const finalizedId = JSON.parse(finalizedResult.split(/\r?\n/).findLast((line) => line.startsWith("{"))).supplier_order_id;
psql(`update public.supplier_orders set finalized_at = now(), finalized_by = '${userId}', finalized_by_name_snapshot = 'Internal Local' where id = '${finalizedId}'`);
assert.match(
  asAuthenticated(createCall("888", createKeys.finalizedDuplicate), { allowFailure: true }),
  /supplier order negotiation already exists/i,
);

assert.match(
  psql("update public.supplier_orders set negotiation_number = 'ABC123' where negotiation_number = '1212'", { allowFailure: true }),
  /supplier_orders_negotiation_number_check/i,
);
assert.match(
  psql("update public.supplier_orders set negotiation_number = '001212' where negotiation_number = '1212'", { allowFailure: true }),
  /supplier_orders_negotiation_number_key/i,
);

const raceResults = await Promise.allSettled([
  concurrent(createCall("54821", createKeys.raceA)),
  concurrent(createCall("54821", createKeys.raceB)),
]);
assert.equal(raceResults.filter(({ status }) => status === "fulfilled").length, 1);
assert.equal(raceResults.filter(({ status }) => status === "rejected").length, 1);
assert.match(
  raceResults.find(({ status }) => status === "rejected").reason.message,
  /supplier order negotiation already exists/i,
);
assert.equal(scalar("select count(*) from public.supplier_orders where negotiation_number = '54821'"), "1");

console.log("MIG-ORD-008A LOCAL CONTRACT VERIFIED");
