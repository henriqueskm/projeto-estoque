import { GoogleGenAI, type Interactions } from "@google/genai";
import { extractionSchema, systemInstruction } from "@/lib/ai/supplier-order-photo-instructions";
import {
  parseSupplierOrderPhotoExtraction,
  supplierOrderPhotoModel,
  type SupplierOrderPhotoExtraction,
  type SupplierOrderPhotoMimeType,
} from "@/lib/assistant-supplier-order-photo-contract";
import {
  diagnoseGeminiProviderError,
  type GeminiProviderDiagnostics,
  type GeminiProviderFailureCode,
} from "@/lib/ai/gemini-provider-diagnostics";

export const supplierOrderPhotoProviderTotalBudgetMs = 12_000;
export const supplierOrderPhotoInteractionsBudgetMs = 7_000;

export type SupplierOrderPhotoProviderPath =
  | "interactions"
  | "interactions->generateContent";

export type SupplierOrderPhotoProviderAttempt = GeminiProviderDiagnostics & {
  path: "interactions" | "generateContent";
  internalCode: SupplierOrderPhotoProviderInternalCode;
};

export type SupplierOrderPhotoProviderTrace = {
  providerPath: SupplierOrderPhotoProviderPath;
  fallbackUsed: boolean;
  providerAttempts: SupplierOrderPhotoProviderAttempt[];
};

export type SupplierOrderPhotoProviderResult = SupplierOrderPhotoProviderTrace & {
  extraction: SupplierOrderPhotoExtraction;
};

type SupplierOrderPhotoGeminiClient = Pick<GoogleGenAI, "interactions" | "models">;

export type SupplierOrderPhotoProviderInternalCode =
  | "CONFIGURATION"
  | GeminiProviderFailureCode
  | "PROVIDER_EMPTY_OUTPUT"
  | "PROVIDER_INVALID_JSON"
  | "PROVIDER_SCHEMA_INVALID";

export class SupplierOrderPhotoProviderError extends Error {
  readonly internalCode: SupplierOrderPhotoProviderInternalCode;
  readonly providerStatus: number | null;
  readonly model: string;
  readonly providerErrorName: string | null;
  readonly providerErrorCode: string | null;
  readonly providerErrorType: string;
  readonly providerMessage: string | null;
  readonly providerPath: SupplierOrderPhotoProviderPath;
  readonly fallbackUsed: boolean;
  readonly providerAttempts: SupplierOrderPhotoProviderAttempt[];

  constructor(options: {
    internalCode: SupplierOrderPhotoProviderInternalCode;
    model: string;
    providerStatus?: number | null;
    diagnostics?: GeminiProviderDiagnostics;
    providerPath?: SupplierOrderPhotoProviderPath;
    fallbackUsed?: boolean;
    providerAttempts?: SupplierOrderPhotoProviderAttempt[];
  }) {
    super("Supplier order photo provider failed");
    this.name = "SupplierOrderPhotoProviderError";
    this.internalCode = options.internalCode;
    this.providerStatus = options.diagnostics?.providerStatus ?? options.providerStatus ?? null;
    this.model = options.model;
    this.providerErrorName = options.diagnostics?.providerErrorName ?? null;
    this.providerErrorCode = options.diagnostics?.providerErrorCode ?? null;
    this.providerErrorType = options.diagnostics?.providerErrorType ?? this.name;
    this.providerMessage = options.diagnostics?.providerMessage ?? null;
    this.providerPath = options.providerPath ?? "interactions";
    this.fallbackUsed = options.fallbackUsed ?? false;
    this.providerAttempts = options.providerAttempts ?? [];
  }
}

export function resolveSupplierOrderPhotoModel() {
  return process.env.GEMINI_PHOTO_MODEL?.trim() || supplierOrderPhotoModel;
}

export function classifySupplierOrderPhotoProviderError(
  error: unknown,
  model: string,
) {
  if (error instanceof SupplierOrderPhotoProviderError) return error;
  const diagnosed = diagnoseGeminiProviderError(error);
  return new SupplierOrderPhotoProviderError({
    internalCode: diagnosed.internalCode,
    model,
    diagnostics: diagnosed.diagnostics,
  });
}

function providerAttempt(
  path: SupplierOrderPhotoProviderAttempt["path"],
  error: SupplierOrderPhotoProviderError,
): SupplierOrderPhotoProviderAttempt {
  return {
    path,
    internalCode: error.internalCode,
    providerStatus: error.providerStatus,
    providerErrorName: error.providerErrorName,
    providerErrorCode: error.providerErrorCode,
    providerErrorType: error.providerErrorType,
    providerMessage: error.providerMessage,
  };
}

