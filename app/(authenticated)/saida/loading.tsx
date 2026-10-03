export default function OutboundLoading() {
  return (
    <main
      data-nk-perf-shell="/saida"
      aria-busy="true"
      aria-label="Carregando saída manual"
      className="mx-auto w-full max-w-7xl px-4 py-6 motion-safe:animate-pulse sm:px-6 sm:py-8 lg:px-8"
    >
      <h1 className="text-2xl font-black text-text-primary sm:text-3xl">Saída manual</h1>
      <p className="mt-1 mb-6 text-sm text-text-muted">Carregando catálogo e saldos atuais…</p>
      <div className="mb-6 h-48 rounded-3xl bg-brand-charcoal" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="h-96 rounded-3xl border border-border-neutral bg-surface shadow-sm" />
        <div className="h-80 rounded-3xl border border-border-neutral bg-surface shadow-sm" />
      </div>
    </main>
  );
}
