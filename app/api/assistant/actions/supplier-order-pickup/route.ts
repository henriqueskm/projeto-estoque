import { revalidatePath } from "next/cache";
import { handleSupplierOrderPickupPost } from "@/lib/ai/assistant-action-http";
import { confirmAssistantSupplierOrderPickup } from "@/lib/assistant-supplier-order-pickup";

export async function POST(request: Request) {
  return handleSupplierOrderPickupPost(request, {
    confirm: confirmAssistantSupplierOrderPickup,
    revalidate: () => revalidatePath("/pedidos"),
  });
}