function providerErrorWithFlow(options: {
  error: SupplierOrderPhotoProviderError;
  providerPath: SupplierOrderPhotoProviderPath;
  fallbackUsed: boolean;
  providerAttempts: SupplierOrderPhotoProviderAttempt[];
}) {
  return new SupplierOrderPhotoProviderError({
    internalCode: options.error.internalCode,
    model: options.error.model,
    diagnostics: {
      providerStatus: options.error.providerStatus,
      providerErrorName: options.error.providerErrorName,
      providerErrorCode: options.error.providerErrorCode,
      providerErrorType: options.error.providerErrorType,
      providerMessage: options.error.providerMessage,
    },
    providerPath: options.providerPath,
    fallbackUsed: options.fallbackUsed,
    providerAttempts: options.providerAttempts,
  });
}

function parseProviderExtraction(options: {
  output: string | undefined;
  model: string;
  providerPath: SupplierOrderPhotoProviderPath;
  fallbackUsed: boolean;
  providerAttempts: SupplierOrderPhotoProviderAttempt[];
}) {
  const output = options.output?.trim();
  if (!output) {
    throw new SupplierOrderPhotoProviderError({
      internalCode: "PROVIDER_EMPTY_OUTPUT",
      model: options.model,
      providerPath: options.providerPath,
      fallbackUsed: options.fallbackUsed,
      providerAttempts: options.providerAttempts,
    });
  }
  let rawExtraction: unknown;
  try {
    rawExtraction = JSON.parse(output);
  } catch {
    throw new SupplierOrderPhotoProviderError({
      internalCode: "PROVIDER_INVALID_JSON",
      model: options.model,
      providerPath: options.providerPath,
      fallbackUsed: options.fallbackUsed,
      providerAttempts: options.providerAttempts,
    });
  }
  const extraction = parseSupplierOrderPhotoExtraction(rawExtraction);
  if (!extraction) {
    throw new SupplierOrderPhotoProviderError({
      internalCode: "PROVIDER_SCHEMA_INVALID",
      model: options.model,
      providerPath: options.providerPath,
      fallbackUsed: options.fallbackUsed,
      providerAttempts: options.providerAttempts,
    });
  }
  return extraction;
}

function shouldUseGenerateContentFallback(error: SupplierOrderPhotoProviderError) {
  return error.internalCode === "PROVIDER_SERVER"
    || error.internalCode === "PROVIDER_TIMEOUT"
    || error.internalCode === "PROVIDER_INVALID_JSON";
}

class SupplierOrderPhotoDeadlineError extends Error {
  constructor() {
    super("Supplier order photo provider deadline exceeded");
    this.name = "AbortError";
  }
}

function remainingDeadlineMs(deadlineAt: number) {
  return Math.max(0, deadlineAt - Date.now());
}

function runWithApplicationDeadline<T>(options: {
  deadlineAt: number;
  onDeadline: () => void;
  run: () => Promise<T>;
}): Promise<T> {
  const remainingMs = remainingDeadlineMs(options.deadlineAt);
  if (remainingMs <= 0) {
    options.onDeadline();
    return Promise.reject(new SupplierOrderPhotoDeadlineError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      options.onDeadline();
      reject(new SupplierOrderPhotoDeadlineError());
    }, remainingMs);

    Promise.resolve()
      .then(options.run)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        },
      );
  });
}

