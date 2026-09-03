import { AssistantHome } from "@/components/assistant-home";
import { loadAssistantAttention } from "@/lib/assistant-attention-data";

export default async function HomePage() {
  const attentionResult = await loadAssistantAttention();

  return (
    <AssistantHome
      attention={attentionResult.data}
      attentionError={attentionResult.error}
    />
  );
}
