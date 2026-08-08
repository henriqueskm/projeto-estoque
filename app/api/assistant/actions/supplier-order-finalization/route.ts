import { revalidatePath } from "next/cache";
import { confirmAssistantSupplierOrderFinalization } from "@/lib/assistant-supplier-order-finalization";
import { handleSupplierOrderFinalizationPost } from "@/lib/ai/supplier-order-finalization-action-http";

export async function POST(request: Request) {
  return handleSupplierOrderFinalizationPost(request, {
    confirm: confirmAssistantSupplierOrderFinalization,
    revalidate: () => revalidatePath("/pedidos"),
  });
}
