import { SupplierOrdersWorkspace } from "@/app/(authenticated)/pedidos/orders-workspace";
import { OrdersIcon } from "@/components/icons";
import { loadSupplierOrdersData } from "@/lib/supplier-orders-data";
import type { SupplierOrderView } from "@/lib/supplier-orders-types";

type SupplierOrdersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SupplierOrdersPage({
  searchParams,
}: SupplierOrdersPageProps) {
  const params = await searchParams;
  const requestedView = params.view;
  const requestedOrder = params.order;
  const view: SupplierOrderView =
    requestedView === "history" ? "history" : "active";
  const result = await loadSupplierOrdersData(view);
  const orderCandidate =
    typeof requestedOrder === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestedOrder,
    )
      ? requestedOrder
      : null;
  const initialOrderId =
    orderCandidate &&
    result.data?.summaries.some((order) => order.id === orderCandidate)
      ? orderCandidate
      : null;

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      {result.data ? (
        <SupplierOrdersWorkspace
          data={result.data}
          view={view}
          initialOrderId={initialOrderId}
        />
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
