export default function VehicleApplicationsLoading() {
  return (
    <main
      aria-label="Carregando aplicações"
      className="mx-auto w-full max-w-7xl animate-pulse px-3 py-5 sm:px-6 sm:py-8 lg:px-8"
    >
      <div className="h-10 w-52 rounded-xl bg-slate-200" />
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
