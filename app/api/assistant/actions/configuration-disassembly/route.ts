import { revalidatePath } from "next/cache";
import { confirmAssistantConfigurationDisassembly } from "@/lib/assistant-configuration-disassembly";
import { handleConfigurationDisassemblyPost } from "@/lib/ai/configuration-disassembly-action-http";

export async function POST(request: Request) {
  return handleConfigurationDisassemblyPost(request, {
    confirm: confirmAssistantConfigurationDisassembly,
    revalidate: () => {
      ["/", "/estoque", "/historico", "/estatisticas"].forEach((path) => revalidatePath(path));
    },
  });
}
