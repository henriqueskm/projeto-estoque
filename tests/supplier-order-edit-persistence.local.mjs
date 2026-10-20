import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test, { before, beforeEach } from "node:test";

// Never connects to a URL/host or the baseline DB. Only this labelled,
// network-isolated disposable container/database can be mutated.
const container = "supabase_db_nk_issue91", database = "nk91_test";
const run = (args, input) => execFileSync("docker", args, {
  input, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  stdio: ["pipe", "pipe", "pipe"],
});
assert.equal(JSON.parse(run(["inspect", "-f", "{{json .Config.Labels}}", container]))["nk.disposable"], "nk-issue91");
assert.equal(run(["inspect", "-f", "{{.HostConfig.NetworkMode}}", container]).trim(), "none");
const sql = statement => run(["exec", "-i", container, "psql", "-U", "postgres", "-d", database,
  "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], statement).trim();
const json = statement => JSON.parse(sql(statement));
const uid = n => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uid(1), inactive = uid(2);
const item = sql("select id from public.items where item_type='SERVO' and is_active order by code limit 1");
const kit = sql("select id from public.items where item_type='INSTALLATION_KIT' and is_active order by code limit 1");
const repair = sql("select id from public.items where item_type='REPAIR_KIT' and is_active order by code limit 1");
const loose = sql("select id from public.items where item_type='LOOSE_PART' and is_active order by code limit 1");
const configuration = json("select json_build_object('id',configuration_id,'alias',min(id::text)) from public.commercial_configuration_codes where is_active group by configuration_id having count(*)>1 order by configuration_id limit 1");
const alias = sql(`select id from public.commercial_configuration_codes where is_active and configuration_id='${configuration.id}' and id<>'${configuration.alias}' order by code limit 1`);
const auth = (statement, user = actor) => sql(`begin; set local statement_timeout='6s'; set local lock_timeout='4s';
  select set_config('request.jwt.claim.sub','${user}',true); set local role authenticated; ${statement}; commit;`);
const parsed = output => JSON.parse(output.split(/\r?\n/).findLast(line => line.startsWith("{")));
const payload = lines => JSON.stringify(lines).replaceAll("'", "''");
function reset() {
  sql(`truncate public.supplier_orders, public.movement_batches cascade;
    insert into auth.users(id,aud,role,created_at,updated_at) values
      ('${actor}','authenticated','authenticated',now(),now()),('${inactive}','authenticated','authenticated',now(),now()) on conflict(id) do nothing;
    insert into public.profiles(id,name,is_active) values('${actor}','Issue91 Fixture',true),('${inactive}','Inactive Fixture',false)
      on conflict(id) do update set name=excluded.name,is_active=excluded.is_active;`);
}
function create() {
  return parsed(auth(`select public.create_supplier_order('910001','2026-10-20',null,
    '${payload([{ kind: "ITEM", item_id: item, quantity: 10 }, { kind: "ITEM", item_id: kit, quantity: 5 }])}', '${uid(10)}')`));
}
function read(order) {
  return json(`select json_build_object('header',row_to_json(o),'lines',(select json_agg(l order by l.position) from public.supplier_order_items l where l.supplier_order_id=o.id))
    from public.supplier_orders o where o.id='${order}'`);
}
function desired(order) {
  return read(order).lines.map(l => ({ id: l.id, kind: l.item_id ? "ITEM" : "COMMERCIAL_CONFIGURATION",
    ...(l.item_id ? { item_id: l.item_id } : { commercial_configuration_id: l.commercial_configuration_id, commercial_configuration_code_id: l.commercial_configuration_code_id }),
    quantity: l.ordered_quantity, notes: l.notes }));
}
const newItem = () => ({ kind: "ITEM", item_id: repair, quantity: 2, notes: "new fixture item" });
const newConfiguration = () => ({ kind: "COMMERCIAL_CONFIGURATION", commercial_configuration_id: configuration.id,
  commercial_configuration_code_id: alias, quantity: 3, notes: "alias fixture" });
function statement(order, lines, key = uid(11), version = read(order).header.updated_at, notes = null) {
  return `select public.update_supplier_order('${order}','${version}','910001','2026-10-20',${notes ? `'${notes}'` : "null"},'${payload(lines)}','${key}')`;
}
const update = (...args) => parsed(auth(statement(...args)));
const state = () => json(`select json_build_object(
  'orders',(select json_agg(o order by id) from public.supplier_orders o),
  'lines',(select json_agg(l order by id) from public.supplier_order_items l),
  'events',(select json_agg(e order by id) from public.supplier_order_events e),
  'batches',(select count(*) from public.movement_batches),'stock',(select json_agg(b order by item_id) from public.stock_balances b),
  'configStock',(select json_agg(b order by configuration_id) from public.configuration_stock_balances b),
  'bundleStock',(select json_agg(b order by bundle_id) from public.bundle_stock_balances b),
  'movements',(select count(*) from public.stock_movements),'configMovements',(select count(*) from public.configuration_stock_movements),
  'entries',(select count(*) from public.supplier_order_stock_entries))`);
function fails(action, pattern = /23514|22023/) {
  const before = state(); assert.throws(action, error => pattern.test(String(error.stderr)));
  assert.deepEqual(state(), before, "failed update must roll back header/lines/audit/stock");
}
const migration = readFileSync(new URL("../supabase/migrations/20261020132636_fix_supplier_order_edit_line_persistence.sql", import.meta.url), "utf8");
before(() => {
  // Reinstall ONLY the old private function in the disposable target to make
  // the before/after reproduction repeatable, including a fresh connection.
  const baseline = readFileSync(new URL("../supabase/baseline/current_schema.sql", import.meta.url), "utf8");
  const start = baseline.indexOf('CREATE OR REPLACE FUNCTION "private"."update_supplier_order"');
  const end = baseline.indexOf("$$;", start) + 3;
  assert.ok(start > 0 && end > start); sql(baseline.slice(start, end)); reset();
  assert.equal(sql("select md5(regexp_replace(prosrc,'\\s','','g')) from pg_proc where oid='private.update_supplier_order(uuid,timestamptz,text,date,text,jsonb,uuid,uuid,text)'::regprocedure"), "7bffbdd9664b07987b160e4feee73c10");
  const order = create().supplier_order_id;
  const broken = update(order, [...desired(order), newItem(), newConfiguration()]);
  assert.equal(broken.line_count, 2); assert.equal(read(order).lines.length, 2);
  console.log("BEFORE FIX PROVEN: deployed-equivalent writer accepted 4 lines, returned success with 2, and fresh SELECT still returned 2.");
  sql(migration);
});
beforeEach(reset);

test("add ITEM + alias configuration persists four lines after commit and fresh authenticated read", () => {
  const order = create().supplier_order_id, before = state();
  const result = update(order, [...desired(order), newItem(), newConfiguration()]);
  assert.equal(result.line_count, 4); assert.equal(result.ordered_quantity, 20);
  const after = read(order); assert.equal(after.lines.length, 4);
  assert.equal(after.lines[3].commercial_configuration_code_id, alias);
  assert.equal(after.lines[3].commercial_code_snapshot, sql(`select code from public.commercial_configuration_codes where id='${alias}'`));
  assert.equal(Number(auth(`select count(*) from public.supplier_order_items where supplier_order_id='${order}'`).split(/\r?\n/).at(-1)), 4);
  assert.equal(sql(`select count(*) from public.supplier_order_events where supplier_order_id='${order}' and event_type='ORDER_ITEMS_UPDATED'`), "1");
  const current = state();
  for (const field of ["batches", "stock", "configStock", "bundleStock", "movements", "configMovements", "entries"]) assert.deepEqual(current[field], before[field]);
});
test("mixed removal, edit quantities/notes, add several and reorder preserves exact requested identities", () => {
  const order = create().supplier_order_id, old = desired(order);
  const lines = [newConfiguration(), { ...old[0], quantity: 12, notes: "changed" }, newItem(), { ...newItem(), item_id: loose, quantity: 4 }];
  const result = update(order, lines); assert.equal(result.line_count, 4); assert.equal(result.ordered_quantity, 21);
  const saved = read(order).lines;
  assert.ok(!saved.some(l => l.id === old[1].id)); assert.equal(saved[1].id, old[0].id);
  assert.deepEqual(saved.map(l => l.ordered_quantity), [3, 12, 2, 4]); assert.equal(saved[1].notes, "changed");
  assert.deepEqual(saved.map(l => l.position), [0, 1, 2, 3]);
});
test("header-only and unchanged-line save preserve line IDs", () => {
  const order = create().supplier_order_id, lines = desired(order);
  update(order, lines, uid(11), read(order).header.updated_at, "header only");
  assert.deepEqual(desired(order), lines); assert.equal(read(order).header.notes, "header only");
  assert.equal(sql(`select count(*) from public.supplier_order_events where supplier_order_id='${order}' and event_type='ORDER_HEADER_UPDATED'`), "1");
});
test("same idempotency request replays once, changed request rejects", () => {
  const order = create().supplier_order_id, lines = [...desired(order), newItem()], version = read(order).header.updated_at;
  const result = update(order, lines, uid(11), version), after = state();
  assert.deepEqual(update(order, lines, uid(11), version), result); assert.deepEqual(state(), after);
  fails(() => update(order, [...lines, newConfiguration()], uid(11), version), /idempotency/);
});
test("stale version, invalid/inactive target and inactive profile cause no partial writes", () => {
  const order = create().supplier_order_id, lines = [...desired(order), newItem()];
  fails(() => update(order, lines, uid(11), "2000-01-01T00:00:00Z"), /40001/);
  fails(() => update(order, [...lines, { ...newItem(), item_id: uid(999) }]), /22023/);
  fails(() => parsed(auth(statement(order, lines), inactive)), /42501|28000/);
});
for (const kind of ["ready", "picked", "stocked", "cancelled", "event"]) {
  test(`${kind} existing line stays protected while new products persist`, () => {
    const order = create().supplier_order_id, existing = desired(order)[0];
    if (kind === "ready") sql(`update public.supplier_order_items set ready_quantity=3 where id='${existing.id}'`);
    if (kind === "picked") {
      // Sanitized legacy fixture: previously picked, not yet stocked.
      sql(`update public.supplier_order_items set ready_quantity=3,picked_quantity=2 where id='${existing.id}'`);
    }
    if (kind === "stocked") {
      sql(`update public.supplier_order_items set ready_quantity=3 where id='${existing.id}'`);
      const version = read(order).header.updated_at;
      auth(`select public.set_supplier_order_item_picked_quantity_checked('${existing.id}',2,null,'${version}','${uid(20)}')`);
      // Canonical atomic pickup creates stock; the EDIT must never change it.
    }
    if (kind === "cancelled") sql(`update public.supplier_order_items set cancelled_quantity=2 where id='${existing.id}'`);
    if (kind === "event") sql(`insert into public.supplier_order_events(supplier_order_id,supplier_order_item_id,event_type,user_id,user_name_snapshot,idempotency_key,previous_quantity,new_quantity,quantity_delta,details)
      values('${order}','${existing.id}','PICKED_QUANTITY_CHANGED','${actor}','Issue91 Fixture','${uid(20)}',0,0,0,'{}')`);
    const before = read(order).lines[0], stockBefore = state();
    update(order, [...desired(order), newItem(), newConfiguration()]);
    const saved = read(order).lines.find(l => l.id === existing.id);
    for (const field of ["ready_quantity", "picked_quantity", "stocked_quantity", "cancelled_quantity", "code_snapshot", "description_snapshot"]) assert.equal(saved[field], before[field]);
    const now = state(); for (const field of ["stock", "configStock", "batches", "movements", "entries"]) assert.deepEqual(now[field], stockBefore[field]);
    fails(() => update(order, desired(order).filter(l => l.id !== existing.id), uid(12)));
    fails(() => update(order, desired(order).map(l => l.id === existing.id ? { ...l, item_id: kit } : l), uid(13)));
    if (kind !== "event") fails(() => update(order, desired(order).map(l => l.id === existing.id ? { ...l, quantity: 1 } : l), uid(14)));
  });
}
test("failure in post-persistence assertion rolls back all lines/header/events", () => {
  const order = create().supplier_order_id, before = desired(order);
  sql(`create function private.nk91_discard_test_line() returns trigger language plpgsql as $$ begin
    if new.notes='discard fixture' then return null; end if; return new; end $$;
    create trigger nk91_discard_test_line before insert on public.supplier_order_items for each row execute function private.nk91_discard_test_line();`);
  try { fails(() => update(order, [...before, { ...newItem(), notes: "discard fixture" }]), /supplier_order_update_persistence_mismatch/); }
  finally { sql("drop trigger nk91_discard_test_line on public.supplier_order_items; drop function private.nk91_discard_test_line();"); }
});
test("inactive catalog target and finalized/cancelled orders reject edits atomically", () => {
  const order = create().supplier_order_id, lines = [...desired(order), newItem()];
  sql(`update public.items set is_active=false where id='${repair}'`);
  try { fails(() => update(order, lines), /inactive|22023/); }
  finally { sql(`update public.items set is_active=true where id='${repair}'`); }
  sql(`update public.supplier_orders set finalized_at=now(),finalized_by='${actor}',finalized_by_name_snapshot='Issue91 Fixture' where id='${order}'`);
  fails(() => update(order, lines), /finalized|23514|22023/);
});
test("cancelled order cannot be edited or receive added lines", () => {
  const order = create().supplier_order_id, version = read(order).header.updated_at;
  auth(`select public.cancel_supplier_order_checked('${order}','fixture cancellation','${version}','${uid(40)}')`);
  fails(() => update(order, [...desired(order), newItem()]), /cancelled|22023/);
});
test("RLS/grants/private invoker and empty search_path remain intact", () => {
  const permissions = json(`select json_build_object('definer',prosecdef,'config',proconfig,'privateClient',has_function_privilege('authenticated',oid,'execute'),
    'privateAnon',has_function_privilege('anon',oid,'execute'),'privateService',has_function_privilege('service_role',oid,'execute')) from pg_proc where oid='private.update_supplier_order(uuid,timestamptz,text,date,text,jsonb,uuid,uuid,text)'::regprocedure`);
  assert.equal(permissions.definer, false); assert.deepEqual(permissions.config, ['search_path=""']);
  assert.equal(permissions.privateClient, false); assert.equal(permissions.privateAnon, false); assert.equal(permissions.privateService, false);
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.supplier_order_items'::regclass"), "t");
});
function concurrent(statement) {
  return new Promise(resolve => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { windowsHide: true });
    let out = "", err = ""; child.stdout.on("data", c => { out += c; }); child.stderr.on("data", c => { err += c; });
    child.on("close", code => resolve({ code, out, err })); child.on("error", error => resolve({ code: -1, err: error.message }));
    child.stdin.end(`begin; set local statement_timeout='6s'; set local lock_timeout='4s'; select set_config('request.jwt.claim.sub','${actor}',true);
      set local role authenticated; ${statement}; select pg_sleep(0.2); commit;`);
  });
}
test("concurrent editors: one commit, one stale, no duplicate lines or deadlock", async () => {
  const order = create().supplier_order_id, version = read(order).header.updated_at, lines = desired(order);
  const results = await Promise.all([concurrent(statement(order, [...lines, newItem()], uid(30), version)),
    concurrent(statement(order, [...lines, newConfiguration()], uid(31), version))]);
  assert.equal(results.filter(r => r.code === 0).length, 1);
  assert.match(results.find(r => r.code !== 0).err, /40001/); assert.equal(read(order).lines.length, 3);
  assert.equal(sql(`select count(*) from public.supplier_order_events where event_type='ORDER_ITEMS_UPDATED' and supplier_order_id='${order}'`), "1");
});
test("concurrent same-key retry commits exactly once and returns the same receipt", async () => {
  const order = create().supplier_order_id, lines = [...desired(order), newItem()];
  const call = statement(order, lines, uid(30));
  const results = await Promise.all([concurrent(call), concurrent(call)]);
  assert.ok(results.every(result => result.code === 0)); assert.deepEqual(parsed(results[0].out), parsed(results[1].out));
  assert.equal(read(order).lines.length, 3);
  assert.equal(sql(`select count(*) from public.supplier_order_events where event_type='ORDER_ITEMS_UPDATED' and supplier_order_id='${order}'`), "1");
});
