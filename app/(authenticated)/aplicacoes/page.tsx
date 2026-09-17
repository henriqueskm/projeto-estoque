import { ApplicationsBrandGrid } from "@/app/(authenticated)/aplicacoes/applications-brand-grid";
import { loadVehicleApplicationBrands } from "@/lib/vehicle-applications";

export default async function VehicleApplicationsPage() {
  const result = await loadVehicleApplicationBrands();

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-black tracking-[-0.025em] text-text-primary sm:text-4xl">
          Aplicações
        </h1>
        <p className="mt-2 text-base leading-7 font-semibold text-text-muted sm:text-lg">
          Encontre o kit pela marca e veículo.
        </p>
      </header>

      {!result.data ? (
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-5 text-sm leading-6 font-semibold text-red-900"
        >
          {result.error} Tente atualizar a página em alguns instantes.
        </div>
      ) : (
        <ApplicationsBrandGrid brands={result.data} />
      )}
    </main>
  );
}
