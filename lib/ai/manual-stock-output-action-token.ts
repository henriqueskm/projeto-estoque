import { createHmac, timingSafeEqual } from "node:crypto";

export const manualStockOutputProposalLifetimeSeconds = 10 * 60;
const tokenVersion = 1 as const;
const maximumTokenLength = 4096;
const maximumInteger = 2_147_483_647;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ManualStockOutputProposalPayload = {
  version: typeof tokenVersion;
  action: "manual_stock_output";
  userId: string;
  lines: Array<{ kind: "ITEM" | "COMMERCIAL_CODE"; targetId: string; quantity: number }>;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
};

type VerificationResult =
  | { ok: true; payload: ManualStockOutputProposalPayload }
  | { ok: false; reason: "expired"; payload: ManualStockOutputProposalPayload }
  | { ok: false; reason: "configuration" | "invalid" | "user_mismatch" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximumInteger;
}

function parsePayload(value: unknown): ManualStockOutputProposalPayload | null {
  if (!isRecord(value)) return null;
  const keys = ["version", "action", "userId", "lines", "idempotencyKey", "issuedAt", "expiresAt"];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key)) ||
    value.version !== tokenVersion || value.action !== "manual_stock_output" ||
    typeof value.userId !== "string" || !uuidPattern.test(value.userId) ||
    typeof value.idempotencyKey !== "string" || !uuidPattern.test(value.idempotencyKey) ||
    typeof value.issuedAt !== "number" || !Number.isSafeInteger(value.issuedAt) || value.issuedAt <= 0 ||
    typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > manualStockOutputProposalLifetimeSeconds ||
    !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 500) return null;

  const consolidated = new Map<string, ManualStockOutputProposalPayload["lines"][number]>();
  for (const line of value.lines) {
    if (!isRecord(line) || Object.keys(line).length !== 3 ||
      (line.kind !== "ITEM" && line.kind !== "COMMERCIAL_CODE") ||
      typeof line.targetId !== "string" || !uuidPattern.test(line.targetId) || !isPositiveInteger(line.quantity)) return null;
    const targetId = line.targetId.toLowerCase();
    const key = `${line.kind}:${targetId}`;
    const quantity = (consolidated.get(key)?.quantity ?? 0) + line.quantity;
    if (!isPositiveInteger(quantity)) return null;
    consolidated.set(key, { kind: line.kind, targetId, quantity });
  }
  const lines = Array.from(consolidated.values()).sort((a, b) =>
    a.kind === b.kind ? a.targetId.localeCompare(b.targetId) : a.kind.localeCompare(b.kind));
  return { version: tokenVersion, action: "manual_stock_output", userId: value.userId.toLowerCase(), lines,
    idempotencyKey: value.idempotencyKey.toLowerCase(), issuedAt: value.issuedAt, expiresAt: value.expiresAt };
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

export function createManualStockOutputProposalToken(
  input: Omit<ManualStockOutputProposalPayload, "version" | "action" | "issuedAt" | "expiresAt">,
  secret: string,
  now = new Date(),
) {
  if (secret.trim().length < 32) return null;
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = parsePayload({ version: tokenVersion, action: "manual_stock_output", ...input,
    issuedAt, expiresAt: issuedAt + manualStockOutputProposalLifetimeSeconds });
  if (!payload) return null;
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { payload, token: `${encoded}.${signature(encoded, secret).toString("base64url")}` };
}

export function verifyManualStockOutputProposalToken(
  token: string,
  secret: string,
  userId: string,
  now = new Date(),
): VerificationResult {
  if (secret.trim().length < 32) return { ok: false, reason: "configuration" };
  if (!token || token.length > maximumTokenLength || !uuidPattern.test(userId)) return { ok: false, reason: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return { ok: false, reason: "invalid" };
  const expected = signature(parts[0], secret);
  const supplied = Buffer.from(parts[1], "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { ok: false, reason: "invalid" };
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { return { ok: false, reason: "invalid" }; }
  const payload = parsePayload(decoded);
  if (!payload) return { ok: false, reason: "invalid" };
  if (payload.userId !== userId.toLowerCase()) return { ok: false, reason: "user_mismatch" };
  const seconds = Math.floor(now.getTime() / 1000);
  if (payload.expiresAt < seconds || payload.issuedAt > seconds + 60) return { ok: false, reason: "expired", payload };
  return { ok: true, payload };
}
