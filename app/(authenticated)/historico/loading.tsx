export default function HistoryLoading() {
  return (
    <main
      data-nk-perf-shell="/historico"
      className="mx-auto w-full max-w-6xl px-4 py-7 motion-safe:animate-pulse sm:px-6 sm:py-10 lg:px-8"
      aria-busy="true"
      aria-label="Carregando histórico"
    >
      <h1 className="text-2xl font-black text-text-primary sm:text-3xl">Histórico de movimentações</h1>
      <div className="mt-4 h-48 rounded-3xl bg-brand-charcoal" />
      <div className="mt-5 h-80 rounded-3xl border border-border-neutral bg-surface" />
      <div className="mt-6 grid gap-3">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-48 rounded-2xl border border-border-neutral bg-surface"
          />
        ))}
      </div>
      <span className="sr-only">Carregando histórico de movimentações.</span>
    </main>
  );
}
