import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

// No host/URL/env database. All writes are inside this labelled disposable DB.
const container = "supabase_db_nk_issue100";
const run = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
assert.equal(JSON.parse(run(["inspect", "-f", "{{json .Config.Labels}}", container]))["nk.disposable"], "nk-issue100");
assert.equal(run(["inspect", "-f", "{{.HostConfig.NetworkMode}}", container]).trim(), "none");
const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const sql = statement => run(args, statement).trim();
const json = statement => JSON.parse(sql(statement));
const uid = n => `10000000-0100-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uid(1), other = uid(2), safisa = uid(3), inactive = uid(4);
const item = "d9bfc725-87a3-4194-8f51-bdc49d95bd8c", configuration = "ffdbc822-37ab-4018-a476-b7e6e1f0e596", alias = "781e9bec-c1d7-46a3-a4f6-0a9b7c303771";
const q = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const parsed = output => JSON.parse(output.split(/\r?\n/).findLast(l => l.startsWith("{")));
const authSql = (statement, user = actor) => `begin; set local statement_timeout='6s'; set local lock_timeout='4s'; select set_config('request.jwt.claim.sub','${user}',true); set local role authenticated; ${statement}; commit;`;
const auth = (statement, user) => parsed(sql(authSql(statement, user)));
const summary = id => json(`select to_jsonb(s) from public.supplier_order_summaries s where id='${id}'`);
const line = (id, n = 0) => sql(`select id from public.supplier_order_items where supplier_order_id='${id}' order by position offset ${n} limit 1`);
const pickSql = (id, quantity, key, version = summary(id).updated_at, n = 0) => `select public.set_supplier_order_item_picked_quantity_checked('${line(id,n)}',${quantity},null,'${version}','${key}')`;
const allSql = (id, key = randomUUID(), version = summary(id).updated_at) => `select public.mark_supplier_order_all_picked_checked('${id}',null,'${version}','${key}')`;
const bulkRequest = () => auth("select public.preview_safisa_bulk_pickup()").orders.map(o => ({ supplier_order_id: o.supplier_order_id, expected_updated_at: o.expected_updated_at, expected_line_fingerprint: o.expected_line_fingerprint }));
const bulkSql = (r, key) => `select public.bulk_mark_supplier_orders_all_picked_checked(${q(r)},'${key}')`;
const state = () => json(`select jsonb_build_object(
 'orders',(select jsonb_agg(o order by id) from public.supplier_orders o),
 'lines',(select jsonb_agg(i order by id) from public.supplier_order_items i),
 'balances',(select jsonb_agg(b order by item_id) from public.stock_balances b),
 'config',(select jsonb_agg(b order by configuration_id) from public.configuration_stock_balances b),
 'events',(select jsonb_agg(e order by id) from public.supplier_order_events e),
 'batches',(select jsonb_agg(b order by id) from public.movement_batches b),
 'moves',(select jsonb_agg(m order by id) from public.stock_movements m),
 'entries',(select jsonb_agg(e order by id) from public.supplier_order_stock_entries e),
 'links',(select jsonb_agg(e order by id) from public.supplier_order_stock_entry_lines e),
 'bulk',(select jsonb_agg(e order by id) from public.supplier_order_bulk_pickup_operations e))`);
const finalCount = id => Number(sql(`select count(*) from public.supplier_order_events where supplier_order_id='${id}' and event_type='ORDER_FINALIZED'`));
function rejects(statement, pattern, user = actor) { const before = state(); assert.throws(() => sql(authSql(statement,user)), e => pattern.test(String(e.stderr))); assert.deepEqual(state(),before); }
function seed(n, quantities) {
  const id = uid(100+n);
  sql(`insert into public.supplier_orders(id,negotiation_number,order_date,created_by,created_by_name_snapshot) values('${id}','100${n}',current_date,'${actor}','Operador A');
    ${quantities.map((v,index) => {
      const { ordered = 3, ready = ordered, picked = 0, stocked = picked, cancelled = 0, config = false } = v;
      return `insert into public.supplier_order_items(id,supplier_order_id,item_id,commercial_configuration_id,commercial_configuration_code_id,code_snapshot,description_snapshot,item_type_snapshot,commercial_code_snapshot,ordered_quantity,ready_quantity,picked_quantity,stocked_quantity,cancelled_quantity,position)
        values('${uid(1000+n*10+index)}','${id}',${config ? "null" : `'${item}'`},${config ? `'${configuration}'` : "null"},${config ? `'${alias}'` : "null"},'${config ? "1D" : "1"}','Fixture sanitizada','${config ? "COMMERCIAL_CONFIGURATION" : "SERVO"}',${config ? "'1D'" : "null"},${ordered},${ready},${picked},${stocked},${cancelled},${index});`;
    }).join("\n")}`);
  return id;
}
beforeEach(() => {
  sql(`truncate public.supplier_order_bulk_pickup_operations,public.supplier_orders,public.movement_batches cascade;
    delete from public.stock_balances; delete from public.configuration_stock_balances;
    insert into auth.users(id,aud,role,created_at,updated_at) values ${[actor,other,safisa,inactive].map(id => `('${id}','authenticated','authenticated',now(),now())`).join(",")} on conflict do nothing;
    insert into public.profiles(id,name,is_active) values('${actor}','Operador A',true),('${other}','Operador B',true),('${safisa}','Safisa fixture',false),('${inactive}','Inativo',false) on conflict(id) do update set name=excluded.name,is_active=excluded.is_active;`);
});

test("last line of 2+3: canonical stock entry then exactly one audited finalization; receipt is final and replay immutable", () => {
  const id = seed(1,[{ordered:2},{ordered:3}]);
  auth(pickSql(id,2,randomUUID())); assert.equal(finalCount(id),0);
  const key = randomUUID(), statement = pickSql(id,3,key,undefined,1), receipt = auth(statement,other);
  assert.equal(receipt.is_in_history,true); assert.equal(receipt.closure_kind,"FINALIZED");
  assert.equal(receipt.stock_entry_quantity,3); assert.equal(receipt.stocked_quantity,5);
  assert.equal(finalCount(id),1); const s = summary(id); assert.equal(s.is_active_order,false);
  assert.equal(s.finalized_by,other); assert.equal(s.finalized_by_name_snapshot,"Operador B");
  assert.equal(s.finalization_note,"Finalização automática após retirada integral");
  const event = json(`select to_jsonb(e) from public.supplier_order_events e where supplier_order_id='${id}' and event_type='ORDER_FINALIZED'`);
  assert.equal(event.user_id,other); assert.equal(event.details.result.closure_kind,"FINALIZED"); assert.notEqual(event.idempotency_key,key);
  const before=state(); assert.equal(auth(statement,other).idempotent_replay,true); assert.deepEqual(state(),before);
  rejects(pickSql(id,2,key,undefined,1),/different supplier-order request/,other);
});
test("all ready is NOT all ordered; partial and not-ready lines stay active", () => {
  for (const [n,rows] of [[1,[{ordered:10,ready:3}]],[2,[{ordered:2},{ordered:3,ready:0}]]]) {
    const id=seed(n,rows); auth(allSql(id)); assert.equal(summary(id).is_active_order,true); assert.equal(finalCount(id),0);
  }
});
test("cancelled remainder never becomes FINALIZED through pickup", () => {
  const id=seed(1,[{ordered:3,ready:2,cancelled:1}]); auth(allSql(id)); assert.equal(finalCount(id),0); assert.notEqual(summary(id).closure_kind,"FINALIZED");
});
test("legacy COMPLETED active is not backfilled, even by a no-op pickup; manual finalization remains", () => {
  const id=seed(1,[{ordered:2,picked:2,stocked:0}]); auth(allSql(id)); assert.equal(summary(id).is_active_order,true); assert.equal(finalCount(id),0);
  auth(`select public.finalize_supplier_order('${id}','${summary(id).updated_at}',null,'${randomUUID()}')`);
  assert.equal(summary(id).is_in_history,true);
});
test("legacy stock backlog survives automatic close and remains enterable in History", () => {
  const id=seed(1,[{ordered:2,picked:2,stocked:0},{ordered:3}]); auth(allSql(id));
  assert.equal(summary(id).waiting_stock_quantity,2); assert.equal(summary(id).is_in_history,true);
  auth(`select public.create_supplier_order_stock_entry('${id}',${q([{supplier_order_item_id:line(id),quantity:2}])},null,'${summary(id).updated_at}','${randomUUID()}')`);
  assert.equal(summary(id).waiting_stock_quantity,0); assert.equal(finalCount(id),1);
  assert.equal(Number(sql(`select quantity from public.stock_balances where item_id='${item}'`)),5);
  rejects(allSql(id),/finalized/);
});
test("bulk fully/partially ready together: only the fully picked order closes; aliases and child trace remain", () => {
  const full=seed(1,[{ordered:2,config:true},{ordered:1}]), partial=seed(2,[{ordered:10,ready:3}]);
  const key=randomUUID(), request=bulkRequest(), result=auth(bulkSql(request,key));
  assert.equal(result.total_picked_quantity,6); assert.equal(result.total_stock_entry_quantity,6);
  assert.equal(finalCount(full),1); assert.equal(finalCount(partial),0); assert.equal(summary(partial).is_active_order,true);
  assert.equal(Number(sql(`select quantity from public.configuration_stock_balances where configuration_id='${configuration}'`)),2);
  assert.equal(Number(sql("select count(*) from public.supplier_order_stock_entries")),2);
  for(const o of result.orders) assert.equal(sql(`select supplier_order_id from public.supplier_order_stock_entries where id='${o.supplier_order_stock_entry_id}'`),o.supplier_order_id);
  const before=state(); assert.equal(auth(bulkSql(request,key)).idempotent_replay,true); assert.deepEqual(state(),before);
  rejects(bulkSql(request.slice(1),key),/idempotency/i);
});
test("old preview stale after another pickup: zero partial effects", () => {
  const id=seed(1,[{ordered:3}]), old=allSql(id); auth(pickSql(id,1,randomUUID())); rejects(old,/40001|version_conflict/);
});
test("stock overflow rolls back pickup, closure, movements and audit", () => {
  const id=seed(1,[{ordered:1}]); sql(`insert into public.stock_balances(item_id,quantity) values('${item}',2147483647)`);
  rejects(allSql(id),/22003|range|overflow/); assert.equal(finalCount(id),0);
});
for(const failEvent of ["ORDER_FINALIZED","ALL_ITEMS_MARKED_PICKED"]) test(`${failEvent} failure rolls back stock entry AND finalization`, () => {
  const id=seed(1,[{ordered:3}]);
  sql(`create function private.nk100_fail_event() returns trigger language plpgsql as $$ begin if new.event_type='${failEvent}' then raise exception 'nk100_forced_audit_failure'; end if; return new; end $$;
    create trigger nk100_fail_event before insert on public.supplier_order_events for each row execute function private.nk100_fail_event();`);
  try { rejects(allSql(id),/nk100_forced_audit_failure/); } finally { sql("drop trigger nk100_fail_event on public.supplier_order_events; drop function private.nk100_fail_event()"); }
});
test("failure on the last bulk order rolls back previous child stock and finalizations too", () => {
  seed(1,[{ordered:2}]); const last=seed(2,[{ordered:1}]);
  sql(`create function private.nk100_fail_event() returns trigger language plpgsql as $$ begin if new.supplier_order_id='${last}' and new.event_type='ORDER_FINALIZED' then raise exception 'nk100_last_failure'; end if; return new; end $$;
    create trigger nk100_fail_event before insert on public.supplier_order_events for each row execute function private.nk100_fail_event();`);
  try { rejects(bulkSql(bulkRequest(),randomUUID()),/nk100_last_failure/); } finally { sql("drop trigger nk100_fail_event on public.supplier_order_events; drop function private.nk100_fail_event()"); }
});

function session(statement,user,name,hold=false) {
  const child=spawn("docker",args,{windowsHide:true,stdio:["pipe","pipe","pipe"]}); let out="",err="";
  const done=new Promise(resolve=>{ child.stdout.on("data",d=>out+=d); child.stderr.on("data",d=>err+=d); child.on("close",code=>resolve({code,out,err})); });
  child.stdin.write(`begin; set local application_name='${name}'; set local statement_timeout='6s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='8s'; select set_config('request.jwt.claim.sub','${user}',true); set local role authenticated; ${statement}; select 'NK100_HELD';\n`);
  if(!hold) child.stdin.end("commit;\n");
  return {done,output:()=>out,finish:()=>child.stdin.end("commit;\n")};
}
async function until(check) { const limit=Date.now()+4000; while(Date.now()<limit){if(check())return; await new Promise(r=>setTimeout(r,40));} assert.fail("Expected real SQL lock overlap within 4s"); }
async function race(first,second,user=other) {
  const deadlocks=sql("select deadlocks from pg_stat_database where datname=current_database()");
  const a=session(first,actor,"nk100_first",true); let b;
  try { await until(()=>a.output().includes("NK100_HELD")); b=session(second,user,"nk100_second");
    await until(()=>Number(sql("select count(*) from pg_stat_activity where application_name='nk100_second' and wait_event_type='Lock'"))===1);
  } finally { a.finish(); }
  const results=await Promise.all([a.done,b?.done]); assert.ok(results.every(Boolean));
  assert.ok(results.every(r=>!/(40P01|deadlock detected|statement timeout|lock timeout)/i.test(r.err)));
  assert.equal(sql("select deadlocks from pg_stat_database where datname=current_database()"),deadlocks); return results;
}
test("two-session same-key timeout retry: one pickup, one stock entry, one close", async () => {
  const id=seed(1,[{ordered:3}]), statement=allSql(id); const results=await race(statement,statement,actor);
  assert.deepEqual(results.map(r=>r.code),[0,0]); assert.equal(parsed(results[1].out).idempotent_replay,true);
  assert.equal(finalCount(id),1); assert.equal(Number(sql("select count(*) from public.movement_batches")),1);
});
test("two-session last-line pickup race: stale loser retries, exactly one close by final actor", async () => {
  const id=seed(1,[{ordered:2},{ordered:3}]), version=summary(id).updated_at,key=randomUUID();
  const results=await race(pickSql(id,2,randomUUID(),version),pickSql(id,3,key,version,1));
  assert.equal(results[0].code,0); assert.notEqual(results[1].code,0); assert.match(results[1].err,/40001|version_conflict/);
  assert.equal(finalCount(id),0); auth(pickSql(id,3,key,undefined,1),other); assert.equal(finalCount(id),1); assert.equal(summary(id).finalized_by,other);
});
for(const opponent of ["cancel","edit","finalize"]) test(`two-session final pickup vs ${opponent}: no deadlock or second mutation`, async () => {
  const id=seed(1,[{ordered:3}]),version=summary(id).updated_at;
  const second=opponent==="cancel" ? `select public.cancel_supplier_order_checked('${id}','Teste','${version}','${randomUUID()}')`
    : opponent==="finalize" ? `select public.finalize_supplier_order('${id}','${version}',null,'${randomUUID()}')`
    : `select public.update_supplier_order('${id}','${version}','1001',current_date,null,${q([{id:line(id),kind:"ITEM",item_id:item,quantity:3}])},'${randomUUID()}')`;
  const results=await race(allSql(id),second); assert.equal(results[0].code,0); assert.notEqual(results[1].code,0);
  assert.match(results[1].err,/finalized|40001|version_conflict/); assert.equal(finalCount(id),1); assert.equal(summary(id).picked_quantity,3);
});
test("Safisa all-ready alone never finalizes; canonical pickup moves order to Safisa read-only history without changing pushes", () => {
  auth(`select public.set_safisa_portal_member_status('${safisa}',true,'${randomUUID()}')`);
  const id=seed(1,[{ordered:3,ready:0}]); auth(`select public.mark_safisa_order_remaining_ready('${id}','${randomUUID()}')`,safisa);
  assert.equal(finalCount(id),0); assert.equal(Number(sql("select count(*) from public.push_notification_events where event_type='SAFISA_FULLY_READY'")),1);
  auth(allSql(id)); const detail=auth(`select public.get_safisa_order('${id}')`,safisa);
  assert.equal(summary(id).is_in_history,true); assert.ok(JSON.stringify(detail).includes('"is_read_only":true'));
  assert.equal(Number(sql("select count(*) from public.push_notification_events")),1);
});
test("new helper is private invoker/empty search_path; inactive and anonymous cannot pickup", () => {
  const id=seed(1,[{ordered:1}]); rejects(allSql(id),/active|profile|permission/,inactive);
  assert.throws(()=>sql(`set role anon; ${allSql(id)}`),e=>/permission denied|authenticated user is required/.test(String(e.stderr)));
  rejects(`select private.auto_finalize_integral_supplier_order_pickup('${id}','${actor}','Spoof')`,/permission denied/);
  const p=json("select jsonb_build_object('definer',prosecdef,'config',proconfig) from pg_proc where oid='private.auto_finalize_integral_supplier_order_pickup(uuid,uuid,text)'::regprocedure");
  assert.equal(p.definer,false); assert.ok(p.config.some(c=>c.startsWith("search_path=")));
  assert.equal(Number(sql("select count(*) from public.stock_movements where quantity_before+quantity_change<>quantity_after or quantity_after<0")),0);
});
