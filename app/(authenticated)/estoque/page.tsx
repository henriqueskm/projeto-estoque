import {
  InventoryWorkspace,
  type InventoryStatusFilter,
} from "@/app/(authenticated)/estoque/inventory-workspace";
import { loadInventoryData } from "@/lib/inventory-data";

type InventoryPageProps = {
  searchParams: Promise<{
    status?: string | string[];
  }>;
};

function parseInitialStatusFilter(
  value: string | string[] | undefined,
): InventoryStatusFilter {
  const status = Array.isArray(value) ? value[0] : value;

  return status === "attention" || status === "low" || status === "zero"
    ? status
    : "all";
}

export default async function InventoryPage({
  searchParams,
}: InventoryPageProps) {
  const initialStatusFilter = parseInitialStatusFilter(
    (await searchParams).status,
  );
  const inventoryResult = await loadInventoryData();

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      {!inventoryResult.data ? (
        <>
          <header>
            <p className="text-[0.68rem] font-black tracking-[0.16em] text-brand-gold-ink uppercase">
              Consulta operacional
            </p>
            <h1 className="text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
              Estoque
            </h1>
          </header>
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-5 py-5 text-sm leading-6 font-semibold text-red-900"
          >
            {inventoryResult.error} Tente atualizar a página em alguns
            instantes.
          </div>
        </>
      ) : (
        <InventoryWorkspace
          key={initialStatusFilter}
          inventory={inventoryResult.data}
          initialStatusFilter={initialStatusFilter}
        />
      )}
    </main>
  );
}
