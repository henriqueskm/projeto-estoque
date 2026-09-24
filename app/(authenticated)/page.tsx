import { AssistantHome } from "@/components/assistant-home";
import { loadAssistantAttention } from "@/lib/assistant-attention-data";

export default function HomePage() {
  const attentionPromise = loadAssistantAttention();

  return <AssistantHome attentionPromise={attentionPromise} />;
}
