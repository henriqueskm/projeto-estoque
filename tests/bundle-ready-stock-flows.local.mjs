import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const database = process.env.BUNDLE_FLOW_TEST_DB_NAME;
const container = "supabase_db_nk_current_state_baseline";
if (!database || !/^nk72_[a-z0-9_]+$/.test(database))
  throw new Error(
    "BUNDLE_FLOW_TEST_DB_NAME must be a LOCAL nk72_ disposable database; no remote target is supported.",
  );
const args = [
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
];
// Optional reproducible preparation: clone only the running LOCAL baseline into
// a new disposable database, then apply missing repository migrations. Existing
// databases are never overwritten and production credentials are never used.
if (process.env.BUNDLE_FLOW_PREPARE === "1") {
  const baselineArgs = [
    "exec",
    container,
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
  ];
  const baselineSql = (query) =>
    execFileSync("docker", [...baselineArgs, "-c", query], {
      encoding: "utf8",
    }).trim();
  assert.equal(
    baselineSql(`select count(*) from pg_database where datname='${database}'`),
    "0",
    "never overwrite an existing database",
  );
  const latest = baselineSql(
    "select max(version) from supabase_migrations.schema_migrations",
  );
  assert.match(latest, /^\d{14}$/);
  baselineSql(`create database ${database}`);
  const dump = execFileSync(
    "docker",
    [
      "exec",
      container,
      "pg_dump",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "--format=custom",
      "--no-owner",
    ],
    { maxBuffer: 100 * 1024 * 1024 },
  );
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "pg_restore",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "--no-owner",
      "--exit-on-error",
    ],
    { input: dump, stdio: ["pipe", "pipe", "pipe"] },
  );
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(migrations)
    .sort()
    .filter((file) => file.slice(0, 14) > latest && file < "20261001120000_")) {
    execFileSync("docker", ["exec", "-i", ...args.slice(1)], {
      input: readFileSync(new URL(file, migrations)),
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  console.log(`Prepared LOCAL disposable database ${database}`);
}
function sql(statement) {
  try {
    return execFileSync("docker", [...args, "-c", statement], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(error.stderr.toString(), { cause: error });
  }
}
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261001120000_bundle_ready_stock_flows.sql",
    import.meta.url,
  ),
  "utf8",
);
execFileSync("docker", ["exec", "-i", ...args.slice(1)], {
  input: migration,
  stdio: ["pipe", "pipe", "pipe"],
});
const actor = "72000000-0000-4000-9000-000000000001";
const inactive = "72000000-0000-4000-9000-000000000002";
const key = (n) => `72000000-0000-4000-9001-${String(n).padStart(12, "0")}`;
sql(`insert into auth.users(id,aud,role,created_at,updated_at) values
  ('${actor}','authenticated','authenticated',now(),now()),
  ('${inactive}','authenticated','authenticated',now(),now());
  insert into public.profiles(id,name,is_active) values ('${actor}','NK72 Test',true), ('${inactive}','NK72 Inactive',false);`);
const bundleId = sql(
  "select bundle_id from public.commercial_bundle_codes where code='1HC'",
);
const codeId = sql(
  "select id from public.commercial_bundle_codes where code='1HC'",
);
const configCodeId = sql(
  "select id from public.commercial_configuration_codes where code='1H'",
);
const configId = sql(
  "select configuration_id from public.commercial_configuration_codes where code='1H'",
);
const itemId = sql("select id from public.items where code='CIL'");
const line = (quantity = 1, bundleCode = codeId) => ({
  kind: "BUNDLE_CODE",
  bundle_code_id: bundleCode,
  quantity,
});
function auth(statement, user = actor) {
  return `begin; set local statement_timeout='10s'; set local lock_timeout='8s'; set local "request.jwt.claim.sub"='${user}'; set local role authenticated; ${statement}; commit;`;
}
function call(direction, lines, n, flag = true) {
  return `select public.${direction === "INBOUND" ? "stock_inbound_lines" : "stock_outbound_items"}('${JSON.stringify(lines)}'::jsonb,'${key(n)}',null${direction === "OUTBOUND" ? `,${flag}` : ""})`;
}
function rpc(direction, lines, n, flag) {
  const output = sql(auth(call(direction, lines, n, flag)));
  return JSON.parse(
    output.split(/\r?\n/).find((value) => value.startsWith("{")),
  );
}
function ready() {
  return Number(
    sql(
      `select coalesce((select quantity from public.bundle_stock_balances where bundle_id='${bundleId}'),0)`,
    ),
  );
}
function componentSnapshot() {
  return sql(`select jsonb_build_object(
    'items',(select jsonb_agg(to_jsonb(b) order by b.item_id) from public.stock_balances b),
    'configurations',(select jsonb_agg(to_jsonb(b) order by b.configuration_id) from public.configuration_stock_balances b),
    'assemblies',(select count(*) from public.bundle_assembly_operations))`);
}
function auditSnapshot() {
  return sql(`select jsonb_build_object('batches',(select count(*) from public.movement_batches),
    'items',(select count(*) from public.stock_movements),'configurations',(select count(*) from public.configuration_stock_movements),
    'bundles',(select count(*) from public.bundle_stock_movements),'receipts',(select count(*) from private.bundle_stock_flow_requests))`);
}
let checks = 0;
function verify(label, fn) {
  fn();
  checks++;
  console.log(`PASS ${label}`);
}
function fails(direction, lines, n, pattern, user = actor) {
  const before = auditSnapshot();
  assert.throws(() => sql(auth(call(direction, lines, n), user)), pattern);
  assert.equal(
    auditSnapshot(),
    before,
    "failure leaves no batch, movement or receipt",
  );
}
function concurrent(statement) {
  return new Promise((resolve) => {
    const child = spawn("docker", [...args, "-c", auth(statement)]);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status, output }));
  });
}
// Fixture-only stock setup, exclusively in the explicitly guarded disposable DB.
sql(`delete from public.bundle_stock_balances where bundle_id='${bundleId}'`);
const componentsBefore = componentSnapshot();
const received = rpc("INBOUND", [line(3)], 1);
verify(
  "INBOUND absent row creates only ready balance and a real receipt",
  () => {
    assert.equal(ready(), 3);
    assert.equal(received.total_quantity, 3);
    assert.equal(componentSnapshot(), componentsBefore);
    assert.equal(
      sql(
        `select movement_type from public.movement_batches where id='${received.movement_batch_id}'`,
      ),
      "INBOUND",
    );
  },
);
verify("INBOUND canonical duplicate-line replay", () => {
  assert.deepEqual(rpc("INBOUND", [line(1), line(2)], 1), received);
  assert.equal(ready(), 3);
});
verify("same key/different quantity rejected", () =>
  fails("INBOUND", [line(4)], 1, /idempotency_key/),
);
verify("same key/different operation rejected", () =>
  fails("OUTBOUND", [line(3)], 1, /idempotency_key/),
);
verify("dropping BUNDLE_CODE on replay rejected", () =>
  fails(
    "INBOUND",
    [{ kind: "ITEM", item_id: itemId, quantity: 3 }],
    1,
    /idempotency_key/,
  ),
);
const shipped = rpc("OUTBOUND", [line(2)], 2);
verify("OUTBOUND consumes only ready balance, never assembles", () => {
  assert.equal(ready(), 1);
  assert.equal(componentSnapshot(), componentsBefore);
  assert.equal(shipped.auto_assembled_quantity, 0);
  assert.equal(
    sql(
      `select movement_type from public.movement_batches where id='${shipped.movement_batch_id}'`,
    ),
    "OUTBOUND",
  );
  assert.deepEqual(rpc("OUTBOUND", [line(2)], 2), shipped);
});
verify(
  "insufficient ready stock cannot consume components/autoassemble",
  () => {
    fails("OUTBOUND", [line(2)], 3, /Insufficient stock/);
    assert.equal(ready(), 1);
    assert.equal(componentSnapshot(), componentsBefore);
  },
);
verify("mixed outbound rollback includes legacy item effects", () => {
  const before = componentSnapshot();
  // Ensure the legacy leg can execute before the bundle fails.
  sql(
    `insert into public.stock_balances(item_id,quantity) values ('${itemId}',10) on conflict(item_id) do update set quantity=10`,
  );
  const stocked = componentSnapshot();
  fails(
    "OUTBOUND",
    [{ kind: "ITEM", item_id: itemId, quantity: 1 }, line(2)],
    4,
    /Insufficient stock/,
  );
  assert.equal(componentSnapshot(), stocked);
  assert.ok(before);
});
verify("movement identity before+change=after; no assembly operations", () => {
  assert.equal(
    sql(
      `select count(*) from public.bundle_stock_movements where quantity_before+quantity_change<>quantity_after or quantity_before<0 or quantity_after<0`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `select count(*) from public.bundle_assembly_operations operation join public.movement_batches batch on batch.id=operation.batch_id where batch.user_id='${actor}'`,
    ),
    "0",
  );
});
verify("active profile/auth mandatory and failure atomic", () => {
  fails("INBOUND", [line()], 5, /active profile/i, inactive);
  assert.throws(
    () =>
      sql("set role anon; select public.stock_inbound_lines('[]',null,null)"),
    /permission denied/,
  );
});
verify("RLS, least privilege and private helpers", () => {
  assert.equal(
    sql(
      "select relrowsecurity from pg_class where oid='public.bundle_batch_lines'::regclass",
    ),
    "t",
  );
  assert.equal(
    sql(
      "select has_table_privilege('authenticated','public.bundle_batch_lines','INSERT')",
    ),
    "f",
  );
  assert.equal(
    sql(
      "select has_function_privilege('authenticated','private.stock_flow_with_ready_bundles(text,jsonb,uuid,text,boolean)','EXECUTE')",
    ),
    "f",
  );
  assert.equal(
    sql(
      "select has_function_privilege('authenticated','private.stock_inbound_lines_before_bundle_flow(jsonb,uuid,text)','EXECUTE')",
    ),
    "f",
  );
  assert.equal(
    sql(auth("select count(*) from public.bundle_batch_lines", inactive)),
    "0",
  );
});
verify("invalid lines/zero/overflow fail without movements", () => {
  fails("INBOUND", [line(0)], 6, /positive integer/);
  fails(
    "INBOUND",
    [{ ...line(), item_id: itemId }],
    7,
    /Invalid stock flow target/,
  );
  fails("INBOUND", [line(2147483647)], 8, /integer range/);
  assert.equal(ready(), 1);
});
const aliasId = "72000000-0000-4000-9002-000000000001";
sql(
  `insert into public.commercial_bundle_codes(id,bundle_id,code,is_active) values ('${aliasId}','${bundleId}','NK72-ALIAS',true)`,
);
verify(
  "aliases share a single ready balance; insufficient aggregate fails",
  () => {
    fails("OUTBOUND", [line(), line(1, aliasId)], 9, /Insufficient stock/);
    const result = rpc("INBOUND", [line(), line(2, aliasId)], 10);
    assert.equal(ready(), 4);
    assert.equal(result.lines_processed, 2);
    assert.equal(
      sql(
        `select count(*) from public.bundle_stock_movements where batch_id='${result.movement_batch_id}'`,
      ),
      "1",
    );
  },
);
verify("mixed successful INBOUND and OUTBOUND use one real batch", () => {
  const input = [{ kind: "ITEM", item_id: itemId, quantity: 2 }, line()];
  const result = rpc("INBOUND", input, 11);
  assert.equal(result.total_quantity, 3);
  assert.equal(result.lines_processed, 2);
  assert.deepEqual(rpc("INBOUND", [...input].reverse(), 11), result);
  assert.equal(
    sql(
      `select count(*) from public.stock_movements where batch_id='${result.movement_batch_id}'`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from public.bundle_stock_movements where batch_id='${result.movement_batch_id}'`,
    ),
    "1",
  );
  assert.equal(rpc("OUTBOUND", input, 12).auto_assembled_quantity, 0);
});
verify(
  "historical three-argument OUTBOUND API reaches the bundle extension",
  () => {
    const before = ready();
    sql(
      auth(
        `select public.stock_outbound_items('${JSON.stringify([line()])}'::jsonb,'${key(23)}',null)`,
      ),
    );
    assert.equal(ready(), before - 1);
  },
);
sql(
  `update public.bundle_stock_balances set quantity=1 where bundle_id='${bundleId}'`,
);
const finalUnit = await Promise.all([
  concurrent(call("OUTBOUND", [line()], 13)),
  concurrent(call("OUTBOUND", [line()], 14)),
]);
verify(
  "real concurrent last-unit withdrawals: one success, no negative balance/deadlock",
  () => {
    assert.equal(finalUnit.filter((result) => result.status === 0).length, 1);
    assert.match(
      finalUnit.find((result) => result.status !== 0).output,
      /Insufficient stock/,
    );
    assert.equal(ready(), 0);
  },
);
sql(`delete from public.bundle_stock_balances where bundle_id='${bundleId}'`);
verify("absent outbound row is zero and failure creates no row", () => {
  fails("OUTBOUND", [line()], 15, /Insufficient stock/);
  assert.equal(
    sql(
      `select count(*) from public.bundle_stock_balances where bundle_id='${bundleId}'`,
    ),
    "0",
  );
});
const sameKey = await Promise.all([
  concurrent(call("INBOUND", [line(2)], 16)),
  concurrent(call("INBOUND", [line(), line()], 16)),
]);
verify("concurrent same-key replay moves stock once", () => {
  assert.ok(
    sameKey.every((result) => result.status === 0),
    JSON.stringify(sameKey),
  );
  assert.equal(ready(), 2);
});
verify(
  "no-op absolute adjustment reserves key without fictitious movement",
  () => {
    sql(
      auth(
        `select public.adjust_commercial_bundle_stock_checked('${bundleId}',2,2,'no change','${key(17)}')`,
      ),
    );
    fails("INBOUND", [line()], 17, /idempotency_key/);
  },
);
verify(
  "metadata deactivation cannot prevent immutable completed replay",
  () => {
    sql(
      `update public.commercial_bundles set is_active=false where id='${bundleId}'`,
    );
    assert.deepEqual(rpc("INBOUND", [line(3)], 1), received);
    fails("INBOUND", [line()], 18, /inactive/);
    sql(
      `update public.commercial_bundles set is_active=true where id='${bundleId}'`,
    );
  },
);
// Supply free components to exercise overlap with explicit assembly and legacy
// configuration shipment, not an implicit assembly path in the new writers.
sql(`insert into public.configuration_stock_balances(configuration_id,quantity) values ('${configId}',1)
  on conflict(configuration_id) do update set quantity=1;
  insert into public.stock_balances(item_id,quantity) select item_id,5 from public.commercial_bundle_components
  where bundle_id='${bundleId}' and item_id is not null on conflict(item_id) do update set quantity=5;`);
const competing = await Promise.all([
  concurrent(
    `select public.assemble_commercial_bundle('1HC',1,'${key(19)}',null)`,
  ),
  concurrent(
    call(
      "OUTBOUND",
      [
        {
          kind: "COMMERCIAL_CODE",
          commercial_code_id: configCodeId,
          quantity: 1,
        },
      ],
      20,
      false,
    ),
  ),
]);
verify(
  "explicit assembly vs legacy 1H shipment competes safely for last free configuration",
  () => {
    assert.equal(
      competing.filter((result) => result.status === 0).length,
      1,
      JSON.stringify(competing),
    );
    assert.ok(
      competing.every(
        (result) =>
          !/deadlock|lock timeout|statement timeout/i.test(result.output),
      ),
      JSON.stringify(competing),
    );
    assert.equal(
      sql(
        `select quantity from public.configuration_stock_balances where configuration_id='${configId}'`,
      ),
      "0",
    );
  },
);
const overlapping = await Promise.all([
  concurrent(call("OUTBOUND", [line()], 21)),
  concurrent(
    `select public.disassemble_commercial_bundle('1HC',1,'${key(22)}',null)`,
  ),
]);
verify("explicit disassembly vs ready withdrawal preserves lock order", () => {
  assert.ok(
    overlapping.every((result) => result.status === 0),
    JSON.stringify(overlapping),
  );
  assert.ok(ready() >= 0);
});
verify(
  "legacy configurations preserved and checked no-auto-assembly policy intact",
  () => {
    assert.equal(
      sql("select count(*) from public.commercial_configurations"),
      "80",
    );
    assert.equal(
      sql(
        "select count(*) from public.bundle_stock_movements where quantity_before+quantity_change<>quantity_after",
      ),
      "0",
    );
  },
);
console.log(
  `LOCAL/DISPOSABLE ONLY: ${checks} checks passed; ${database}. No remote operation.`,
);
