import "server-only";
import { OpenAIMediaProviderError, requestOpenAIMedia, resolveOpenAIMediaModel } from "@/lib/ai/openai-media-provider";

export const defaultAssistantModel = "gpt-6-luna";
export function resolveAssistantModel() {
  return resolveOpenAIMediaModel(process.env.OPENAI_ASSISTANT_MODEL, defaultAssistantModel);
}

// Transport schema is the documented subset. Canonical parsers still enforce
// string lengths/uniqueness; removing transport keywords does not relax them.
export function toOpenAIStrictSchema(schema: object): object {
  return JSON.parse(JSON.stringify(schema, (key, value) =>
    ["minLength", "maxLength", "uniqueItems"].includes(key) ? undefined : value));
}

// REST responses do not have the SDK-only output_text convenience property.
// Reject refusal/incomplete/unknown content rather than treating it as prose.
export function readOpenAIResponseText(value: unknown, model: string): string {
  const result = value as { status?: unknown; output?: unknown } | null;
  if (!result || result.status !== "completed" || !Array.isArray(result.output)) {
    throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
  }
  const parts: string[] = [];
  for (const item of result.output) {
    if (item?.type === "reasoning") continue;
    if (item?.type !== "message") throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
    if (item.role !== "assistant" || !Array.isArray(item.content)) {
      throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
    }
    for (const content of item.content) {
      if (content?.type !== "output_text" || typeof content.text !== "string") {
        throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
      }
      parts.push(content.text);
    }
  }
  const text = parts.join("").trim();
  if (!text) throw new OpenAIMediaProviderError("PROVIDER_EMPTY_OUTPUT", model);
  return text;
}

export async function requestAssistantResponse(input: {
  model: string; instructions: string; input: string;
  maxOutputTokens: number; budgetMs: number;
  format?: { type: "json_schema"; name: string; strict: true; schema: object };
  fetcher?: typeof fetch; apiKey?: string;
}) {
  const startedAt = performance.now();
  try {
    const result = await requestOpenAIMedia({
      endpoint: "responses", model: input.model, json: true,
      budgetMs: input.budgetMs, fetcher: input.fetcher, apiKey: input.apiKey,
      body: JSON.stringify({
        model: input.model, store: false, reasoning: { effort: "none" },
        max_output_tokens: input.maxOutputTokens, instructions: input.instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: input.input }] }],
        ...(input.format ? { text: { format: { ...input.format, schema: toOpenAIStrictSchema(input.format.schema) } } } : {}),
      }),
    });
    const text = readOpenAIResponseText(result, input.model);
    const usage = (result as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
    console.info("assistant_openai", {
      provider: "openai", model: input.model, requestType: input.format ? "router" : "text",
      outcome: "SUCCESS", durationMs: Math.round(performance.now() - startedAt),
      inputTokens: Number.isSafeInteger(usage?.input_tokens) ? usage?.input_tokens : null,
      outputTokens: Number.isSafeInteger(usage?.output_tokens) ? usage?.output_tokens : null,
    });
    return text;
  } catch (error) {
    console.warn("assistant_openai", {
      provider: "openai", model: input.model, requestType: input.format ? "router" : "text",
      outcome: error instanceof OpenAIMediaProviderError ? error.internalCode : "UNEXPECTED",
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}
