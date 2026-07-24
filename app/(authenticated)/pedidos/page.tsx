import { SupplierOrdersWorkspace } from "@/app/(authenticated)/pedidos/orders-workspace";
import { OrdersIcon } from "@/components/icons";
import { loadSupplierOrdersData } from "@/lib/supplier-orders-data";

export default async function SupplierOrdersPage() {
  const result = await loadSupplierOrdersData();

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      {result.data ? (
        <SupplierOrdersWorkspace data={result.data} />
      ) : (
        <>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-charcoal text-brand-gold">
              <OrdersIcon className="size-5" />
            </span>
            <div>
              <p className="text-[0.68rem] font-black tracking-[0.16em] text-brand-gold-ink uppercase">
                Fornecedores
              </p>
              <h1 className="text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
                Pedidos
              </h1>
            </div>
          </div>
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
