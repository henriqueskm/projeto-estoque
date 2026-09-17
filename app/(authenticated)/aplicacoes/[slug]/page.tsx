import { notFound } from "next/navigation";
import { ApplicationsWorkspace } from "@/app/(authenticated)/aplicacoes/[slug]/applications-workspace";
import { loadVehicleApplicationsByBrand } from "@/lib/vehicle-applications";

type BrandApplicationsPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function BrandApplicationsPage({
  params,
}: BrandApplicationsPageProps) {
  const { slug } = await params;
  const result = await loadVehicleApplicationsByBrand(slug);

  if (!result.error && !result.brand) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-7 lg:px-8">
      {result.brand &&
      result.applications &&
      result.authoritativeSourceKitCodes ? (
        <ApplicationsWorkspace
          brand={result.brand}
          applications={result.applications}
          authoritativeSourceKitCodes={result.authoritativeSourceKitCodes}
        />
      ) : (
        <>
          <h1 className="text-2xl font-black text-text-primary">Aplicações</h1>
          <div
            role="alert"
            className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-5 text-sm leading-6 font-semibold text-red-900"
          >
            {result.error} Tente atualizar a página em alguns instantes.
          </div>
        </>
      )}
    </main>
  );
}
