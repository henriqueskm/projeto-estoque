import { connection } from "next/server";
import { AssistantHome } from "@/components/assistant-home";
import { loadAssistantAttention } from "@/lib/assistant-attention-data";

async function loadAttentionOnNavigation() {
  await connection();
  return loadAssistantAttention();
}

export default function HomePage() {
  const attentionPromise = loadAttentionOnNavigation();

  return <AssistantHome attentionPromise={attentionPromise} />;
}
