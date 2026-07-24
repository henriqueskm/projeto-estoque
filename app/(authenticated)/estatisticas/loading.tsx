export default function StatisticsLoading() {
  return (
    <main
      className="mx-auto w-full max-w-7xl animate-pulse px-3 py-4 sm:px-6 sm:py-6 lg:px-8"
      aria-busy="true"
      aria-label="Carregando estatísticas"
    >
      <div className="h-8 w-40 rounded-lg bg-border-neutral/60" />
      <div className="mt-4 h-12 rounded-2xl bg-border-neutral/60" />
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-28 rounded-2xl border border-border-neutral bg-surface"
          />
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="h-80 rounded-2xl border border-border-neutral bg-surface xl:col-span-2" />
        <div className="h-80 rounded-2xl border border-border-neutral bg-surface" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="h-72 rounded-2xl border border-border-neutral bg-surface" />
        <div className="h-72 rounded-2xl border border-border-neutral bg-surface" />
      </div>
    </main>
  );
}
