// Local sanitized UI only; all server actions are replaced by the fixture server.
import { Activity, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { InventoryWorkspace } from "../app/(authenticated)/estoque/inventory-workspace";
import { WorkspaceStateProvider } from "../components/workspace-state-provider";
import { SemanticBackProvider } from "../components/semantic-back-provider";
import { RouteMutationBoundary } from "../components/route-transient-state";
import type { InventoryData } from "../lib/inventory-types";
import type { PhysicalCatalogRequest, PhysicalCatalogSnapshot } from "../lib/physical-catalog-management";

const id = "95000000-0000-4000-8000-000000000001";
let scenario = "normal";
let snapshot: PhysicalCatalogSnapshot;
const receipts = new Map();
function reset() {
  snapshot = { id, code: scenario === "long" ? "NK95-RESERVATORIO-CILINDRO-PRIMARIO-APLICACAO-COMPATIVEL-".repeat(3).slice(0,120) : "NK95-P01",
    description: scenario === "long" ? "Reservatório de óleo com adaptador para servoembreagem e suporte de aplicação. ".repeat(10).slice(0,500) : "Peça de teste sanitizada",
    itemType: "LOOSE_PART", model: null, isActive: true, quantity: scenario === "long" ? 2147483647 : 15, version: "a".repeat(32),
    dependencies: { configurations: 0, recipes: scenario === "blocked" ? 1 : 0, compatibilities: 0, applications: 0, pendingOrders: 0 } };
  receipts.clear();
}
reset();
Object.assign(window, { __nk95Fixture: {
  preview: async () => ({ ok: true, snapshot: { ...snapshot } }),
  manage: async (request: PhysicalCatalogRequest, key: string) => {
    if (scenario === "stale") return { ok: false, stale: true, error: "O produto ou saldo mudou. Atualize a prévia antes de confirmar." };
    if (receipts.has(key)) return receipts.get(key);
    snapshot = { ...snapshot, ...(request.operation === "ARCHIVE" ? { isActive: false, quantity: 0 } : request.operation === "EDIT" ? { code: request.code, description: request.description } : { code: request.code, description: request.description, quantity: 0 }) };
    const result = { ok: true, receipt: { item: snapshot, operation: request.operation, idempotentReplay: false } };
    receipts.set(key, result);
    if (scenario === "uncertain") return { ok: false, uncertain: true, error: "Conexão interrompida. Verifique a mesma tentativa para evitar duplicação." };
    return result;
  },
} });
function Fixture() {
  const [visible, setVisible] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => { const update = () => setRevision(n => n + 1); window.addEventListener("nk95-refresh",update); return () => window.removeEventListener("nk95-refresh",update); }, []);
  const item = { ...snapshot, itemType: "LOOSE_PART" as const, typeLabel: "Peça avulsa", model: null, looseQuantity: snapshot.quantity,
    totalQuantity: snapshot.quantity, mountedQuantity: 0, minimumStock: 0, state: "AVAILABLE" as const, compatibleKitImages: [] };
  const inventory = { physicalItems: snapshot.isActive ? [item] : [], configurations: [], bundles: [], physicalCatalogCount: 1, configurationCatalogCount: 0,
    summary: { completeBoxesTotal: 0, looseServoTotal: 0, looseKitTotal: 0, repairKitTotal: 0, loosePartTotal: snapshot.quantity,
      lowStockItems: 0, outOfStockItems: 0 } } as InventoryData;
  return <WorkspaceStateProvider userId={id}><SemanticBackProvider>
    <div className="relative z-[120] flex flex-wrap items-center gap-2 p-2 text-sm">
      <p>Fixture local sanitizada — sem conexão com produção</p>
      <label>Cenário<select aria-label="Cenário" className="min-h-11 rounded border px-2" onChange={e => { scenario = e.target.value; reset(); setRevision(n => n + 1); }}>
        <option value="normal">Normal</option><option value="blocked">Com vínculo</option><option value="stale">Stale</option><option value="uncertain">Resultado incerto</option><option value="long">Texto longo / saldo máximo</option>
      </select></label>
      <button className="nk-focus min-h-11 rounded border px-2" type="button" onClick={() => setVisible(v => !v)}>{visible ? "Ocultar Activity" : "Reabrir Activity"}</button>
      <span className="sr-only">Revisão {revision}</span>
    </div>
    <Activity mode={visible ? "visible" : "hidden"}><main className="mx-auto max-w-7xl px-3 py-4 sm:px-6"><RouteMutationBoundary>
      <InventoryWorkspace inventory={inventory} />
    </RouteMutationBoundary></main></Activity>
  </SemanticBackProvider></WorkspaceStateProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
