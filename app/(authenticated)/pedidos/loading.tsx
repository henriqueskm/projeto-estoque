export default function SupplierOrdersLoading() {
  return (
    <main
      className="mx-auto w-full max-w-7xl animate-pulse px-3 py-4 sm:px-6 sm:py-6 lg:px-8"
      aria-busy="true"
      aria-label="Carregando pedidos"
    >
      <div className="h-9 w-36 rounded-lg bg-border-neutral/60" />
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-20 rounded-2xl border border-border-neutral bg-surface"
          />
        ))}
      </div>
      <div className="mt-4 h-20 rounded-2xl border border-border-neutral bg-surface" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-20 rounded-2xl border border-border-neutral bg-surface"
          />
        ))}
      </div>
    </main>
  );
}
