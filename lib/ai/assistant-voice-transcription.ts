import "server-only";
import { assistantVoiceMaxTranscriptLength } from "@/lib/assistant-voice-contract";
import { OpenAIMediaProviderError, requestOpenAIMedia, resolveOpenAIMediaModel } from "@/lib/ai/openai-media-provider";

export { OpenAIMediaProviderError as AssistantVoiceProviderError };
export const assistantVoiceProviderTimeoutMs = 22_000;
export const resolveAssistantVoiceModel = () =>
  resolveOpenAIMediaModel(process.env.OPENAI_TRANSCRIPTION_MODEL, "gpt-transcribe");

export const assistantVoiceTranscriptionKeywords = [
  "2A", "1B", "1H", "MBF-025", "MBF025", "KT-18", "091", "091/VF", "Safisa", "Servo", "Kit",
];
export const assistantVoiceTranscriptionPrompt =
  "Ditado operacional de estoque e Pedidos do Negócios K em português brasileiro. Preserve números, quantidades, códigos alfanuméricos, modelos e siglas. As palavras-chave são dicas: inclua-as somente quando forem faladas.";

export async function transcribeAssistantVoiceWithOpenAI(input: {
  file: File; apiKey?: string; fetcher?: typeof fetch; budgetMs?: number;
}) {
  const model = resolveAssistantVoiceModel();
  const body = new FormData();
  body.append("file", input.file);
  body.append("model", model);
  body.append("languages[]", "pt");
  body.append("prompt", assistantVoiceTranscriptionPrompt);
  for (const keyword of assistantVoiceTranscriptionKeywords) body.append("keywords[]", keyword);
  const result = await requestOpenAIMedia({
    endpoint: "audio/transcriptions", model, body,
    apiKey: input.apiKey, fetcher: input.fetcher,
    budgetMs: input.budgetMs ?? assistantVoiceProviderTimeoutMs,
  });
  const record = result && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown> : null;
  const transcript = typeof record?.text === "string" ? record.text.trim() : "";
  if (!transcript) throw new OpenAIMediaProviderError("PROVIDER_EMPTY_OUTPUT", model);
  if (transcript.length > assistantVoiceMaxTranscriptLength) throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
  return transcript;
}
