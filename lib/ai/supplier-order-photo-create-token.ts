import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupplierOrderPhotoCreateCanonicalLine } from "../assistant-supplier-order-photo-create-contract.ts";

export const supplierOrderPhotoCreateProposalLifetimeSeconds = 10 * 60;
const tokenVersion = 1 as const;
const supplierOrderPhotoCreateMaxLines = 100;
const supplierOrderPhotoCreateMaxTokenLength = 65_536;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupplierOrderPhotoCreateProposalPayload = {
  version: typeof tokenVersion;
  action: "supplier_order_create_from_photo";
  userId: string;
  negotiationNumber: string;
  orderDate: string;
  lines: Array<Omit<SupplierOrderPhotoCreateCanonicalLine, "description">>;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
};

export type SupplierOrderPhotoCreateTokenVerification =
  | { ok: true; payload: SupplierOrderPhotoCreateProposalPayload }
  | { ok: false; reason: "expired"; payload: SupplierOrderPhotoCreateProposalPayload }
  | { ok: false; reason: "configuration" | "invalid" | "user_mismatch" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function parsePayload(value: unknown): SupplierOrderPhotoCreateProposalPayload | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "action", "userId", "negotiationNumber", "orderDate", "lines",
    "idempotencyKey", "issuedAt", "expiresAt",
  ]) || value.version !== tokenVersion ||
    value.action !== "supplier_order_create_from_photo" ||
    typeof value.userId !== "string" || !uuidPattern.test(value.userId) ||
    typeof value.negotiationNumber !== "string" ||
    !/^[0-9]{1,120}$/.test(value.negotiationNumber) ||
    typeof value.orderDate !== "string" || !isRealDate(value.orderDate) ||
    !Array.isArray(value.lines) || value.lines.length < 1 ||
    value.lines.length > supplierOrderPhotoCreateMaxLines ||
    typeof value.idempotencyKey !== "string" || !uuidPattern.test(value.idempotencyKey) ||
    !Number.isSafeInteger(value.issuedAt) || Number(value.issuedAt) <= 0 ||
    !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= Number(value.issuedAt) ||
    Number(value.expiresAt) - Number(value.issuedAt) > supplierOrderPhotoCreateProposalLifetimeSeconds) return null;
  const lines: SupplierOrderPhotoCreateProposalPayload["lines"] = [];
  const identities = new Set<string>();
  for (const raw of value.lines) {
    if (!isRecord(raw) || !hasExactKeys(raw, [
      "kind", "targetId", "commercialConfigurationCodeId", "code", "quantity",
    ]) || !["ITEM", "COMMERCIAL_CONFIGURATION"].includes(String(raw.kind)) ||
      typeof raw.targetId !== "string" || !uuidPattern.test(raw.targetId) ||
      (raw.commercialConfigurationCodeId !== null &&
        (typeof raw.commercialConfigurationCodeId !== "string" ||
          !uuidPattern.test(raw.commercialConfigurationCodeId))) ||
      (raw.kind === "ITEM" && raw.commercialConfigurationCodeId !== null) ||
      (raw.kind === "COMMERCIAL_CONFIGURATION" && raw.commercialConfigurationCodeId === null) ||
      typeof raw.code !== "string" || !raw.code.trim() || raw.code.length > 120 ||
      !Number.isSafeInteger(raw.quantity) || Number(raw.quantity) < 1 ||
      Number(raw.quantity) > 2_147_483_647) return null;
    const targetId = raw.targetId.toLowerCase();
    const codeId = typeof raw.commercialConfigurationCodeId === "string"
      ? raw.commercialConfigurationCodeId.toLowerCase() : null;
    const identity = `${raw.kind}:${targetId}:${codeId ?? "NONE"}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
    lines.push({
      kind: raw.kind as SupplierOrderPhotoCreateCanonicalLine["kind"], targetId,
      commercialConfigurationCodeId: codeId, code: raw.code.trim(), quantity: Number(raw.quantity),
    });
  }
  return {
    version: tokenVersion, action: "supplier_order_create_from_photo",
    userId: value.userId.toLowerCase(), negotiationNumber: value.negotiationNumber,
    orderDate: value.orderDate, lines, idempotencyKey: value.idempotencyKey.toLowerCase(),
    issuedAt: Number(value.issuedAt), expiresAt: Number(value.expiresAt),
  };
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

export function createSupplierOrderPhotoCreateProposalToken(
  input: Omit<SupplierOrderPhotoCreateProposalPayload, "version" | "action" | "issuedAt" | "expiresAt">,
  secret: string,
  now = new Date(),
) {
  if (secret.trim().length < 32) return null;
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const payload = parsePayload({
    version: tokenVersion, action: "supplier_order_create_from_photo", ...input,
    issuedAt, expiresAt: issuedAt + supplierOrderPhotoCreateProposalLifetimeSeconds,
  });
  if (!payload) return null;
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const token = `${encodedPayload}.${signature(encodedPayload, secret).toString("base64url")}`;
  return token.length <= supplierOrderPhotoCreateMaxTokenLength ? { token, payload } : null;
}

export function verifySupplierOrderPhotoCreateProposalToken(
  token: string,
  secret: string,
  expectedUserId: string,
  now = new Date(),
): SupplierOrderPhotoCreateTokenVerification {
  if (secret.trim().length < 32) return { ok: false, reason: "configuration" };
  if (!token || token.length > supplierOrderPhotoCreateMaxTokenLength ||
    !uuidPattern.test(expectedUserId)) return { ok: false, reason: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    return { ok: false, reason: "invalid" };
  }
  const expected = signature(parts[0], secret);
  const supplied = Buffer.from(parts[1], "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return { ok: false, reason: "invalid" };
  }
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { return { ok: false, reason: "invalid" }; }
  const payload = parsePayload(decoded);
  if (!payload) return { ok: false, reason: "invalid" };
  if (payload.userId !== expectedUserId.toLowerCase()) {
    return { ok: false, reason: "user_mismatch" };
  }
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (payload.expiresAt < nowSeconds || payload.issuedAt > nowSeconds + 60) {
    return { ok: false, reason: "expired", payload };
  }
  return { ok: true, payload };
}