export async function extractSupplierOrderPhotoWithProvider(options: {
  bytes: Uint8Array;
  mimeType: SupplierOrderPhotoMimeType;
  model: string;
  client: SupplierOrderPhotoGeminiClient;
  totalBudgetMs?: number;
  interactionsBudgetMs?: number;
}): Promise<SupplierOrderPhotoProviderResult> {
  const totalBudgetMs = options.totalBudgetMs ?? supplierOrderPhotoProviderTotalBudgetMs;
  const interactionsBudgetMs = Math.min(
    options.interactionsBudgetMs ?? supplierOrderPhotoInteractionsBudgetMs,
    totalBudgetMs,
  );
  const startedAt = Date.now();
  const totalDeadlineAt = startedAt + totalBudgetMs;
  const interactionsDeadlineAt = Math.min(
    startedAt + interactionsBudgetMs,
    totalDeadlineAt,
  );
  const totalAbortController = new AbortController();
  const totalTimeout = setTimeout(
    () => totalAbortController.abort(),
    remainingDeadlineMs(totalDeadlineAt),
  );
  const encodedImage = Buffer.from(options.bytes).toString("base64");
  const interactionInput: Interactions.Step[] = [
    {
      type: "user_input",
      content: [
        { type: "text", text: "Extraia os campos visuais deste documento conforme o schema estrito." },
        {
          type: "image",
          data: encodedImage,
          mime_type: options.mimeType,
        },
      ],
    },
  ];

  try {
    const interactionsAbortController = new AbortController();
    try {
      const response = await runWithApplicationDeadline({
        deadlineAt: interactionsDeadlineAt,
        onDeadline: () => interactionsAbortController.abort(),
        run: () => options.client.interactions.create(
          {
            model: options.model,
            store: false,
            system_instruction: systemInstruction,
            input: interactionInput,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: extractionSchema,
            },
            generation_config: {
              max_output_tokens: 4_000,
              tool_choice: "none",
            },
          },
          {
            timeout: interactionsBudgetMs,
            maxRetries: 0,
            fetchOptions: { signal: interactionsAbortController.signal },
          },
        ),
      });
      return {
        extraction: parseProviderExtraction({
          output: response.output_text,
          model: options.model,
          providerPath: "interactions",
          fallbackUsed: false,
          providerAttempts: [],
        }),
        providerPath: "interactions",
        fallbackUsed: false,
        providerAttempts: [],
      };
    } catch (error) {
      const primaryError = classifySupplierOrderPhotoProviderError(error, options.model);
      if (!shouldUseGenerateContentFallback(primaryError)) {
        const primaryAttempt = providerAttempt("interactions", primaryError);
        throw providerErrorWithFlow({
          error: primaryError,
          providerPath: "interactions",
          fallbackUsed: false,
          providerAttempts: [primaryAttempt],
        });
      }

      const primaryAttempt = providerAttempt("interactions", primaryError);
      const remainingBudgetMs = remainingDeadlineMs(totalDeadlineAt);
      if (remainingBudgetMs <= 0) {
        totalAbortController.abort();
        const deadlineError = classifySupplierOrderPhotoProviderError(
          new SupplierOrderPhotoDeadlineError(),
          options.model,
        );
        throw providerErrorWithFlow({
          error: deadlineError,
          providerPath: "interactions",
          fallbackUsed: false,
          providerAttempts: [primaryAttempt],
        });
      }

      try {
        const fallbackResponse = await runWithApplicationDeadline({
          deadlineAt: totalDeadlineAt,
          onDeadline: () => totalAbortController.abort(),
          run: () => options.client.models.generateContent({
            model: options.model,
            contents: [
              {
                inlineData: {
                  mimeType: options.mimeType,
                  data: encodedImage,
                },
              },
              { text: "Extraia os campos visuais deste documento conforme o schema estrito." },
            ],
            config: {
              systemInstruction,
              maxOutputTokens: 4_000,
              responseMimeType: "application/json",
              responseJsonSchema: extractionSchema,
              abortSignal: totalAbortController.signal,
              httpOptions: {
                timeout: remainingBudgetMs,
                retryOptions: { attempts: 1 },
              },
            },
          }),
        });
        return {
          extraction: parseProviderExtraction({
            output: fallbackResponse.text,
            model: options.model,
            providerPath: "interactions->generateContent",
            fallbackUsed: true,
            providerAttempts: [primaryAttempt],
          }),
          providerPath: "interactions->generateContent",
          fallbackUsed: true,
          providerAttempts: [primaryAttempt],
        };
      } catch (fallbackError) {
        if (fallbackError instanceof SupplierOrderPhotoProviderError) throw fallbackError;
        const classifiedFallback = classifySupplierOrderPhotoProviderError(
          fallbackError,
          options.model,
        );
        const fallbackAttempt = providerAttempt("generateContent", classifiedFallback);
        throw providerErrorWithFlow({
          error: classifiedFallback,
          providerPath: "interactions->generateContent",
          fallbackUsed: true,
          providerAttempts: [primaryAttempt, fallbackAttempt],
        });
      }
    }
  } finally {
    clearTimeout(totalTimeout);
  }
}

export async function extractSupplierOrderPhotoWithGemini(input: {
  bytes: Uint8Array;
  mimeType: SupplierOrderPhotoMimeType;
  totalBudgetMs?: number;
  onProviderTrace?: (trace: SupplierOrderPhotoProviderTrace) => void;
}): Promise<SupplierOrderPhotoExtraction> {
  const model = resolveSupplierOrderPhotoModel();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new SupplierOrderPhotoProviderError({ internalCode: "CONFIGURATION", model });
  }

  const client = new GoogleGenAI({
    apiKey,
    httpOptions: { retryOptions: { attempts: 1 } },
  });
  const result = await extractSupplierOrderPhotoWithProvider({
    bytes: input.bytes,
    mimeType: input.mimeType,
    model,
    client,
    totalBudgetMs: input.totalBudgetMs,
  });
  input.onProviderTrace?.({
    providerPath: result.providerPath,
    fallbackUsed: result.fallbackUsed,
    providerAttempts: result.providerAttempts,
  });
  return result.extraction;
}
