import "server-only";
import type { SupplierOrderPhotoExtraction, SupplierOrderPhotoMimeType } from "@/lib/assistant-supplier-order-photo-contract";
import { extractSupplierOrderPhotoWithOpenAI, resolveSupplierOrderPhotoModel, supportsOpenAIOrderPhoto } from "@/lib/ai/supplier-order-photo-openai";
import { OpenAIMediaProviderError, withMediaDeadline } from "@/lib/ai/openai-media-provider";
import { prepareSupplierOrderPhotoForOpenAI, SupplierOrderPhotoConversionError } from "@/lib/ai/supplier-order-photo-heic";

export const supplierOrderPhotoGlobalBudgetMs = 20_000;
export type PhotoMediaTrace = {
  primaryProvider: "openai"; finalProvider: "openai";
  fallbackUsed: false; fallbackReason: null; model: string;
  providerPath: "responses"; providerDurationMs: number;
  providerAttempts: Array<{ provider: "openai"; path: "responses"; internalCode: string; providerStatus: number | null }>;
};
export class SupplierOrderPhotoMediaError extends Error {
  readonly internalCode: string;
  readonly providerStatus: number | null;
  readonly trace: PhotoMediaTrace;
  constructor(internalCode: string, providerStatus: number | null, trace: PhotoMediaTrace) {
    super("Photo media extraction failed"); this.name = "SupplierOrderPhotoMediaError";
    this.internalCode = internalCode; this.providerStatus = providerStatus; this.trace = trace;
  }
}

// One provider, one attempt. Catalog/lookup failures remain outside this boundary.
export async function extractSupplierOrderPhoto(input: {
  bytes: Uint8Array; mimeType: SupplierOrderPhotoMimeType;
  onProviderTrace?: (trace: PhotoMediaTrace) => void;
}, dependencies: {
  openai?: typeof extractSupplierOrderPhotoWithOpenAI; globalBudgetMs?: number;
} = {}): Promise<SupplierOrderPhotoExtraction> {
  const start = performance.now();
  const budget = Math.min(dependencies.globalBudgetMs ?? supplierOrderPhotoGlobalBudgetMs, supplierOrderPhotoGlobalBudgetMs);
  const trace: PhotoMediaTrace = {
    primaryProvider: "openai", finalProvider: "openai", fallbackUsed: false, fallbackReason: null,
    model: resolveSupplierOrderPhotoModel(), providerPath: "responses", providerDurationMs: 0, providerAttempts: [],
  };
  try {
    const prepared = await prepareSupplierOrderPhotoForOpenAI(input, { timeoutMs: Math.min(8_000, budget) });
    if (!supportsOpenAIOrderPhoto(prepared.mimeType)) throw new OpenAIMediaProviderError("UNSUPPORTED_IMAGE_FORMAT", trace.model);
    const remaining = Math.min(12_000, Math.max(0, budget - (performance.now() - start)));
    const extraction = await withMediaDeadline(remaining, () =>
      (dependencies.openai ?? extractSupplierOrderPhotoWithOpenAI)({ ...prepared, budgetMs: remaining }),
    () => new OpenAIMediaProviderError("PROVIDER_TIMEOUT", trace.model));
    trace.providerAttempts.push({ provider: "openai", path: "responses", internalCode: "SUCCESS", providerStatus: null });
    return extraction;
  } catch (error) {
    if (error instanceof SupplierOrderPhotoConversionError) throw error;
    const failure = error instanceof OpenAIMediaProviderError ? error : null;
    if (failure?.internalCode !== "UNSUPPORTED_IMAGE_FORMAT") {
      trace.providerAttempts.push({ provider: "openai", path: "responses", internalCode: failure?.internalCode ?? "UNEXPECTED", providerStatus: failure?.providerStatus ?? null });
    }
    throw new SupplierOrderPhotoMediaError(failure?.internalCode ?? "UNEXPECTED", failure?.providerStatus ?? null, trace);
  } finally {
    trace.providerDurationMs = Math.round(performance.now() - start);
    input.onProviderTrace?.(trace);
  }
}
