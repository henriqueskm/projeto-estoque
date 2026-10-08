// Local-only browser harness. Never imported by the app and never uses Supabase.
import { Activity, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { InventoryReportWorkspace } from "../app/(authenticated)/relatorio-estoque/report-workspace";
import { WorkspaceStateProvider } from "../components/workspace-state-provider";
import { SemanticBackProvider } from "../components/semantic-back-provider";
import { RouteMutationBoundary } from "../components/route-transient-state";
import { inventoryReportCategories, isInventoryReportOrder, type InventoryReport, type InventoryReportCategory } from "../lib/inventory-report";

const standard: InventoryReport = {
  codeCount: 7, unitCount: 23,
  lines: [
    { identity: "config:1", category: "SERVO_WITH_KIT", code: "1B", quantity: 3 },
    { identity: "config:2", category: "SERVO_WITH_KIT", code: "2A", quantity: 5 },
    { identity: "servo:1", category: "SERVO_LOOSE", code: "MBF-015", quantity: 2 },
    { identity: "kit:1", category: "INSTALLATION_KIT", code: "KT-18", quantity: 6 },
    { identity: "repair:1", category: "REPAIR_KIT", code: "RP-01", quantity: 2 },
    { identity: "loose:1", category: "LOOSE_PART", code: "CIL", quantity: 4 },
    { identity: "bundle:1", category: "BUNDLE", code: "1HC", quantity: 1 },
  ],
};
function Fixture() {
  const [order, setOrder] = useState<InventoryReportCategory[]>([...inventoryReportCategories]);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const saved = (event: Event) => { const value = (event as CustomEvent).detail; if (isInventoryReportOrder(value)) setOrder(value); };
    const print = () => console.info("NK86 fixture afterprint", JSON.stringify({
      rows: document.querySelectorAll("[data-inventory-report-print] tbody tr").length,
      categories: [...document.querySelectorAll("[data-inventory-report-print] h2")].map(element => element.textContent),
      chromeHidden: getComputedStyle(document.getElementById("root")!).display === "none",
    }));
    window.addEventListener("nk86-fixture-save", saved);
    window.addEventListener("afterprint", print);
    return () => {
      window.removeEventListener("nk86-fixture-save", saved);
      window.removeEventListener("afterprint", print);
    };
  }, []);
  const scenario = new URLSearchParams(location.search).get("fixture");
  const report = scenario === "empty" ? { lines: [], codeCount: 0, unitCount: 0 } : scenario === "stress" ? {
    lines: [{ identity: "stress", category: "LOOSE_PART" as const, code: "KT-MBB-RESERVATORIO-COMPATIBILIDADE-100", quantity: 2147483647 }], codeCount: 1, unitCount: 2147483647,
  } : scenario === "many" ? {
    lines: Array.from({ length: 1100 }, (_, index) => ({ identity: `many:${index}`, category: "LOOSE_PART" as const, code: `TEST-${index + 1}`, quantity: 1 })), codeCount: 1100, unitCount: 1100,
  } : standard;
  return <WorkspaceStateProvider userId="86000000-0000-4000-8000-000000000001"><SemanticBackProvider>
    <div data-fixture-controls className="relative z-[120] p-2 text-xs">Fixture local sanitizada · nenhuma conexão com produção <button type="button" className="nk-focus min-h-11 rounded border px-2" onClick={() => setVisible(value => !value)}>{visible ? "Ocultar rota (Activity)" : "Reabrir rota (Activity)"}</button></div>
    <Activity mode={visible ? "visible" : "hidden"}><main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8"><RouteMutationBoundary>
      <InventoryReportWorkspace report={report} settings={{ categoryOrder: order, available: true, notice: null }} generatedAt="2026-10-08T12:00:00Z" />
    </RouteMutationBoundary></main></Activity>
  </SemanticBackProvider></WorkspaceStateProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
