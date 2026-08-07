import { SafisaPortal } from "@/components/safisa-portal";
import { requireSafisaSession } from "@/lib/safisa-auth";
import { getSafisaOrder } from "@/lib/safisa-portal-data";
import { createClient } from "@/lib/supabase/server";
import type { SafisaOrderDetail } from "@/lib/safisa-portal-types";

type Props = { searchParams: Promise<{ pedido?: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function SafisaPage({ searchParams }: Props) {
  const session = await requireSafisaSession();
  const { pedido } = await searchParams;
  let selectedOrder: SafisaOrderDetail | null = null;
  let loadMessage: string | undefined;

  if (pedido) {
    if (!UUID_PATTERN.test(pedido) || !session.orderList.orders.some((order) => order.supplierOrderId === pedido)) {
      loadMessage = "Este pedido não está disponível para sua conta.";
    } else {
      try {
        const supabase = await createClient();
        selectedOrder = await getSafisaOrder(supabase, pedido);
      } catch {
        loadMessage = "O pedido foi atualizado ou deixou de estar disponível.";
      }
    }
  }

  return (
    <SafisaPortal
      displayName={session.displayName}
      orders={session.orderList.orders}
      selectedOrder={selectedOrder}
      loadMessage={loadMessage}
    />
  );
}
