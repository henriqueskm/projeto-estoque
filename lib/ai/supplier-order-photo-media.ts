import "server-only";
import type { SupplierOrderPhotoExtraction, SupplierOrderPhotoMimeType } from "@/lib/assistant-supplier-order-photo-contract";
import {
  extractSupplierOrderPhotoWithGemini, resolveSupplierOrderPhotoModel,
  SupplierOrderPhotoProviderError, type SupplierOrderPhotoProviderTrace,
} from "@/lib/ai/supplier-order-photo-gemini";
import {
  extractSupplierOrderPhotoWithOpenAI, resolveSupplierOrderPhotoFallbackModel,
  supportsOpenAIOrderPhoto,
} from "@/lib/ai/supplier-order-photo-openai";
import { OpenAIMediaProviderError, withMediaDeadline } from "@/lib/ai/openai-media-provider";

export const supplierOrderPhotoGlobalBudgetMs = 24_000;
export type PhotoMediaTrace = {
  primaryProvider: "gemini"; finalProvider: "gemini" | "openai";
  fallbackUsed: boolean; fallbackReason: string | null; model: string;
  providerPath: string; providerDurationMs: number;
  providerAttempts: Array<{
    provider: "gemini" | "openai"; path: string; internalCode: string;
    providerStatus: number | null;
  }>;
};

export class SupplierOrderPhotoMediaError extends Error {
  readonly internalCode: string;
  readonly providerStatus: number | null;
  readonly trace: PhotoMediaTrace;
  constructor(
    internalCode: string, providerStatus: number | null, trace: PhotoMediaTrace,
  ) {
    super("Photo media extraction failed"); this.name = "SupplierOrderPhotoMediaError";
    this.internalCode = internalCode; this.providerStatus = providerStatus; this.trace = trace;
  }
}

const externalFallbackCodes = new Set([
  "PROVIDER_RATE_LIMIT", "PROVIDER_SERVER", "PROVIDER_TIMEOUT",
  "PROVIDER_MODEL", "CONFIGURATION", "PROVIDER_AUTH",
]);

// Catalog/order failures occur outside this boundary, never triggering fallback.
export async function extractSupplierOrderPhoto(input: {
  bytes: Uint8Array; mimeType: SupplierOrderPhotoMimeType;
  onProviderTrace?: (trace: PhotoMediaTrace) => void;
}, dependencies: {
  gemini?: typeof extractSupplierOrderPhotoWithGemini;
  openai?: typeof extractSupplierOrderPhotoWithOpenAI;
  openAIConfigured?: boolean; globalBudgetMs?: number; primaryBudgetMs?: number;
} = {}): Promise<SupplierOrderPhotoExtraction> {
  const start = performance.now();
  const globalBudget = Math.min(dependencies.globalBudgetMs ?? supplierOrderPhotoGlobalBudgetMs, supplierOrderPhotoGlobalBudgetMs);
  const primaryBudget = Math.min(dependencies.primaryBudgetMs ?? 12_000, globalBudget);
  const trace: PhotoMediaTrace = {
    primaryProvider: "gemini", finalProvider: "gemini", fallbackUsed: false,
    fallbackReason: null, model: resolveSupplierOrderPhotoModel(),
    providerPath: "interactions", providerDurationMs: 0, providerAttempts: [],
  };
  let geminiTrace: SupplierOrderPhotoProviderTrace | undefined;
  const finish = () => {
    trace.providerDurationMs = Math.round(performance.now() - start);
    input.onProviderTrace?.(trace);
  };
  try {
    const extraction = await withMediaDeadline(primaryBudget, () =>
      (dependencies.gemini ?? extractSupplierOrderPhotoWithGemini)({
        bytes: input.bytes, mimeType: input.mimeType, totalBudgetMs: primaryBudget,
        onProviderTrace: value => { geminiTrace = value; },
      }), () => new SupplierOrderPhotoProviderError({ internalCode: "PROVIDER_TIMEOUT", model: trace.model }));
    trace.providerPath = geminiTrace?.providerPath ?? "interactions";
    trace.providerAttempts = (geminiTrace?.providerAttempts ?? []).map(attempt => ({
      provider: "gemini", path: attempt.path, internalCode: attempt.internalCode, providerStatus: attempt.providerStatus,
    }));
    trace.providerAttempts.push({ provider: "gemini", path: trace.providerPath, internalCode: "SUCCESS", providerStatus: null });
    finish();
    return extraction;
  } catch (error) {
    const primary = error instanceof SupplierOrderPhotoProviderError ? error : null;
    const code = primary?.internalCode ?? "UNEXPECTED";
    trace.providerPath = primary?.providerPath ?? trace.providerPath;
    trace.providerAttempts = (primary?.providerAttempts ?? []).map(attempt => ({
      provider: "gemini", path: attempt.path, internalCode: attempt.internalCode, providerStatus: attempt.providerStatus,
    }));
    if (!trace.providerAttempts.length) trace.providerAttempts.push({
      provider: "gemini", path: trace.providerPath, internalCode: code, providerStatus: primary?.providerStatus ?? null,
    });
    const remaining = Math.max(0, globalBudget - (performance.now() - start));
    if (!externalFallbackCodes.has(code) || !supportsOpenAIOrderPhoto(input.mimeType)
      || !(dependencies.openAIConfigured ?? Boolean(process.env.OPENAI_API_KEY?.trim())) || remaining <= 0) {
      finish();
      throw new SupplierOrderPhotoMediaError(code, primary?.providerStatus ?? null, trace);
    }
    trace.finalProvider = "openai"; trace.fallbackUsed = true; trace.fallbackReason = code;
    trace.model = resolveSupplierOrderPhotoFallbackModel(); trace.providerPath += "->openai";
    try {
      const budget = Math.min(12_000, remaining);
      const result = await withMediaDeadline(budget, () =>
        (dependencies.openai ?? extractSupplierOrderPhotoWithOpenAI)({
          bytes: input.bytes, mimeType: input.mimeType, budgetMs: budget,
        }), () => new OpenAIMediaProviderError("PROVIDER_TIMEOUT", trace.model));
      trace.providerAttempts.push({ provider: "openai", path: "responses", internalCode: "SUCCESS", providerStatus: null });
      finish();
      return result;
    } catch (fallbackError) {
      const failure = fallbackError instanceof OpenAIMediaProviderError ? fallbackError : null;
      trace.providerAttempts.push({
        provider: "openai", path: "responses",
        internalCode: failure?.internalCode ?? "UNEXPECTED", providerStatus: failure?.providerStatus ?? null,
      });
      finish();
      throw new SupplierOrderPhotoMediaError(failure?.internalCode ?? "UNEXPECTED", failure?.providerStatus ?? null, trace);
    }
  }
}
