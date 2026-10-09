import "server-only";

export type MediaProviderFailureCode =
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "CONFIGURATION" | "PROVIDER_AUTH" | "PROVIDER_MODEL" | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_SERVER" | "PROVIDER_TIMEOUT" | "PROVIDER_HTTP_400"
  | "PROVIDER_EMPTY_OUTPUT" | "PROVIDER_INVALID_JSON" | "PROVIDER_SCHEMA_INVALID";

export class OpenAIMediaProviderError extends Error {
  readonly internalCode: MediaProviderFailureCode;
  readonly model: string;
  readonly providerStatus: number | null;
  constructor(
    internalCode: MediaProviderFailureCode,
    model: string,
    providerStatus: number | null = null,
  ) {
    super("Media provider request failed");
    this.name = "OpenAIMediaProviderError";
    this.internalCode = internalCode;
    this.model = model;
    this.providerStatus = providerStatus;
  }
}

// Application deadline covers fetch AND reading the body, even if a transport
// ignores AbortSignal. Late rejection is consumed; no retries are performed.
export async function withMediaDeadline<T>(
  budgetMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutError: () => Error,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(timeoutError()); }, Math.max(0, budgetMs));
      }),
      Promise.resolve().then(() => run(controller.signal)),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveOpenAIMediaModel(value: string | undefined, fallback: string) {
  const model = value?.trim() || fallback;
  return /^[a-zA-Z0-9_.:-]{1,80}$/.test(model) ? model : fallback;
}

export async function requestOpenAIMedia(options: {
  endpoint: "responses" | "audio/transcriptions";
  model: string;
  body: BodyInit;
  json?: boolean;
  budgetMs: number;
  apiKey?: string;
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const apiKey = (options.apiKey ?? process.env.OPENAI_API_KEY)?.trim();
  if (!apiKey) throw new OpenAIMediaProviderError("CONFIGURATION", options.model);
  try {
    return await withMediaDeadline(options.budgetMs, async signal => {
      const response = await (options.fetcher ?? fetch)(`https://api.openai.com/v1/${options.endpoint}`, {
        method: "POST", signal, cache: "no-store", redirect: "error",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(options.json ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body,
      });
      if (!response.ok) {
        const status = response.status;
        const code = status === 429 ? "PROVIDER_RATE_LIMIT"
          : status === 401 || status === 403 ? "PROVIDER_AUTH"
            : status === 404 ? "PROVIDER_MODEL"
              : status >= 500 ? "PROVIDER_SERVER" : "PROVIDER_HTTP_400";
        // Never inspect, log, or expose the provider's error body.
        await response.body?.cancel().catch(() => undefined);
        throw new OpenAIMediaProviderError(code, options.model, status);
      }
      try { return await response.json(); }
      catch { throw new OpenAIMediaProviderError("PROVIDER_INVALID_JSON", options.model); }
    }, () => new OpenAIMediaProviderError("PROVIDER_TIMEOUT", options.model));
  } catch (error) {
    if (error instanceof OpenAIMediaProviderError) throw error;
    throw new OpenAIMediaProviderError("PROVIDER_SERVER", options.model);
  }
}
