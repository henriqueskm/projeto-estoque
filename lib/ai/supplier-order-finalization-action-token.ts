import { createHmac, timingSafeEqual } from "node:crypto";

export const supplierOrderFinalizationProposalLifetimeSeconds = 10 * 60;
const tokenVersion = 1 as const;
const maximumTokenLength = 4096;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupplierOrderFinalizationProposalPayload = {
  version: typeof tokenVersion;
  action: "supplier_order_finalization";
  userId: string;
  supplierOrderId: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
};

export type SupplierOrderFinalizationTokenVerification =
  | { ok: true; payload: SupplierOrderFinalizationProposalPayload }
  | { ok: false; reason: "expired"; payload: SupplierOrderFinalizationProposalPayload }
  | { ok: false; reason: "configuration" | "invalid" | "user_mismatch" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePayload(value: unknown): SupplierOrderFinalizationProposalPayload | null {
  if (!isRecord(value)) return null;
  const keys = ["version", "action", "userId", "supplierOrderId", "expectedUpdatedAt", "idempotencyKey", "issuedAt", "expiresAt"];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key)) ||
    value.version !== tokenVersion || value.action !== "supplier_order_finalization" ||
    typeof value.userId !== "string" || !uuidPattern.test(value.userId) ||
    typeof value.supplierOrderId !== "string" || !uuidPattern.test(value.supplierOrderId) ||
    typeof value.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(value.expectedUpdatedAt)) ||
    typeof value.idempotencyKey !== "string" || !uuidPattern.test(value.idempotencyKey) ||
    typeof value.issuedAt !== "number" || !Number.isSafeInteger(value.issuedAt) || value.issuedAt <= 0 ||
    typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > supplierOrderFinalizationProposalLifetimeSeconds) return null;
  return { version: tokenVersion, action: "supplier_order_finalization", userId: value.userId.toLowerCase(),
    supplierOrderId: value.supplierOrderId.toLowerCase(), expectedUpdatedAt: value.expectedUpdatedAt,
    idempotencyKey: value.idempotencyKey.toLowerCase(), issuedAt: value.issuedAt, expiresAt: value.expiresAt };
}

function sign(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(encoded, "utf8").digest();
}

export function createSupplierOrderFinalizationProposalToken(
  input: Omit<SupplierOrderFinalizationProposalPayload, "version" | "action" | "issuedAt" | "expiresAt">,
  secret: string,
  now = new Date(),
) {
  if (secret.trim().length < 32) return null;
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = parsePayload({ version: tokenVersion, action: "supplier_order_finalization", ...input,
    issuedAt, expiresAt: issuedAt + supplierOrderFinalizationProposalLifetimeSeconds });
  if (!payload) return null;
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { payload, token: `${encoded}.${sign(encoded, secret).toString("base64url")}` };
}

export function verifySupplierOrderFinalizationProposalToken(
  token: string,
  secret: string,
  expectedUserId: string,
  now = new Date(),
): SupplierOrderFinalizationTokenVerification {
  if (secret.trim().length < 32) return { ok: false, reason: "configuration" };
  if (!token || token.length > maximumTokenLength || !uuidPattern.test(expectedUserId)) return { ok: false, reason: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return { ok: false, reason: "invalid" };
  const expected = sign(parts[0], secret);
  const supplied = Buffer.from(parts[1], "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { ok: false, reason: "invalid" };
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { return { ok: false, reason: "invalid" }; }
  const payload = parsePayload(decoded);
  if (!payload) return { ok: false, reason: "invalid" };
  if (payload.userId !== expectedUserId.toLowerCase()) return { ok: false, reason: "user_mismatch" };
  const seconds = Math.floor(now.getTime() / 1000);
  if (payload.expiresAt < seconds || payload.issuedAt > seconds + 60) return { ok: false, reason: "expired", payload };
  return { ok: true, payload };
}
