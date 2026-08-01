import { createHmac, timingSafeEqual } from "node:crypto";

export const stockEntryProposalLifetimeSeconds = 10 * 60;
const tokenVersion = 1 as const;
const maximumTokenLength = 4096;
const maximumInteger = 2_147_483_647;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupplierOrderStockEntryProposalPayload = {
  version: typeof tokenVersion;
  action: "supplier_order_stock_entry";
  userId: string;
  supplierOrderId: string;
  lines: Array<{ supplierOrderItemId: string; quantity: number }>;
  expectedUpdatedAt: string;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
};

export type ManualStockEntryProposalPayload = {
  version: typeof tokenVersion;
  action: "manual_stock_entry";
  userId: string;
  lines: Array<{
    kind: "ITEM" | "COMMERCIAL_CODE";
    targetId: string;
    quantity: number;
  }>;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
};

export type StockEntryProposalPayload =
  | SupplierOrderStockEntryProposalPayload
  | ManualStockEntryProposalPayload;

type VerificationResult<T extends StockEntryProposalPayload> =
  | { ok: true; payload: T }
  | { ok: false; reason: "expired"; payload: T }
  | {
      ok: false;
      reason: "configuration" | "invalid" | "user_mismatch";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeSecret(secret: string) {
  return secret.trim().length >= 32;
}

function isPositiveInteger(value: unknown) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximumInteger
  );
}

function normalizeEnvelope<T extends StockEntryProposalPayload>(
  payload: T,
  maximumLines: number,
): T | null {
  if (
    payload.version !== tokenVersion ||
    !uuidPattern.test(payload.userId) ||
    !uuidPattern.test(payload.idempotencyKey) ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.issuedAt <= 0 ||
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt > stockEntryProposalLifetimeSeconds ||
    !Array.isArray(payload.lines) ||
    payload.lines.length < 1 ||
    payload.lines.length > maximumLines
  ) {
    return null;
  }

  return payload;
}

function parseSupplierOrderPayload(
  value: unknown,
): SupplierOrderStockEntryProposalPayload | null {
  if (!isRecord(value)) return null;
  const expectedKeys = [
    "version",
    "action",
    "userId",
    "supplierOrderId",
    "lines",
    "expectedUpdatedAt",
    "idempotencyKey",
    "issuedAt",
    "expiresAt",
  ];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    value.version !== tokenVersion ||
    value.action !== "supplier_order_stock_entry" ||
    typeof value.userId !== "string" ||
    typeof value.supplierOrderId !== "string" ||
    !uuidPattern.test(value.supplierOrderId) ||
    typeof value.expectedUpdatedAt !== "string" ||
    Number.isNaN(Date.parse(value.expectedUpdatedAt)) ||
    typeof value.idempotencyKey !== "string" ||
    typeof value.issuedAt !== "number" ||
    typeof value.expiresAt !== "number" ||
    !Array.isArray(value.lines)
  ) return null;

  const ids = new Set<string>();
  const lines: SupplierOrderStockEntryProposalPayload["lines"] = [];
  for (const rawLine of value.lines) {
    if (!isRecord(rawLine) || Object.keys(rawLine).length !== 2 ||
      !Object.hasOwn(rawLine, "supplierOrderItemId") ||
      !Object.hasOwn(rawLine, "quantity") ||
      typeof rawLine.supplierOrderItemId !== "string" ||
      !uuidPattern.test(rawLine.supplierOrderItemId) ||
      !isPositiveInteger(rawLine.quantity)) return null;
    const id = rawLine.supplierOrderItemId.toLowerCase();
    if (ids.has(id)) return null;
    ids.add(id);
    lines.push({ supplierOrderItemId: id, quantity: Number(rawLine.quantity) });
  }
  lines.sort((a, b) => a.supplierOrderItemId.localeCompare(b.supplierOrderItemId));

  return normalizeEnvelope({
    version: tokenVersion,
    action: "supplier_order_stock_entry",
    userId: value.userId.toLowerCase(),
    supplierOrderId: value.supplierOrderId.toLowerCase(),
    lines,
    // Keep the original PostgreSQL timestamptz text. Reformatting through Date
    // would truncate microseconds and create false optimistic-lock conflicts.
    expectedUpdatedAt: value.expectedUpdatedAt,
    idempotencyKey: value.idempotencyKey.toLowerCase(),
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  }, 1000);
}

