export default function InventoryLoading() {
  return (
    <main
      className="mx-auto w-full max-w-7xl animate-pulse px-3 py-4 sm:px-6 sm:py-6 lg:px-8"
      aria-busy="true"
      aria-label="Carregando estoque"
    >
      <div className="h-9 w-32 rounded-lg bg-border-neutral/60" />
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
