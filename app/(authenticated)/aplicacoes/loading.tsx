export default function VehicleApplicationsLoading() {
  return (
    <main
      data-nk-perf-shell="/aplicacoes"
      aria-busy="true"
      aria-label="Carregando aplicações"
      className="mx-auto w-full max-w-7xl px-3 py-5 motion-safe:animate-pulse sm:px-6 sm:py-8 lg:px-8"
    >
      <h1 className="text-2xl font-black text-text-primary sm:text-3xl">Aplicações</h1>
      <div className="mt-3 h-6 w-72 max-w-full rounded-lg bg-slate-200" />
      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="h-48 rounded-2xl border border-border-neutral bg-surface sm:h-52"
          />
        ))}
      </div>
    </main>
  );
}