function parseManualPayload(value: unknown): ManualStockEntryProposalPayload | null {
  if (!isRecord(value)) return null;
  const expectedKeys = [
    "version", "action", "userId", "lines", "idempotencyKey", "issuedAt", "expiresAt",
  ];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    value.version !== tokenVersion || value.action !== "manual_stock_entry" ||
    typeof value.userId !== "string" || typeof value.idempotencyKey !== "string" ||
    typeof value.issuedAt !== "number" || typeof value.expiresAt !== "number" ||
    !Array.isArray(value.lines)
  ) return null;

  const consolidated = new Map<string, ManualStockEntryProposalPayload["lines"][number]>();
  for (const rawLine of value.lines) {
    if (!isRecord(rawLine) || Object.keys(rawLine).length !== 3 ||
      !Object.hasOwn(rawLine, "kind") || !Object.hasOwn(rawLine, "targetId") ||
      !Object.hasOwn(rawLine, "quantity") ||
      (rawLine.kind !== "ITEM" && rawLine.kind !== "COMMERCIAL_CODE") ||
      typeof rawLine.targetId !== "string" || !uuidPattern.test(rawLine.targetId) ||
      !isPositiveInteger(rawLine.quantity)) return null;
    const targetId = rawLine.targetId.toLowerCase();
    const key = `${rawLine.kind}:${targetId}`;
    const quantity = (consolidated.get(key)?.quantity ?? 0) + Number(rawLine.quantity);
    if (!isPositiveInteger(quantity)) return null;
    consolidated.set(key, { kind: rawLine.kind, targetId, quantity });
  }
  const lines = Array.from(consolidated.values()).sort((a, b) =>
    a.kind === b.kind ? a.targetId.localeCompare(b.targetId) : a.kind.localeCompare(b.kind));

  return normalizeEnvelope({
    version: tokenVersion,
    action: "manual_stock_entry",
    userId: value.userId.toLowerCase(),
    lines,
    idempotencyKey: value.idempotencyKey.toLowerCase(),
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  }, 500);
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

function createToken<T extends StockEntryProposalPayload>(payload: T, secret: string) {
  if (!isSafeSecret(secret)) return null;
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

function verifyToken<T extends StockEntryProposalPayload>(
  token: string,
  secret: string,
  userId: string,
  parser: (value: unknown) => T | null,
  now = new Date(),
): VerificationResult<T> {
  if (!isSafeSecret(secret)) return { ok: false, reason: "configuration" };
  if (!token || token.length > maximumTokenLength || !uuidPattern.test(userId)) {
    return { ok: false, reason: "invalid" };
  }
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
  const payload = parser(decoded);
  if (!payload) return { ok: false, reason: "invalid" };
  if (payload.userId !== userId.toLowerCase()) return { ok: false, reason: "user_mismatch" };
  const seconds = Math.floor(now.getTime() / 1000);
  if (payload.expiresAt < seconds || payload.issuedAt > seconds + 60) {
    return { ok: false, reason: "expired", payload };
  }
  return { ok: true, payload };
}

export function createSupplierOrderStockEntryProposalToken(
  input: Omit<SupplierOrderStockEntryProposalPayload, "version" | "action" | "issuedAt" | "expiresAt">,
  secret: string,
  now = new Date(),
) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = parseSupplierOrderPayload({ version: tokenVersion, action: "supplier_order_stock_entry", ...input,
    issuedAt, expiresAt: issuedAt + stockEntryProposalLifetimeSeconds });
  if (!payload) return null;
  const token = createToken(payload, secret);
  return token ? { token, payload } : null;
}

export function createManualStockEntryProposalToken(
  input: Omit<ManualStockEntryProposalPayload, "version" | "action" | "issuedAt" | "expiresAt">,
  secret: string,
  now = new Date(),
) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = parseManualPayload({ version: tokenVersion, action: "manual_stock_entry", ...input,
    issuedAt, expiresAt: issuedAt + stockEntryProposalLifetimeSeconds });
  if (!payload) return null;
  const token = createToken(payload, secret);
  return token ? { token, payload } : null;
}

export const verifySupplierOrderStockEntryProposalToken = (
  token: string, secret: string, userId: string, now = new Date(),
) => verifyToken(token, secret, userId, parseSupplierOrderPayload, now);

export const verifyManualStockEntryProposalToken = (
  token: string, secret: string, userId: string, now = new Date(),
) => verifyToken(token, secret, userId, parseManualPayload, now);
