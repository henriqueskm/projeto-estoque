import { connection } from "next/server";
import { requireActiveProfile } from "@/lib/auth";
import { loadInventoryReportData } from "@/lib/inventory-report-data";
import { RouteMutationBoundary } from "@/components/route-transient-state";
import { InventoryReportWorkspace } from "./report-workspace";

export default async function InventoryReportPage() {
  await connection();
  await requireActiveProfile();
  let result;
  try {
    result = await loadInventoryReportData();
  } catch {
    return <main data-nk-perf-ready="/relatorio-estoque" className="mx-auto max-w-7xl px-3 py-6 sm:px-6">
      <h1 className="text-2xl font-black text-text-primary">Relatório de estoque</h1>
      <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-900">Não foi possível carregar o relatório completo. Atualize a página para tentar novamente.</p>
    </main>;
  }
  return <main data-nk-perf-ready="/relatorio-estoque" className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
    <RouteMutationBoundary><InventoryReportWorkspace {...result} /></RouteMutationBoundary>
  </main>;
}
