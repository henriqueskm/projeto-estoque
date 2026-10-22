import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test, { beforeEach } from "node:test";

const container = "supabase_db_nk_issue95", database = "nk95_test";
const run = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
assert.equal(JSON.parse(run(["inspect", "-f", "{{json .Config.Labels}}", container]))["nk.disposable"], "nk-issue95");
assert.equal(run(["inspect", "-f", "{{.HostConfig.NetworkMode}}", container]).trim(), "none");
const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const sql = statement => run(args, statement).trim();
const json = statement => JSON.parse(sql(statement));
const actor = "95000000-0000-4000-8000-000000000001", inactive = "95000000-0000-4000-8000-000000000002";
const quote = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const parsed = output => JSON.parse(output.split(/\r?\n/).findLast(line => line.startsWith("{")));
const authSql = (statement, user = actor, hold = false) => `begin; set local statement_timeout='6s'; set local lock_timeout='4s'; select set_config('request.jwt.claim.sub','${user}',true); set local role authenticated; ${statement}; ${hold ? "select 'HELD'; select pg_sleep(1);" : ""} commit;`;
const auth = (statement, user) => sql(authSql(statement, user));
const statement = (request, key = randomUUID()) => `select public.manage_physical_catalog(${quote(request)},'${key}')`;
const manage = (request, key, user) => parsed(auth(statement(request, key), user));
const preview = id => parsed(auth(`select public.get_physical_catalog_item_preview('${id}')`));
const create = (type = "LOOSE_PART", code = "NK95-PART", extra = {}) => manage({ operation: "CREATE", itemType: type, code, description: `Fixture ${type}`, reason: "Cadastro de teste isolado", ...(type === "SERVO" ? { model: "NK95-MODEL" } : {}), ...extra }).item;
const archive = p => ({ operation: "ARCHIVE", itemId: p.id, expectedVersion: p.version, expectedQuantity: p.quantity, reason: "Cadastro incorreto" });
const inbound = (id, quantity = 15) => `select public.stock_inbound_lines(${quote([{ kind: "ITEM", item_id: id, quantity }])},'${randomUUID()}',null)`;
const funded = () => { const p = create(); auth(inbound(p.id)); return preview(p.id); };
const state = () => json(`select jsonb_build_object(
  'items',(select jsonb_agg(i order by id) from public.items i),
  'balances',(select jsonb_agg(b order by item_id) from public.stock_balances b),
  'movements',(select jsonb_agg(m order by id) from public.stock_movements m),
  'batches',(select jsonb_agg(b order by id) from public.movement_batches b),
  'audit',(select jsonb_agg(r order by id) from private.physical_catalog_requests r),
  'adjustments',(select jsonb_agg(r order by id) from private.stock_adjustment_requests r),
  'orders',(select jsonb_agg(o order by id) from public.supplier_order_items o))`);
