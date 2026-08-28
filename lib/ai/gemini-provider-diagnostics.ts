const providerMessageMaxLength = 180;

const safeProviderFieldNames = [
  "response_format",
  "generation_config",
  "system_instruction",
  "tool_choice",
  "mime_type",
  "sample_rate",
  "channels",
  "input",
  "model",
] as const;

export type GeminiProviderFailureCode =
  | "PROVIDER_HTTP_400"
  | "PROVIDER_AUTH"
  | "PROVIDER_MODEL"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_SERVER"
  | "PROVIDER_TIMEOUT"
  | "UNEXPECTED";

export type GeminiProviderDiagnostics = {
  providerStatus: number | null;
  providerErrorName: string | null;
  providerErrorCode: string | null;
  providerErrorType: string;
  providerMessage: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function sanitizeIdentifier(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 80 || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) return null;
  return normalized;
}

function readConstructorName(value: unknown) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  const constructor = (value as { constructor?: unknown }).constructor;
  return typeof constructor === "function" ? sanitizeIdentifier(constructor.name) : null;
}

function readProviderStatus(records: Array<Record<string, unknown> | null>) {
  for (const record of records) {
    const candidate = record?.status ?? record?.statusCode;
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
  }
  return null;
}

function readMessage(records: Array<Record<string, unknown> | null>) {
  for (const record of records) {
    if (typeof record?.message === "string" && record.message.trim()) return record.message;
  }
  return null;
}

export function sanitizeGeminiProviderMessage(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase("en-US");

  let summary = "Provider returned an unclassified error.";
  if (/abort/.test(lower)) {
    summary = "Provider request was aborted.";
  } else if (/timeout|timed out/.test(lower)) {
    summary = "Provider request timed out.";
  } else if (/rate.?limit|resource.?exhaust|quota/.test(lower)) {
    summary = "Provider rate limit or quota was reached.";
  } else if (/auth|api.?key|credential|permission|unauthor|forbidden/.test(lower)) {
    summary = "Provider authentication or permission failed.";
  } else if (/not.?found|unknown model/.test(lower)) {
    summary = "Provider model or resource was not found.";
  } else if (/invalid|bad request|malformed|unsupported|schema|mime/.test(lower)) {
    summary = "Provider rejected the request as invalid.";
  } else if (/internal|server|unavailable|overload/.test(lower)) {
    summary = "Provider returned a server error.";
  }

  const fields = safeProviderFieldNames.filter((field) => lower.includes(field));
  const fieldSuffix = fields.length > 0 ? ` Fields: ${fields.join(", ")}.` : "";
  return `${summary}${fieldSuffix}`.slice(0, providerMessageMaxLength);
}

export function diagnoseGeminiProviderError(error: unknown): {
  internalCode: GeminiProviderFailureCode;
  diagnostics: GeminiProviderDiagnostics;
} {
  const root = asRecord(error);
  const nestedError = asRecord(root?.error);
  const cause = asRecord(root?.cause);
  const records = [root, nestedError, cause];
  const providerStatus = readProviderStatus(records);
  const providerErrorName = sanitizeIdentifier(root?.name);
  const providerErrorCode = sanitizeIdentifier(root?.code ?? nestedError?.code ?? cause?.code);
  const providerErrorType = readConstructorName(error) ?? (root ? "Object" : typeof error);
  const rawMessage = readMessage(records);
  const diagnosticText = [providerErrorName, providerErrorCode, rawMessage]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  const internalCode: GeminiProviderFailureCode =
    /abort|timeout|timed out/i.test(diagnosticText)
      ? "PROVIDER_TIMEOUT"
      : providerStatus === 400
        ? "PROVIDER_HTTP_400"
        : providerStatus === 401 || providerStatus === 403
          ? "PROVIDER_AUTH"
          : providerStatus === 404
            ? "PROVIDER_MODEL"
            : providerStatus === 429
              ? "PROVIDER_RATE_LIMIT"
              : providerStatus !== null && providerStatus >= 500 && providerStatus <= 599
                ? "PROVIDER_SERVER"
                : "UNEXPECTED";

  return {
    internalCode,
    diagnostics: {
      providerStatus,
      providerErrorName,
      providerErrorCode,
      providerErrorType,
      providerMessage: sanitizeGeminiProviderMessage(rawMessage),
    },
  };
}
