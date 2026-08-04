import { revalidatePath } from "next/cache";
import { handleConfigurationAssemblyPost } from "@/lib/ai/configuration-assembly-action-http";
import { confirmAssistantConfigurationAssembly } from "@/lib/assistant-configuration-assembly";

export async function POST(request: Request) {
  return handleConfigurationAssemblyPost(request, {
    confirm: confirmAssistantConfigurationAssembly,
    revalidate: () => {
      ["/", "/estoque", "/historico", "/estatisticas"].forEach((path) => revalidatePath(path));
    },
  });
}