function rejects(action, pattern) { const prior = state(); assert.throws(action, e => pattern.test(String(e.stderr))); assert.deepEqual(state(), prior); }
function transaction(statement, hold = false) {
  const child = spawn("docker", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", heldResolve;
  const held = new Promise(resolve => { heldResolve = resolve; });
  const done = new Promise(resolve => {
    child.stdout.on("data", data => { stdout += data; if (stdout.includes("HELD")) heldResolve(); });
    child.stderr.on("data", data => { stderr += data; });
    child.on("close", code => { heldResolve(); resolve({ code, stdout, stderr }); });
    child.on("error", e => { heldResolve(); resolve({ code: -1, stdout, stderr: String(e) }); });
  });
  child.stdin.end(authSql(statement, actor, hold)); return { held, done };
}
beforeEach(() => {
  sql(`truncate public.items,public.commercial_bundles,public.supplier_orders,public.movement_batches,private.physical_catalog_requests cascade;
    insert into auth.users(id,aud,role,created_at,updated_at) values('${actor}','authenticated','authenticated',now(),now()),('${inactive}','authenticated','authenticated',now(),now()) on conflict(id) do nothing;
    insert into public.profiles(id,name,is_active) values('${actor}','Fixture Catálogo 95',true),('${inactive}','Inativo',false) on conflict(id) do update set name=excluded.name,is_active=excluded.is_active;`);
});
for (const type of ["SERVO", "INSTALLATION_KIT", "REPAIR_KIT", "LOOSE_PART"]) test(`${type}: correct subtype, no balance/batch/movement, idempotent create`, () => {
  const key = randomUUID(), request = { operation: "CREATE", itemType: type, code: "NK95-CREATE", description: "Produto novo", reason: "Cadastro", ...(type === "SERVO" ? { model: "MBF-FIXTURE" } : {}) };
  const result = manage(request, key), saved = state();
  const table = { SERVO: "servo_models", INSTALLATION_KIT: "installation_kits", REPAIR_KIT: "repair_kits", LOOSE_PART: "loose_parts" }[type];
  assert.equal(sql(`select count(*) from public.${table} where item_id='${result.item.id}'`), "1");
  assert.equal(result.item.quantity, 0); assert.equal(saved.balances, null); assert.equal(saved.batches, null);
  assert.equal(manage(request, key).idempotentReplay, true); assert.deepEqual(state(), saved);
  rejects(() => manage({ ...request, description: "Different" }, key), /22023.*|catalog_idempotency_conflict/);
});
test("repair compatibility is explicit and validated; model/category immutable", () => {
  const servo = create("SERVO", "NK95-SERVO"), repair = create("REPAIR_KIT", "NK95-REPAIR", { compatibleServoIds: [servo.id] });
  assert.equal(preview(repair.id).dependencies.compatibilities, 1);
  rejects(() => manage(archive(preview(servo.id))), /catalog_item_has_dependencies/);
  rejects(() => create("LOOSE_PART", "NK95-X", { compatibleServoIds: [servo.id] }), /catalog_invalid_compatibilities/);
  rejects(() => manage({ operation: "EDIT", itemId: servo.id, expectedVersion: servo.version, itemType: "LOOSE_PART", code: "NK95-S", description: "Changed", reason: "Edit" }), /catalog_identity_is_immutable/);
});
test("edit code/description preserves subtype, IDs, model, stock and historical order snapshots", () => {
  const p = create("SERVO"); auth(inbound(p.id));
  const order = parsed(auth(`select public.create_supplier_order('95001','2026-10-22',null,${quote([{ kind: "ITEM", item_id: p.id, quantity: 1 }])},'${randomUUID()}')`));
  const old = preview(p.id), before = state();
  const result = manage({ operation: "EDIT", itemId: p.id, expectedVersion: old.version, code: "NK95-RENAMED", description: "Descrição corrigida", reason: "Corrigir cadastro" });
  assert.equal(result.item.id, p.id); assert.equal(result.item.model, p.model); assert.equal(result.item.quantity, 15);
  for (const key of ["batches", "movements", "balances", "orders"]) assert.deepEqual(state()[key], before[key]);
  assert.equal(sql(`select code_snapshot from public.supplier_order_items where supplier_order_id='${order.supplier_order_id}'`), p.code);
  assert.equal(sql(`select before_snapshot->>'code' from private.physical_catalog_requests where request->>'operation'='EDIT'`), p.code);
});
test("archive with stock uses one real ADJUSTMENT then inactivates; history and receipts immutable", () => {
  const p = funded(), before = state(), key = randomUUID();
  const result = manage(archive(p), key); assert.equal(result.item.isActive, false); assert.equal(result.item.quantity, 0);
  assert.equal(sql("select count(*) from public.stock_movements"), "2");
  assert.equal(sql("select movement_type from public.movement_batches order by created_at desc limit 1"), "ADJUSTMENT");
  assert.equal(sql("select count(*) from public.stock_movements where quantity_before + quantity_change <> quantity_after or quantity_after < 0"), "0");
  assert.equal(sql(`select count(*) from public.loose_parts where item_id='${p.id}'`), "1");
  assert.equal(before.movements[0].id, state().movements.find(m => m.quantity_change === 15).id);
  assert.equal(sql(`select count(*) from public.items where id='${p.id}' and is_active`), "0");
  assert.equal(preview(p.id).isActive, false); const saved = state();
  assert.equal(manage(archive(p), key).idempotentReplay, true); assert.deepEqual(state(), saved);
  rejects(() => sql("update private.physical_catalog_requests set request='{}'"), /immutable/);
});
test("zero balance with prior movement archives without an empty adjustment batch/request", () => {
  const p = funded(); auth(`select public.adjust_item_stock_checked('${p.id}',0,15,'Contagem teste','${randomUUID()}')`);
  const before = state(); manage(archive(preview(p.id))); const after = state();
  for (const key of ["batches", "movements", "adjustments"]) assert.deepEqual(after[key], before[key]);
});
test("absent balance archives safely without fake movement", () => {
  const p = create(); manage(archive(p)); assert.equal(state().movements, null); assert.equal(state().batches, null); assert.equal(state().adjustments, null);
});
for (const type of ["SERVO", "INSTALLATION_KIT", "REPAIR_KIT"]) test(`${type}: independent physical stock archives with canonical correction, no subtype deletion`, () => {
  const p = create(type); auth(inbound(p.id, 3));
  const result = manage(archive(preview(p.id)));
  assert.equal(result.item.quantity, 0); assert.equal(result.item.isActive, false);
  assert.equal(sql("select quantity_change from public.stock_movements where quantity_change < 0"), "-3");
  assert.equal(sql(`select count(*) from public.items where id='${p.id}'`), "1");
});
test("stale stock, ABA quantity, and metadata changes reject before any effects", () => {
  const p = funded(); auth(inbound(p.id, 1)); rejects(() => manage(archive(p)), /40001/);
  auth(`select public.adjust_item_stock_checked('${p.id}',15,16,'Restaurar fixture','${randomUUID()}')`);
  rejects(() => manage(archive(p)), /40001/);
  const fresh = preview(p.id); manage({ operation: "EDIT", itemId: p.id, expectedVersion: fresh.version, code: "NK95-NEW", description: "Changed", reason: "Edit" });
  rejects(() => manage(archive(fresh)), /40001/);
});
test("active order and finalized order with pending stock block archive; historical refs remain", () => {
  const p = funded();
  const order = parsed(auth(`select public.create_supplier_order('95002','2026-10-22',null,${quote([{ kind: "ITEM", item_id: p.id, quantity: 1 }])},'${randomUUID()}')`));
  rejects(() => manage(archive(preview(p.id))), /catalog_item_has_dependencies/);
  sql(`update public.supplier_order_items set ready_quantity=1,picked_quantity=1 where supplier_order_id='${order.supplier_order_id}'; update public.supplier_orders set finalized_at=now(),finalized_by='${actor}',finalized_by_name_snapshot='Fixture' where id='${order.supplier_order_id}'`);
  rejects(() => manage(archive(preview(p.id))), /catalog_item_has_dependencies/);
  const line = sql(`select id from public.supplier_order_items where supplier_order_id='${order.supplier_order_id}'`);
  const version = sql(`select updated_at from public.supplier_orders where id='${order.supplier_order_id}'`);
  auth(`select public.create_supplier_order_stock_entry('${order.supplier_order_id}',${quote([{ supplier_order_item_id: line, quantity: 1 }])},null,'${version}','${randomUUID()}')`);
  manage(archive(preview(p.id))); assert.equal(sql(`select count(*) from public.supplier_order_items where item_id='${p.id}'`), "1");
});
test("configuration and bundle recipe dependencies block even with zero composed balance", () => {
  const servo = create("SERVO", "NK95-S"), kit = create("INSTALLATION_KIT", "NK95-K");
  sql(`insert into public.commercial_configurations(servo_id,installation_kit_id,description) values('${servo.id}','${kit.id}','Fixture')`);
  rejects(() => manage(archive(preview(servo.id))), /catalog_item_has_dependencies/);
  rejects(() => manage(archive(preview(kit.id))), /catalog_item_has_dependencies/);
  const p = create(); sql(`begin; insert into public.commercial_bundles(description) values('Fixture'); insert into public.commercial_bundle_components(bundle_id,item_id,quantity_per_bundle) select id,'${p.id}',1 from public.commercial_bundles where description='Fixture'; commit;`);
  rejects(() => manage(archive(preview(p.id))), /catalog_item_has_dependencies/);
});
test("forced failure after stock correction rolls back balance, adjustment/audit and archive", () => {
  const p = funded();
  sql(`create function public.nk95_fail_archive() returns trigger language plpgsql as $$begin if not new.is_active then raise exception 'forced_archive_failure'; end if; return new; end$$; create trigger nk95_fail_archive before update of is_active on public.items for each row execute function public.nk95_fail_archive();`);
  try { rejects(() => manage(archive(p)), /forced_archive_failure/); }
  finally { sql("drop trigger nk95_fail_archive on public.items; drop function public.nk95_fail_archive()"); }
});
test("RLS/grants: anon/inactive/profile without name/direct writes denied; audit attributed server-side", () => {
  const p = create();
  rejects(() => manage(archive(p), randomUUID(), inactive), /42501/);
  rejects(() => sql(`set role anon; select public.get_physical_catalog_item_preview('${p.id}')`), /42501/);
  rejects(() => auth("select * from private.physical_catalog_requests"), /42501/);
  rejects(() => auth(`update public.items set is_active=false where id='${p.id}'`), /42501/);
  rejects(() => auth("truncate public.items cascade"), /42501/);
  sql(`update public.profiles set name='' where id='${actor}'`);
  rejects(() => manage(archive(p)), /42501/); sql(`update public.profiles set name='Fixture Catálogo 95' where id='${actor}'`);
  assert.equal(sql(`select user_id::text || ':' || user_name_snapshot from private.physical_catalog_requests limit 1`), `${actor}:Fixture Catálogo 95`);
  assert.equal(sql("select relrowsecurity from pg_class where oid='private.physical_catalog_requests'::regclass"), "t");
});
test("namespace: casing/INV/configuration and bundle codes collide; inactive code not reused", () => {
  const p = create(); rejects(() => create("LOOSE_PART", "nk95-part"), /conflicts/);
  create("LOOSE_PART", "95INV2"); rejects(() => create("LOOSE_PART", "95-INV"), /conflicts/);
  rejects(() => create("LOOSE_PART", "95 INV"), /unsupported/);
  sql("insert into public.commercial_bundles(description,is_active) values('Code fixture',false); insert into public.commercial_bundle_codes(bundle_id,code) select id,'NK95-B' from public.commercial_bundles where description='Code fixture'");
  rejects(() => create("LOOSE_PART", "NK95-B"), /conflicts/);
  manage(archive(p)); rejects(() => create("LOOSE_PART", p.code), /conflicts/);
});
test("configuration alias collision and edit conflict never change stock/audit", () => {
  const servo = create("SERVO", "NK95-S"), kit = create("INSTALLATION_KIT", "NK95-K"), p = create();
  sql(`insert into public.commercial_configurations(servo_id,installation_kit_id,description) values('${servo.id}','${kit.id}','Fixture');
    insert into public.commercial_configuration_codes(configuration_id,code) select id,'NK95-ALIAS' from public.commercial_configurations where servo_id='${servo.id}'`);
  rejects(() => create("LOOSE_PART", "nk95-alias"), /conflicts/);
  rejects(() => manage({ operation: "EDIT", itemId: p.id, expectedVersion: p.version, code: "NK95-ALIAS", description: "Conflict", reason: "Edit" }), /conflicts/);
});
test("retired positive balance guard covers checked adjustment and legacy inbound", () => {
  const p = funded(); manage(archive(p));
  rejects(() => auth(`select public.adjust_item_stock_checked('${p.id}',1,0,'Não reativar','${randomUUID()}')`), /catalog_item_inactive/);
  rejects(() => auth(`select public.stock_inbound_item('${p.id}',1,'MANUAL','Legacy')`), /inactive/);
});
test("concurrent same-key archive: one adjustment and immutable receipt replay", async () => {
  const p = funded(), key = randomUUID(), stmt = statement(archive(p), key);
  const first = transaction(stmt, true); await first.held;
  const second = transaction(stmt); const results = await Promise.all([first.done, second.done]);
  results.forEach(r => assert.equal(r.code, 0, r.stderr));
  assert.equal(parsed(results[1].stdout).idempotentReplay, true); assert.equal(sql("select count(*) from public.stock_movements"), "2");
});
for (const competitor of ["inbound", "outbound", "adjustment", "order", "legacyInbound"]) {
  for (const winner of ["archive", "competitor"]) test(`concurrent archive vs ${competitor}, ${winner} wins: safe serialization, no deadlock/partial write`, async () => {
    const p = funded();
    const competing = { inbound: inbound(p.id, 1),
      outbound: `select public.stock_outbound_items(${quote([{ kind: "ITEM", item_id: p.id, quantity: 1 }])},'${randomUUID()}',null,false)`,
      adjustment: `select public.adjust_item_stock_checked('${p.id}',16,15,'Concurrent count','${randomUUID()}')`,
      order: `select public.create_supplier_order('95003','2026-10-22',null,${quote([{ kind: "ITEM", item_id: p.id, quantity: 1 }])},'${randomUUID()}')`,
      legacyInbound: `select public.stock_inbound_item('${p.id}',1,'MANUAL','Legacy race')` }[competitor];
    const archiveStatement = statement(archive(p));
    const first = transaction(winner === "archive" ? archiveStatement : competing, true); await first.held;
    const second = transaction(winner === "archive" ? competing : archiveStatement);
    const [a, b] = await Promise.all([first.done, second.done]);
    assert.equal(a.code, 0, a.stderr); assert.notEqual(b.code, 0, "loser must reject stale/inactive/dependency");
    assert.doesNotMatch(a.stderr + b.stderr, /40P01|deadlock detected|statement timeout|lock timeout/);
    const fresh = preview(p.id);
    assert.equal(fresh.isActive, winner !== "archive"); assert.equal(fresh.quantity, winner === "archive" ? 0 : competitor === "outbound" ? 14 : competitor === "order" ? 15 : 16);
    assert.equal(sql("select count(*) from public.stock_movements where quantity_before+quantity_change<>quantity_after or quantity_after<0"), "0");
    assert.equal(sql("select count(*) from private.physical_catalog_requests where request->>'operation'='ARCHIVE'"), winner === "archive" ? "1" : "0");
    assert.equal(sql("select count(*) from public.movement_batches where movement_type='ADJUSTMENT'"), winner === "archive" || competitor === "adjustment" ? "1" : "0");
  });
}
test("concurrent normalized code creation serializes to exactly one product/audit", async () => {
  const request = { operation: "CREATE", itemType: "LOOSE_PART", code: "NK95-UNIQUE", description: "Fixture", reason: "Create" };
  const first = transaction(statement(request), true); await first.held;
  const second = transaction(statement({ ...request, code: "nk95-unique" }));
  const [a,b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.stderr); assert.notEqual(b.code, 0); assert.match(b.stderr, /conflicts/);
  assert.equal(sql("select count(*) from public.items"), "1"); assert.equal(sql("select count(*) from private.physical_catalog_requests"), "1");
});
