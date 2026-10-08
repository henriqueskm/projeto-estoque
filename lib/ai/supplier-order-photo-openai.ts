import "server-only";
import {
  parseSupplierOrderPhotoExtraction, type SupplierOrderPhotoMimeType,
} from "@/lib/assistant-supplier-order-photo-contract";
import { extractionSchema, systemInstruction } from "@/lib/ai/supplier-order-photo-instructions";
import { OpenAIMediaProviderError, requestOpenAIMedia, resolveOpenAIMediaModel } from "@/lib/ai/openai-media-provider";

export const supplierOrderPhotoOpenAIBudgetMs = 12_000;
export const resolveSupplierOrderPhotoFallbackModel = () =>
  resolveOpenAIMediaModel(process.env.OPENAI_PHOTO_FALLBACK_MODEL, "gpt-6-luna");

export function supportsOpenAIOrderPhoto(mimeType: SupplierOrderPhotoMimeType) {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
}

export async function extractSupplierOrderPhotoWithOpenAI(input: {
  bytes: Uint8Array; mimeType: SupplierOrderPhotoMimeType;
  budgetMs?: number; apiKey?: string; fetcher?: typeof fetch;
}) {
  const model = resolveSupplierOrderPhotoFallbackModel();
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
      text: { format: { type: "json_schema", name: "supplier_order_photo", strict: true, schema: extractionSchema } },
    }),
  });
  const response = result as { status?: unknown; output?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }> } | null;
  if (!response || response.status !== "completed" || !Array.isArray(response.output)) {
    throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
  }
  const parts: string[] = [];
  for (const item of response.output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type !== "output_text" || typeof content.text !== "string") {
        throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
      }
      parts.push(content.text);
    }
  }
  const output = parts.join("").trim();
  if (!output) throw new OpenAIMediaProviderError("PROVIDER_EMPTY_OUTPUT", model);
  let parsed: unknown;
  try { parsed = JSON.parse(output); }
  catch { throw new OpenAIMediaProviderError("PROVIDER_INVALID_JSON", model); }
  const extraction = parseSupplierOrderPhotoExtraction(parsed);
  if (!extraction) throw new OpenAIMediaProviderError("PROVIDER_SCHEMA_INVALID", model);
  return extraction;
}
