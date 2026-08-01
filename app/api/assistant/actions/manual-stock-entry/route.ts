import { revalidatePath } from "next/cache";
import { handleManualStockEntryPost } from "@/lib/ai/stock-entry-action-http";
import { confirmAssistantManualStockEntry } from "@/lib/assistant-manual-stock-entry";

export async function POST(request: Request) {
  return handleManualStockEntryPost(request, {
    confirm: confirmAssistantManualStockEntry,
    revalidate: () => {
      ["/", "/entrada", "/estoque", "/saida", "/estatisticas", "/historico"].forEach((path) => revalidatePath(path));
    },
  });
}
