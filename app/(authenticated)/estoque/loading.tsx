export default function InventoryLoading() {
  return (
    <main
      data-nk-perf-shell="/estoque"
      className="mx-auto w-full max-w-7xl px-3 py-4 motion-safe:animate-pulse sm:px-6 sm:py-6 lg:px-8"
      aria-busy="true"
      aria-label="Carregando estoque"
    >
      <h1 className="text-2xl font-black text-text-primary sm:text-3xl">Estoque</h1>
      <p className="mt-1 text-sm text-text-muted">Carregando saldos atuais…</p>
      <div className="mt-3 grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-14 rounded-xl border border-border-neutral bg-surface"
          />
        ))}
      </div>
      <div className="mt-3 h-12 rounded-xl bg-border-neutral/60" />
      <div className="mt-5 space-y-2">
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="h-14 rounded-xl border border-border-neutral bg-surface"
          />
        ))}
      </div>
    </main>
  );
}
