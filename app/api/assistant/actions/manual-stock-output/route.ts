import { revalidatePath } from "next/cache";
import { handleManualStockOutputPost } from "@/lib/ai/manual-stock-output-action-http";
import { confirmAssistantManualStockOutput } from "@/lib/assistant-manual-stock-output";

export async function POST(request: Request) {
  return handleManualStockOutputPost(request, {
    confirm: confirmAssistantManualStockOutput,
    revalidate: () => {
      ["/", "/entrada", "/estoque", "/saida", "/estatisticas", "/historico"].forEach((path) => revalidatePath(path));
    },
  });
}
