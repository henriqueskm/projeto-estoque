import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test, { beforeEach } from "node:test";

const container = process.env.BULK_TEST_DB_CONTAINER ?? "supabase_db_nk_pr84_bulk";
const binary = join(process.env.LOCALAPPDATA ?? "", "Programs/DockerDesktop/resources/bin/docker.exe");
const docker = existsSync(binary) ? binary : "docker";
const run = (...args) => execFileSync(docker, args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
assert.match(container, /^supabase_db_nk_pr84_bulk(?:_[a-z0-9]+)?$/);
assert.equal(JSON.parse(run("inspect", "-f", "{{json .Config.Labels}}", container))["nk.disposable"], "nk-pr84-bulk");
assert.equal(run("inspect", "-f", "{{.HostConfig.NetworkMode}}", container).trim(), "none");
function sql(statement) { return run("exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement).trim(); }
const uid = n => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = uid(1), otherUser = uid(2), inactive = uid(3);
const json = output => JSON.parse(output.split(/\r?\n/).findLast(line => line.startsWith("{")));
const number = statement => Number(sql(statement).split(/\r?\n/).at(-1));
const asUser = (statement, actor = user) => sql(`begin; set local statement_timeout = '8s'; select set_config('request.jwt.claim.sub','${actor}',true); set local role authenticated; ${statement}; commit;`);
const preview = () => json(asUser("select public.preview_safisa_bulk_pickup()"));
const request = () => preview().orders.map(o => ({ supplier_order_id: o.supplier_order_id, expected_updated_at: o.expected_updated_at, expected_line_fingerprint: o.expected_line_fingerprint }));
const bulkSQL = (orders, key) => `select public.bulk_mark_supplier_orders_all_picked_checked('${JSON.stringify(orders)}'::jsonb, '${key}')`;
const bulk = (orders, key = uid(500), actor) => json(asUser(bulkSQL(orders, key), actor));
const item = sql("select id from public.items where item_type='SERVO' and is_active order by id limit 1");
const kit = sql("select id from public.items where item_type='INSTALLATION_KIT' and is_active order by id limit 1");
const loose = sql("select id from public.items where item_type='LOOSE_PART' and is_active order by id limit 1");
const config = json(sql("select json_build_object('id', configuration_id,'alias',min(id::text)) from public.commercial_configuration_codes where is_active group by configuration_id having count(*) > 1 order by configuration_id limit 1"));
const alias = sql(`select id from public.commercial_configuration_codes where configuration_id='${config.id}' and is_active and id <> '${config.alias}' order by id limit 1`);

beforeEach(() => {
  sql(`truncate public.supplier_order_bulk_pickup_operations, public.supplier_orders, public.movement_batches cascade;
    delete from public.stock_balances; delete from public.configuration_stock_balances;
    insert into auth.users(id,aud,role,created_at,updated_at) values
    ('${user}','authenticated','authenticated',now(),now()),('${otherUser}','authenticated','authenticated',now(),now()),('${inactive}','authenticated','authenticated',now(),now()) on conflict(id) do nothing;
    insert into public.profiles(id,name,is_active) values('${user}','Bulk Fixture A',true),('${otherUser}','Bulk Fixture B',true),('${inactive}','Inactive',false)
    on conflict(id) do update set name=excluded.name,is_active=excluded.is_active;`);
});
function seed(n, lines) {
  sql(`insert into public.supplier_orders(id,negotiation_number,order_date,created_by,created_by_name_snapshot)
    values('${uid(100+n)}','840${n}',current_date,'${user}','Bulk Fixture A');
    ${lines.map((line, index) => {
      const { target = item, configuration = null, codeId = null, ready = 3, ordered = 10, picked = 0, stocked = picked, code = `FIX-${n}-${index}` } = line;
      return `insert into public.supplier_order_items(id,supplier_order_id,item_id,commercial_configuration_id,commercial_configuration_code_id,
        code_snapshot,description_snapshot,item_type_snapshot,commercial_code_snapshot,ordered_quantity,ready_quantity,picked_quantity,stocked_quantity,position)
        values('${uid(1000+n*10+index)}','${uid(100+n)}',${configuration ? "null" : `'${target}'`},${configuration ? `'${configuration}'` : "null"},${codeId ? `'${codeId}'` : "null"},
        '${code}','Sanitized fixture description',${configuration ? "'COMMERCIAL_CONFIGURATION'" : `(select item_type from public.items where id='${target}')`},${configuration ? `'${code}'` : "null"},${ordered},${ready},${picked},${stocked},${index});`;
    }).join("\n")}`);
  return uid(100+n);
}
const counts = () => JSON.parse(sql(`select json_build_object('picked',coalesce((select sum(picked_quantity) from public.supplier_order_items),0),
  'stocked',coalesce((select sum(stocked_quantity) from public.supplier_order_items),0),
  'stock',coalesce((select sum(quantity) from public.stock_balances),0),'config',coalesce((select sum(quantity) from public.configuration_stock_balances),0),
  'events',(select count(*) from public.supplier_order_events),'entries',(select count(*) from public.supplier_order_stock_entries),
  'batches',(select count(*) from public.movement_batches),'movements',(select count(*) from public.stock_movements),
  'configMovements',(select count(*) from public.configuration_stock_movements),'ledger',(select count(*) from public.supplier_order_bulk_pickup_operations))`));
function reject(orders, expression = /supplier_order_version_conflict/, key = uid(500), actor) {
  const before = counts();
  assert.throws(() => bulk(orders,key,actor), error => expression.test(String(error.stderr)));
  assert.deepEqual(counts(), before);
}
function concurrent(statement, actor = user) {
  return new Promise((resolve, rejectPromise) => {
    const child = spawn(docker, ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c",
      `begin; set local statement_timeout='8s'; select set_config('request.jwt.claim.sub','${actor}',true); set local role authenticated; ${statement}; select pg_sleep(0.3); commit;`], { windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", c => { out += c; }); child.stderr.on("data", c => { err += c; });
    child.on("error", rejectPromise); child.on("close", code => code === 0 ? resolve(json(out)) : rejectPromise(new Error(err)));
  });
}

test("fresh preview is read-only, complete and includes partial + fully ready orders and snapshot labels", () => {
  seed(1,[{ready:3,code:"1H"},{target:kit,ready:2}]); seed(2,[{ordered:5,ready:5}]); seed(3,[{ready:0}]);
  const before=counts(), p=preview(); assert.deepEqual(counts(),before);
  assert.equal(p.order_count,2); assert.equal(p.line_count,3); assert.equal(p.total_quantity,10);
  const snapshot = json(sql(`select json_build_object('code',code_snapshot,'description',description_snapshot) from public.supplier_order_items where id='${uid(1010)}'`));
  assert.equal(p.orders[0].lines[0].code,snapshot.code); assert.equal(p.orders[0].lines[0].description_snapshot,snapshot.description);
  assert.ok(p.orders.every(o=>o.expected_updated_at));
});
test("3 orders with physical items, kits, loose parts and shared targets retain every audit/stock entry and totals", () => {
  seed(1,[{ready:3},{target:kit,ready:2}]); seed(2,[{target:loose,ready:1}]); seed(3,[{ready:4}]);
  const result=bulk(request()); assert.equal(result.order_count,3); assert.equal(result.changed_line_count,4);
  assert.equal(result.total_picked_quantity,10); assert.equal(result.total_stock_entry_quantity,10);
  assert.equal(number(`select quantity from public.stock_balances where item_id='${item}'`),7);
  assert.equal(counts().entries,3); assert.equal(counts().batches,3); assert.equal(counts().ledger,1);
  assert.equal(number("select count(*) from public.supplier_order_events where event_type='ALL_ITEMS_MARKED_PICKED'"),3);
  for(const order of result.orders) assert.equal(number(`select count(*) from public.supplier_order_stock_entries where id='${order.supplier_order_stock_entry_id}' and movement_batch_id='${order.movement_batch_id}' and supplier_order_id='${order.supplier_order_id}'`),1);
  assert.equal(number("select count(*) from public.stock_movements where quantity_before+quantity_change <> quantity_after"),0);
});
test("partially ready pickup enters only ready-picked, remains active and appears again after new readiness", () => {
  const order=seed(1,[{ready:3}]); const result=bulk(request()); assert.equal(result.total_picked_quantity,3);
  assert.equal(number(`select count(*) from public.supplier_order_summaries where id='${order}' and is_active_order`),1);
  assert.equal(preview().order_count,0);
  sql(`update public.supplier_order_items set ready_quantity=5 where supplier_order_id='${order}'`);
  assert.equal(preview().total_quantity,2);
});
test("fully ready pickup follows canonical lifecycle without a separate administrative finalization", () => {
  const order=seed(1,[{ordered:5,ready:5}]); const result=bulk(request()); assert.equal(result.total_picked_quantity,5);
  assert.equal(number(`select count(*) from public.supplier_order_stock_entries where supplier_order_id='${order}'`),1);
  assert.equal(preview().order_count,0);
});
test("two aliases use the same configuration balance while preserving per-order snapshots/history", () => {
  seed(1,[{configuration:config.id,codeId:config.alias,code:"ALIAS-A",ready:2}]);
  seed(2,[{configuration:config.id,codeId:alias,code:"ALIAS-B",ready:3}]);
  const result=bulk(request()); assert.equal(result.total_stock_entry_quantity,5);
  assert.equal(number(`select quantity from public.configuration_stock_balances where configuration_id='${config.id}'`),5);
  assert.equal(counts().configMovements,2); assert.equal(counts().stock,0);
  assert.equal(number("select count(*) from public.supplier_order_stock_entry_lines"),2);
});
test("same key replay returns immutable receipt before stale checks with no duplicate events, stock or batch", () => {
  seed(1,[{}]); const r=request(), result=bulk(r), before=counts(); const replay=bulk(r);
  assert.deepEqual(counts(),before); assert.equal(replay.idempotent_replay,true);
  assert.equal(replay.bulk_pickup_id,result.bulk_pickup_id); assert.deepEqual(replay.orders,result.orders);
});
test("same key with different request rejects; reordered identical request is canonical", () => {
  seed(1,[{}]); seed(2,[{}]); const r=request(); bulk(r);
  assert.equal(bulk([...r].reverse()).idempotent_replay,true);
  reject(r.slice(0,1),/payload mismatch/);
});
for(const index of [0,2]) test(`stale order at position ${index} is validated before any write`, () => {
  for(let n=1;n<=3;n++)seed(n,[{}]); const r=request();
  sql(`update public.supplier_orders set updated_at=updated_at+interval '1 second' where id='${r[index].supplier_order_id}'`);
  reject(r);
});
test("stock failure on last child rolls back earlier pickups, balances, movements, events, entries and ledger", () => {
  seed(1,[{}]); seed(2,[{target:kit}]); seed(3,[{target:loose}]); const r=request();
  sql(`create function private.pr84_injected_failure() returns trigger language plpgsql as $$ begin if new.item_id='${loose}' then raise exception 'injected last-child stock failure'; end if; return new; end; $$;
    create trigger pr84_injected_failure before insert on public.stock_movements for each row execute function private.pr84_injected_failure();`);
  try { reject(r,/injected last-child/); } finally { sql("drop trigger pr84_injected_failure on public.stock_movements; drop function private.pr84_injected_failure();"); }
});
test("cancelled order aborts the complete preview", () => {
  seed(1,[{}]); const last=seed(2,[{}]); const r=request();
  sql(`update public.supplier_orders set cancelled_at=now(),cancellation_note='Fixture cancellation',cancelled_by='${user}',cancelled_by_name_snapshot='Bulk Fixture A' where id='${last}'`);
  reject(r);
});
test("individual pickup by another user invalidates the entire bulk without double stock", () => {
  seed(1,[{}]); seed(2,[{}]); const r=request(), last=r.at(-1);
  asUser(`select public.mark_supplier_order_all_picked_checked('${last.supplier_order_id}',null,'${last.expected_updated_at}', '${uid(501)}')`,otherUser);
  reject(r);
});
test("new eligible order after preview is not silently included or a conflict for included orders", () => {
  seed(1,[{}]); const r=request(); seed(2,[{ready:2}]); assert.equal(bulk(r).order_count,1);
  assert.equal(preview().order_count,1); assert.equal(preview().total_quantity,2);
});
test("line fingerprint rejects changed ready delta even when a legacy timestamp is unchanged", () => {
  const order=seed(1,[{ready:3}]);const r=request();
  sql(`update public.supplier_order_items set ready_quantity=5 where supplier_order_id='${order}';
    update public.supplier_orders set updated_at='${r[0].expected_updated_at}' where id='${order}';`);
  reject(r);
});
test("same bulk concurrent retry commits once and returns the winning receipt", async () => {
  seed(1,[{}]); seed(2,[{}]); const statement=bulkSQL(request(),uid(500));
  const results=await Promise.all([concurrent(statement),concurrent(statement)]);
  assert.equal(results.filter(r=>r.idempotent_replay).length,1); assert.equal(results[0].bulk_pickup_id,results[1].bulk_pickup_id);
  assert.equal(counts().stock,6); assert.equal(counts().batches,2);
});
test("bulk versus individual pickup serializes safely, loser is stale, no double stock", async () => {
  seed(1,[{}]); const r=request(), order=r[0];
  const results=await Promise.allSettled([concurrent(bulkSQL(r,uid(500))), concurrent(`select public.mark_supplier_order_all_picked_checked('${order.supplier_order_id}',null,'${order.expected_updated_at}','${uid(501)}')`,otherUser)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.match(String(results.find(r=>r.status==="rejected").reason),/supplier_order_version_conflict/);
  assert.equal(counts().stock,3); assert.equal(counts().batches,1);
});
test("overlapping bulks lock parents in UUID order, one commits and other fails stale without partial effects", async () => {
  seed(1,[{target:kit}]); seed(2,[{}]); seed(3,[{target:loose}]); const r=request();
  const results=await Promise.allSettled([concurrent(bulkSQL(r.slice(0,2),uid(500))), concurrent(bulkSQL(r.slice(1),uid(501)),otherUser)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1); assert.equal(counts().stock,6); assert.equal(counts().batches,2);
  assert.match(String(results.find(r=>r.status==="rejected").reason),/supplier_order_version_conflict/);
});
test("disjoint bulks with opposing shared target order do not deadlock", async () => {
  seed(1,[{target:item}]); seed(2,[{target:kit}]); seed(3,[{target:kit}]); seed(4,[{target:item}]); const r=request();
  const results=await Promise.all([concurrent(bulkSQL(r.slice(0,2),uid(500))),concurrent(bulkSQL(r.slice(2),uid(501)),otherUser)]);
  assert.equal(results.length,2); assert.equal(counts().stock,12); assert.equal(counts().batches,4);
});
test("bulk versus canonical historical stock entry shares targets without lock inversion", async () => {
  seed(1,[{target:item},{configuration:config.id,codeId:config.alias}]);
  const backlog=seed(2,[{configuration:config.id,codeId:config.alias,ready:2,picked:2,stocked:0},{target:item,ready:2,picked:2,stocked:0}]);
  const version=sql(`select updated_at from public.supplier_orders where id='${backlog}'`);
  const lines=JSON.stringify([0,1].map(index=>({supplier_order_item_id:uid(1020+index),quantity:1})));
  const results=await Promise.all([concurrent(bulkSQL(request(),uid(500))),concurrent(
    `select public.create_supplier_order_stock_entry('${backlog}','${lines}'::jsonb,null,'${version}','${uid(501)}')`,otherUser)]);
  assert.equal(results.length,2); assert.equal(counts().stock,4); assert.equal(counts().config,4);
  assert.equal(counts().entries,2); assert.equal(counts().batches,2);
});
test("global key rejects collision with a canonical order operation", () => {
  seed(1,[{}]); seed(2,[{}]); const r=request(), first=r[0];
  asUser(`select public.mark_supplier_order_all_picked_checked('${first.supplier_order_id}',null,'${first.expected_updated_at}','${uid(500)}')`);
  reject(r,/another operation/);
});
test("RLS/grants deny direct browser ledger access, anonymous and inactive calls", () => {
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.supplier_order_bulk_pickup_operations'::regclass"),"t");
  for(const privilege of ["SELECT","INSERT","UPDATE","DELETE"])assert.equal(sql(`select has_table_privilege('authenticated','public.supplier_order_bulk_pickup_operations','${privilege}')`),"f");
  assert.equal(sql("select has_function_privilege('anon','public.preview_safisa_bulk_pickup()','EXECUTE')"),"f");
  assert.equal(sql("select has_function_privilege('authenticated','private.bulk_mark_supplier_orders_all_picked_checked(jsonb,uuid,uuid,text)','EXECUTE')"),"f");
  assert.throws(()=>asUser("select public.preview_safisa_bulk_pickup()",inactive),error=>/active profile/.test(String(error.stderr)));
});
test("limits/duplicates fail closed; no silent subset and no forged quantities", () => {
  seed(1,[{}]); const r=request(); reject([...r,...r],/duplicate/);
  reject([{...r[0],quantity:1}],/Invalid bulk/);
  reject(Array.from({length:101},()=>r[0]),/bulk_pickup_limit/);
  for(let n=2;n<=101;n++)seed(n,[{ready:1}]);
  assert.throws(()=>preview(),error=>/bulk_pickup_limit/.test(String(error.stderr)));
  assert.equal(counts().stock,0);
});
test("more than 500 ready lines abort preview even below the order limit", () => {
  const targets = sql("select id from public.items where is_active order by id limit 6").split(/\r?\n/);
  assert.equal(targets.length,6);
  for(let n=1;n<=84;n++) seed(n,targets.map(target=>({target,ready:1})));
  assert.equal(number("select count(*) from public.supplier_order_items"),504);
  assert.throws(()=>preview(),error=>/bulk_pickup_limit/.test(String(error.stderr)));
  assert.equal(counts().stock,0); assert.equal(counts().events,0);
});
