// LOCAL synthetic data/actions only: exercise the real Pedidos workspace safely.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SupplierOrdersWorkspace } from "../app/(authenticated)/pedidos/orders-workspace";
import { WorkspaceStateProvider } from "../components/workspace-state-provider";
import { SemanticBackProvider } from "../components/semantic-back-provider";
import type { SupplierOrderSummary, SupplierOrderItem } from "../lib/supplier-orders-types";
const id="10000000-0100-4000-8000-000000000100", date="2026-10-23T04:00:00Z";
let closed=false;
const order: SupplierOrderSummary={id,negotiationNumber:"1001",orderDate:"2026-10-23",notes:null,createdByName:"Operador fixture",createdAt:date,updatedAt:date,
  cancelledAt:null,cancelledByName:null,cancellationNote:null,finalizedAt:null,finalizedByName:null,finalizationNote:null,isFinalized:false,isActiveOrder:true,isInHistory:false,closureKind:null,closedAt:null,closedByName:null,
  lineCount:1,orderedQuantity:3,readyQuantity:3,pickedQuantity:0,cancelledQuantity:0,waitingPickupQuantity:3,waitingReadyQuantity:0,readyWaitingPickupQuantity:3,stockedQuantity:0,waitingStockQuantity:0,pickupPercentage:0,status:"PENDING"};
const item: SupplierOrderItem={id:"10000000-0100-4000-8000-000000001000",supplierOrderId:id,itemId:"d9bfc725-87a3-4194-8f51-bdc49d95bd8c",commercialConfigurationId:null,commercialConfigurationCodeId:null,
  codeSnapshot:"1",descriptionSnapshot:"SERVO MBF-015 — fixture sanitizada",modelSnapshot:"MBF-015",itemTypeSnapshot:"SERVO",commercialCodeSnapshot:null,imageUrl:null,compatibleKitImages:[],orderedQuantity:3,readyQuantity:3,pickedQuantity:0,
  stockedQuantity:0,cancelledQuantity:0,waitingPickupQuantity:3,waitingReadyQuantity:0,readyWaitingPickupQuantity:3,waitingStockQuantity:0,position:0,notes:null,createdAt:date,updatedAt:date};
window.fetch=async input=>{
  const url=String(input);
  if(url.includes("/media"))return Response.json({items:[]});
  if(closed && url.includes("view=history"))return Response.json({view:"history",order:{...order,status:"COMPLETED",isInHistory:true,isActiveOrder:false,isFinalized:true,closureKind:"FINALIZED",finalizedAt:date,closedAt:date,finalizedByName:"Operador fixture",readyWaitingPickupQuantity:0,waitingPickupQuantity:0,pickedQuantity:3,stockedQuantity:3,pickupPercentage:100},items:[{...item,pickedQuantity:3,stockedQuantity:3,readyWaitingPickupQuantity:0,waitingPickupQuantity:0}],events:[]});
  if(url.startsWith("/api/supplier-orders/"))return closed ? Response.json({error:"Pedido não está mais ativo."},{status:404}) : Response.json({view:"active",order,items:[item],events:[]});
  throw Error("Network outside fixture scope");
};
Object.assign(window,{__nk100Pickup:async()=>{
  closed=true;
  return{ok:true,receipt:{supplierOrderId:id,negotiationNumber:"1001",lineCount:1,orderedQuantity:3,pickedQuantity:3,cancelledQuantity:0,waitingPickupQuantity:0,stockedQuantity:3,waitingStockQuantity:0,pickupPercentage:100,status:"COMPLETED",updatedAt:date,isInHistory:true,closureKind:"FINALIZED",
    automaticStockEntry:{supplierOrderStockEntryId:id,movementBatchId:id,lineCount:1,quantity:3,createdAt:date,pickedQuantityDelta:3,idempotentReplay:false}}};
}});
function Fixture(){
  const [complete,setComplete]=useState(false);
  useEffect(()=>{const refresh=()=>setComplete(closed);window.addEventListener("nk100-refresh",refresh);return()=>window.removeEventListener("nk100-refresh",refresh);},[]);
  return <WorkspaceStateProvider userId={id}><SemanticBackProvider><main className="mx-auto max-w-7xl px-3 py-4 sm:px-6">
    <p className="mb-4 text-sm">Fixture local — sem Supabase ou dados reais. Confirmação aqui é simulada.</p>
    <SupplierOrdersWorkspace data={{view:"active",summaries:complete?[]:[order]}} view="active" initialOrderId={null}/>
  </main></SemanticBackProvider></WorkspaceStateProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
