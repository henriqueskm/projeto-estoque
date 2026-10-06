import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bulkPickupStaleMessage, createBulkPickupAttempt, normalizeBulkPickupRequest, parseBulkPickupPreview, parseBulkPickupReceipt } from "../lib/safisa-bulk-pickup.ts";
import { previewSafisaBulkPickup, confirmSafisaBulkPickup } from "../lib/safisa-bulk-pickup-actions.ts";
import { SafisaBulkPickupPreviewContent, SafisaBulkPickupAction } from "../components/safisa-bulk-pickup-dialog.tsx";
import { SafisaPickupAlertHomeSummary } from "../components/safisa-pickup-alerts.tsx";
import { createSemanticBackHistory } from "../lib/semantic-back-history.ts";

const id = n => `84000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const version = "2026-10-06T12:00:00.123456+00:00";
const rawOrder = (n, ready=3) => ({supplier_order_id:id(n),negotiation_number:`4095${n}`,order_date:"2026-10-06",expected_updated_at:version,expected_line_fingerprint:"a".repeat(32),
  lines:[{supplier_order_item_id:id(100+n),code:n===1?"1H":"CIL",description_snapshot:"SERVO MBF-025",ready_quantity:ready,picked_quantity:0,quantity_to_pickup:ready}]});
const rawPreview = () => ({order_count:2,line_count:2,total_quantity:8,orders:[rawOrder(1),rawOrder(2,5)]});
const request = () => ({orders:[{supplierOrderId:id(1),expectedUpdatedAt:version,expectedLineFingerprint:"a".repeat(32)}],idempotencyKey:id(500)});
const rawReceipt = () => ({bulk_pickup_id:id(600),order_count:1,changed_line_count:1,total_picked_quantity:3,total_stock_entry_quantity:3,idempotent_replay:false,
  orders:[{supplier_order_id:id(1),negotiation_number:"40959",changed_line_count:1,added_picked_quantity:3,stock_entry_quantity:3,supplier_order_stock_entry_id:id(700),movement_batch_id:id(800)}]});
let calls=[];
beforeEach(()=>{
  calls=[]; globalThis.__bulkAuth=true; globalThis.__bulkPaths=[];
  globalThis.__bulkClient={rpc:async(name,args)=>{calls.push({name,args});return {data:name==="preview_safisa_bulk_pickup"?rawPreview():rawReceipt(),error:null};}};
  globalThis.__bulkAlerts={alerts:[],alertCount:0,isComplete:true,hasConfirmedData:true,refreshAlerts:async()=>{}};
});
test("fresh preview action invokes only read RPC, returns every snapshot and does not revalidate/mutate", async()=>{
  const result=await previewSafisaBulkPickup(); assert.equal(result.ok,true); assert.equal(result.preview.totalQuantity,8);
  assert.deepEqual(calls,[{name:"preview_safisa_bulk_pickup",args:undefined}]); assert.deepEqual(globalThis.__bulkPaths,[]);
});
test("preview represents partial and fully ready together; deltas, microsecond versions and fingerprints preserved",()=>{
  const p=parseBulkPickupPreview(rawPreview()); assert.equal(p.orders[0].lines[0].quantityToPickup,3);
  assert.equal(p.orders[1].lines[0].quantityToPickup,5); assert.equal(p.orders[0].expectedUpdatedAt,version);
  assert.equal(p.lineCount,2); assert.equal(p.totalQuantity,8);
});
test("incomplete/duplicate/incorrect deltas and unsafe limits are rejected without accepting subset",()=>{
  for(const mutate of [p=>p.orders.pop(),p=>p.orders[0].lines[0].quantity_to_pickup=4,p=>p.line_count=501,p=>p.order_count=101,p=>p.orders[1].supplier_order_id=id(1),p=>p.orders[0].expected_line_fingerprint=null]){
    const p=rawPreview();mutate(p);assert.equal(parseBulkPickupPreview(p),null);
  }
});
test("empty preview is valid and contains no confirmable request",()=>{
  assert.deepEqual(parseBulkPickupPreview({orders:[],order_count:0,line_count:0,total_quantity:0}),{orders:[],orderCount:0,lineCount:0,totalQuantity:0});
  assert.equal(normalizeBulkPickupRequest({orders:[],idempotencyKey:id(500)}),null);
});
test("request allows identities/versions only, retains exact timestamp and sorts orders",()=>{
  const r=request();r.orders.push({...r.orders[0],supplierOrderId:id(2)});r.orders.reverse();
  assert.equal(normalizeBulkPickupRequest(r).orders[0].supplierOrderId,id(1));
  assert.equal(normalizeBulkPickupRequest({...request(),quantity:99}),null);
  assert.equal(normalizeBulkPickupRequest({...request(),orders:[{...request().orders[0],quantity:1}]}),null);
});
test("confirm invokes exactly one RPC, no per-order server loop; refreshes all affected routes",async()=>{
  const result=await confirmSafisaBulkPickup(request());assert.equal(result.ok,true);assert.equal(calls.length,1);
  assert.equal(calls[0].name,"bulk_mark_supplier_orders_all_picked_checked");
  assert.equal(calls[0].args.p_idempotency_key,id(500));assert.equal(calls[0].args.p_orders[0].expected_updated_at,version);
  assert.deepEqual(globalThis.__bulkPaths,["/","/pedidos","/estoque","/entrada","/saida","/estatisticas","/historico"]);
});
test("stale explicitly invalidates confirmation and requires new preview",async()=>{
  globalThis.__bulkClient.rpc=async()=>({error:{code:"40001"}});
  const attempt=createBulkPickupAttempt(request());const result=await attempt.submit(confirmSafisaBulkPickup);
  assert.equal(result.stale,true);assert.equal(result.error,bulkPickupStaleMessage);assert.equal(attempt.phase(),"stale");
  assert.equal(await attempt.submit(confirmSafisaBulkPickup),null);assert.deepEqual(globalThis.__bulkPaths,[]);
});
test("transport throw and lost receipt retry the exact same identity, no fresh key",async()=>{
  const seen=[],attempt=createBulkPickupAttempt(request());let n=0;
  const writer=async r=>{seen.push(r);if(n++===0)throw new Error("timeout");return {ok:true,receipt:parseBulkPickupReceipt(rawReceipt())};};
  assert.equal((await attempt.submit(writer)).transportUncertain,true);assert.equal(attempt.phase(),"uncertain");
  assert.equal((await attempt.submit(writer)).ok,true);assert.equal(seen[0],seen[1]);assert.equal(seen[1].idempotencyKey,id(500));
});
test("pending double click cannot submit twice and success is terminal",async()=>{
  let resolve;const promise=new Promise(r=>{resolve=r;}),attempt=createBulkPickupAttempt(request());let calls=0;
  const writer=()=>{calls++;return promise;};const first=attempt.submit(writer);
  assert.equal(attempt.phase(),"pending");assert.equal(await attempt.submit(writer),null);assert.equal(calls,1);
  resolve({ok:true,receipt:parseBulkPickupReceipt(rawReceipt())});await first;
  assert.equal(await attempt.submit(writer),null);assert.equal(calls,1);
});
test("malformed receipt is transport-uncertain, not falsely safe to generate another key",async()=>{
  globalThis.__bulkClient.rpc=async()=>({data:{},error:null});assert.equal((await confirmSafisaBulkPickup(request())).transportUncertain,true);
  const bad=rawReceipt();bad.total_stock_entry_quantity=4;assert.equal(parseBulkPickupReceipt(bad),null);
});
test("connection/unknown completion SQLSTATE retains identity rather than assuming rollback",async()=>{
  for(const code of ["08006","40003","57P01","PGRST000",""]){
    globalThis.__bulkClient.rpc=async()=>({error:{code}});
    const attempt=createBulkPickupAttempt(request());
    assert.equal((await attempt.submit(confirmSafisaBulkPickup)).transportUncertain,true);
    assert.equal(attempt.phase(),"uncertain");assert.equal(attempt.request.idempotencyKey,id(500));
  }
});
test("authentication is checked before any read/write RPC",async()=>{
  globalThis.__bulkAuth=false;await assert.rejects(previewSafisaBulkPickup);await assert.rejects(()=>confirmSafisaBulkPickup(request()));assert.equal(calls.length,0);
});
test("SQL limit is operationally reported; nontransport failure never refreshes stock",async()=>{
  globalThis.__bulkClient.rpc=async()=>({error:{code:"54000"}});assert.match((await previewSafisaBulkPickup()).error,/itens demais/);
  assert.equal((await confirmSafisaBulkPickup(request())).transportUncertain,undefined);assert.equal(globalThis.__bulkPaths.length,0);
});
test("CTA exists only with eligible alert data; selected receipt component survives empty alerts",()=>{
  let html=renderToStaticMarkup(createElement(SafisaPickupAlertHomeSummary));assert.doesNotMatch(html,/Retirar todos os prontos/);
  globalThis.__bulkAlerts={...globalThis.__bulkAlerts,alertCount:2,alerts:[{supplierOrderId:id(1),negotiationNumber:"40959",kind:"PARTIALLY_READY",readyWaitingPickupQuantity:3},{supplierOrderId:id(2),negotiationNumber:"40971",kind:"FULLY_READY",readyWaitingPickupQuantity:5}]};
  html=renderToStaticMarkup(createElement(SafisaPickupAlertHomeSummary));assert.match(html,/Retirar todos os prontos/);assert.match(html,/8 unidades/);assert.match(html,/Pedido 40959/);assert.match(html,/Ver todos/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(SafisaBulkPickupAction,{enabled:false})),/Retirar todos/);
});
test("preview renders every line and escapes snapshot HTML; no silent slice",()=>{
  const p=parseBulkPickupPreview(rawPreview());p.orders[0].lines[0].descriptionSnapshot="<script>unsafe</script>";
  const html=renderToStaticMarkup(createElement(SafisaBulkPickupPreviewContent,{preview:p}));
  assert.match(html,/40951/);assert.match(html,/40952/);assert.match(html,/Cód. 1H/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.equal((html.match(/un\.<\/span>/g)??[]).length,2);
});
test("Back closes preview, Forward cannot restore it; pending mutation blocks traversal",()=>{
  const stack=[{__NA:true}];let index=0;
  const history={get state(){return stack[index];},pushState(s){stack.splice(index+1);stack.push(structuredClone(s));index++;},replaceState(s){stack[index]=structuredClone(s);},go(delta){const next=index+delta;if(next<0||next>=stack.length)return;index=next;c.pop(history.state);}};
  const c=createSemanticBackHistory({history,href:()=>"/",standalone:()=>false,exit:()=>{},beforePop:()=>{},id:(()=>{let n=0;return()=>String(++n);})()});c.ensure();
  let open=true,pending=false;c.openTransient("bulk",()=>{open=false;},()=>pending);
  pending=true;history.go(-1);assert.equal(open,true);pending=false;history.go(-1);assert.equal(open,false);
  history.go(1);assert.equal(open,false);assert.ok(history.state.__NA);
});
test("UI uses existing Semantic Back/Activity gate, retains uncertainty, terminal success and safe mobile layout",()=>{
  const ui=read("components/safisa-bulk-pickup-dialog.tsx"),provider=read("components/safisa-pickup-alert-provider.tsx");
  assert.match(ui,/useSemanticTransient\(true, onClose, pending\)/);assert.match(ui,/useRouteTransientCleanup\(close\)/);assert.match(ui,/useRouteMutation\(startTransition, refresh\)/);
  assert.doesNotMatch(ui,/useSemanticTransient\(open,/);
  assert.doesNotMatch(ui,/popstate|window\.onpopstate|movement_batches/);
  assert.match(ui,/phase\(\) === "uncertain"/);assert.match(ui,/receipt \? <Link/);assert.match(ui,/min-h-11/);assert.match(ui,/overflow-wrap:anywhere/);assert.match(ui,/max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(ui,/enabled \|\| phase === "uncertain"/);assert.match(ui,/Verificar retirada pendente/);
  assert.match(read("components/safisa-pickup-alerts.tsx"),/hidden=\{!hasPickup && !hasUnresolvedPickup\}/);
  assert.match(ui,/aria-modal="true"/);assert.match(ui,/event.key === "Escape"/);assert.match(provider,/inventoryDataChangedEvent/);assert.match(provider,/while \(refreshRequestedRef.current\)/);
});
test("deployment reset/backup include ledger without loosening old fingerprints/guards",()=>{
  for(const path of ["scripts/deployment-reset/dry-run.sql","scripts/deployment-reset/execute.sql","scripts/deployment-operational-reset.ps1","scripts/deployment-backup.mjs","tests/fixtures/deployment-operational-reset.sql"])
    assert.match(read(path),/supplier_order_bulk_pickup_operations/);
  const sql=read("supabase/migrations/20261006142946_bulk_safisa_pickup.sql");
  assert.match(sql,/enable row level security/);assert.match(sql,/private.mark_supplier_order_all_picked_checked\(/);assert.match(sql,/set search_path = ''/);
  assert.ok(sql.indexOf("supplier_order_version_conflict")<sql.indexOf("insert into public.configuration_stock_balances"));
  assert.doesNotMatch(sql,/update public\.stock_balances|update public\.configuration_stock_balances|SKIP LOCKED|disable trigger/i);
});
