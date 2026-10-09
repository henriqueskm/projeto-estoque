import "server-only";
import {
  parseSupplierOrderPhotoExtraction, type SupplierOrderPhotoMimeType,
} from "@/lib/assistant-supplier-order-photo-contract";
import { extractionSchema, systemInstruction } from "@/lib/ai/supplier-order-photo-instructions";
import { OpenAIMediaProviderError, requestOpenAIMedia, resolveOpenAIMediaModel } from "@/lib/ai/openai-media-provider";
import { readOpenAIResponseText, toOpenAIStrictSchema } from "@/lib/ai/openai-responses";

export const supplierOrderPhotoOpenAIBudgetMs = 12_000;
export const resolveSupplierOrderPhotoModel = () =>
  resolveOpenAIMediaModel(process.env.OPENAI_PHOTO_MODEL ?? process.env.OPENAI_PHOTO_FALLBACK_MODEL, "gpt-6-luna");

export function supportsOpenAIOrderPhoto(mimeType: SupplierOrderPhotoMimeType) {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
}

export async function extractSupplierOrderPhotoWithOpenAI(input: {
  bytes: Uint8Array; mimeType: SupplierOrderPhotoMimeType;
  budgetMs?: number; apiKey?: string; fetcher?: typeof fetch;
}) {
  const startedAt = performance.now();
  const model = resolveSupplierOrderPhotoModel();
  if (!supportsOpenAIOrderPhoto(input.mimeType)) {
    throw new OpenAIMediaProviderError("PROVIDER_HTTP_400", model);
  }
  const result = await requestOpenAIMedia({
    endpoint: "responses", model, json: true,
    budgetMs: input.budgetMs ?? supplierOrderPhotoOpenAIBudgetMs,
    apiKey: input.apiKey, fetcher: input.fetcher,
    body: JSON.stringify({
      model, store: false, reasoning: { effort: "none" }, max_output_tokens: 4_000,
      instructions: systemInstruction,
      input: [{
        role: "user", content: [
          { type: "input_text", text: "Extraia os campos visuais deste documento conforme o schema estrito." },
          { type: "input_image", image_url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`, detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: "supplier_order_photo", strict: true, schema: toOpenAIStrictSchema(extractionSchema) } },
    }),
  });
  const output = readOpenAIResponseText(result, model);
  let parsed: unknown;
  try { parsed = JSON.parse(output); }
  catch { throw new OpenAIMediaProviderError("PROVIDER_INVALID_JSON", model); }
  const extraction = parseSupplierOrderPhotoExtraction(parsed);
  if (!extraction) throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
  const usage = (result as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
  console.info("assistant_openai", {
    provider: "openai", model, requestType: "photo", outcome: "SUCCESS",
    durationMs: Math.round(performance.now() - startedAt),
    inputTokens: Number.isSafeInteger(usage?.input_tokens) ? usage?.input_tokens : null,
    outputTokens: Number.isSafeInteger(usage?.output_tokens) ? usage?.output_tokens : null,
  });
  return extraction;
}
