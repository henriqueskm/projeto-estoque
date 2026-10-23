import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { markSupplierOrderAllPicked, setSupplierOrderItemPickedQuantity } from "../app/(authenticated)/pedidos/actions.ts";
const id="10000000-0100-4000-8000-000000000001", key="10000000-0100-4000-8000-000000000002", version="2026-10-23T04:00:00Z";
let receipt,calls;
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
beforeEach(()=>{
  calls=[]; globalThis.__nk57RevalidatedPaths=[]; globalThis.__nk57Pushes=[];
  receipt={supplier_order_id:id,negotiation_number:"1001",line_count:1,ordered_quantity:3,picked_quantity:3,cancelled_quantity:0,waiting_pickup_quantity:0,
    stocked_quantity:3,waiting_stock_quantity:0,pickup_percentage:100,status:"COMPLETED",updated_at:version,is_in_history:true,closure_kind:"FINALIZED",
    supplier_order_stock_entry_id:id,movement_batch_id:key,stock_entry_line_count:1,stock_entry_quantity:3,stock_entry_created_at:version,added_picked_quantity:3,picked_quantity_delta:3,idempotent_replay:false};
  globalThis.__nk57SupabaseClient={auth:{async getClaims(){return{data:{claims:{sub:id}},error:null};}},
    from(table){assert.equal(table,"profiles");return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{id,name:"Fixture"},error:null};}};},
    async rpc(name,args){calls.push({name,args});return{data:receipt,error:null};}};
});
const all=()=>markSupplierOrderAllPicked({supplier_order_id:id,expected_updated_at:version,idempotency_key:key});
test("mark-all returns persisted final classification + canonical stock receipt and invalidates all affected routes",async()=>{
  const r=await all(); assert.equal(r.ok,true); assert.equal(r.receipt.closureKind,"FINALIZED"); assert.equal(r.receipt.isInHistory,true);
  assert.equal(r.receipt.automaticStockEntry.quantity,3);
  for(const p of ["/pedidos","/","/estoque","/entrada","/saida","/estatisticas","/historico","/relatorio-estoque"]) assert.ok(globalThis.__nk57RevalidatedPaths.includes(p));
  assert.equal(calls[0].name,"mark_supplier_order_all_picked_checked"); assert.equal(calls[0].args.p_idempotency_key,key);
});
test("individual pickup shares final classification without a second RPC or client-side finalizer",async()=>{
  const r=await setSupplierOrderItemPickedQuantity({supplier_order_item_id:id,picked_quantity:3,expected_updated_at:version,idempotency_key:key});
  assert.equal(r.ok,true); assert.equal(r.receipt.isInHistory,true); assert.equal(calls.length,1); assert.equal(calls[0].name,"set_supplier_order_item_picked_quantity_checked");
});
test("partial ready-only receipt remains active, never inferred completed from pickup delta",async()=>{
  Object.assign(receipt,{ordered_quantity:10,waiting_pickup_quantity:7,pickup_percentage:30,status:"PARTIAL",is_in_history:false,closure_kind:null});
  const r=await all(); assert.equal(r.ok,true); assert.equal(r.receipt.isInHistory,false); assert.equal(r.receipt.closureKind,null);
});
test("malformed/contradictory closure metadata never yields false success",async()=>{
  for(const patch of [{is_in_history:false,closure_kind:"FINALIZED"},{is_in_history:"true",closure_kind:"FINALIZED"},{is_in_history:true,closure_kind:"UNKNOWN"}]){
    Object.assign(receipt,patch); assert.equal((await all()).ok,false);
  }
});
test("pre-rollout receipts without optional classification remain compatible",async()=>{
  delete receipt.is_in_history; delete receipt.closure_kind; const r=await all(); assert.equal(r.ok,true); assert.equal(r.receipt.closureKind,undefined);
});
test("UI consumes final receipt, closes active detail before refresh and clearly reports History",()=>{
  const ui=read("app/(authenticated)/pedidos/orders-workspace.tsx");
  assert.match(ui,/if \(receipt\.closureKind === "FINALIZED"\) onFinalized/);
  assert.match(ui,/Pedido finalizado automaticamente e movido para o Histórico/);
  assert.match(ui,/onFinalized=\{\(message\) => \{\s*setFinalizedOrderIds[\s\S]*?setSelectedOrderId\(null\);\s*handleMutated\(\s*message \?\?/);
  assert.match(ui,/finalizedOrderIds\.has\(selectedOrderId\) \? "history" : "active"/);
  assert.match(ui,/readOnly=\{detailState\.data\.order\.isInHistory\}/);
});
test("only one new pending migration, after all 45 reconciled versions",()=>{
  const versions=JSON.parse(read("tests/fixtures/nk-migration-history-20261023.json")).versions;
  const names=readdirSync(new URL("../supabase/migrations/",import.meta.url)).filter(n=>n.endsWith(".sql"));
  assert.equal(names.length,46); assert.deepEqual(names.filter(n=>!versions.includes(n.split("_")[0])),["20261023043855_auto_finalize_integral_supplier_order_pickup.sql"]);
});
test("SQL composes post-stock finalizer, positive pickup only, strict eligibility; no backfill or new privilege",()=>{
  const sql=read("supabase/migrations/20261023043855_auto_finalize_integral_supplier_order_pickup.sql");
  assert.match(sql,/picked_quantity <> ordered_quantity or cancelled_quantity <> 0/);
  assert.match(sql,/perform private\.finalize_supplier_order/);
  assert.match(sql,/if v_delta > 0 then\s*perform private\.auto_finalize/);
  assert.match(sql,/if v_added_picked_quantity > 0 then\s*perform private\.auto_finalize/);
  assert.match(sql,/from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql,/security definer|create trigger|grant execute|alter table|update public\.stock_balances/);
  for(const name of ["set_supplier_order_item_picked_quantity","mark_supplier_order_all_picked"]){
    const worker=sql.slice(sql.indexOf(`create or replace function private.${name}(`));
    assert.ok(worker.indexOf("private.apply_supplier_order_stock_entry(")<worker.indexOf("perform private.auto_finalize"));
    assert.ok(worker.indexOf("perform private.auto_finalize")<worker.indexOf("v_result := private.supplier_order_result"));
  }
});
test("canonical pickup workers retain every existing statement except the three integration additions",()=>{
  const original=read("supabase/migrations/20260812023500_atomic_supplier_order_pickup_stock_entry.sql").replaceAll("\r\n","\n");
  const next=read("supabase/migrations/20261023043855_auto_finalize_integral_supplier_order_pickup.sql").replaceAll("\r\n","\n");
  const workers=source=>source.slice(source.indexOf("create or replace function private.set_supplier_order_item_picked_quantity("),source.indexOf("$$;",source.indexOf("create or replace function private.mark_supplier_order_all_picked("))+3).trim();
  const restored=workers(next)
    .replace("  -- Lock every line before stock targets. Finalization reuses these locks.\n  perform 1 from public.supplier_order_items\n  where supplier_order_id = v_order.id order by id for update;\n\n","")
    .replace("  if v_delta > 0 then\n    perform private.auto_finalize_integral_supplier_order_pickup(v_order.id, p_user_id, p_user_name);\n  end if;\n\n","")
    .replace("  if v_added_picked_quantity > 0 then\n    perform private.auto_finalize_integral_supplier_order_pickup(p_supplier_order_id, p_user_id, p_user_name);\n  end if;\n\n","");
  assert.equal(restored,workers(original));
});
