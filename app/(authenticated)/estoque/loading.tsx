export default function InventoryLoading() {
  return (
    <main
      className="mx-auto w-full max-w-7xl animate-pulse px-4 py-7 sm:px-6 sm:py-10 lg:px-8"
      aria-busy="true"
      aria-label="Carregando estoque"
    >
      <div className="h-12 w-36 rounded-xl bg-border-neutral/60" />
      <div className="mt-5 h-44 rounded-3xl bg-brand-charcoal/90" />
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-28 rounded-2xl border border-border-neutral bg-surface"
          />
        ))}
      </div>
      <div className="mt-6 h-14 rounded-2xl bg-border-neutral/60" />
      <div className="mt-4 h-40 rounded-2xl border border-border-neutral bg-surface" />
      <div className="mt-4 grid gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-36 rounded-2xl border border-border-neutral bg-surface"
          />
        ))}
      </div>
    </main>
  );
}
