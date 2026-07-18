export default function OutboundLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Carregando saída manual"
      className="mx-auto w-full max-w-7xl animate-pulse px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
    >
      <div className="mb-6 h-11 w-44 rounded-xl bg-brand-gold-soft" />
      <div className="mb-6 h-48 rounded-3xl bg-brand-charcoal" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="h-96 rounded-3xl border border-border-neutral bg-surface shadow-sm" />
        <div className="h-80 rounded-3xl border border-border-neutral bg-surface shadow-sm" />
      </div>
    </main>
  );
}
