export default function HistoryLoading() {
  return (
    <main
      className="mx-auto w-full max-w-6xl animate-pulse px-4 py-7 sm:px-6 sm:py-10 lg:px-8"
      aria-busy="true"
      aria-label="Carregando histórico"
    >
      <div className="h-11 w-36 rounded-xl bg-slate-200" />
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
