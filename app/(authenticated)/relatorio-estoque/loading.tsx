export default function InventoryReportLoading() {
  return <main data-nk-perf-shell="/relatorio-estoque" aria-busy="true" className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
    <h1 className="text-2xl font-black text-text-primary sm:text-3xl">Relatório de estoque</h1>
    <p role="status" className="mt-2 text-sm text-text-muted">Carregando códigos e quantidades atuais…</p>
    <div aria-hidden="true" className="mt-6 h-64 rounded-xl border border-border-neutral bg-surface" />
  </main>;
}
