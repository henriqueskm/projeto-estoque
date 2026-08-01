import { revalidatePath } from "next/cache";
import { handleSupplierOrderStockEntryPost } from "@/lib/ai/stock-entry-action-http";
import { confirmAssistantSupplierOrderStockEntry } from "@/lib/assistant-supplier-order-stock-entry";

export async function POST(request: Request) {
  return handleSupplierOrderStockEntryPost(request, {
    confirm: confirmAssistantSupplierOrderStockEntry,
    revalidate: () => {
      ["/", "/pedidos", "/estoque", "/entrada", "/estatisticas", "/historico"].forEach((path) => revalidatePath(path));
    },
  });
}
