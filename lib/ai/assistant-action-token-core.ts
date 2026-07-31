import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { SupplierOrderPickupMode } from "@/lib/ai/supplier-order-pickup-routing";

export const assistantActionTokenLifetimeSeconds = 10 * 60;
const assistantActionTokenVersion = 1;
const maximumTokenLength = 4096;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupplierOrderPickupProposalPayload = {
  version: typeof assistantActionTokenVersion;
  action: "supplier_order_pickup";
  mode: SupplierOrderPickupMode;
  userId: string;
  supplierOrderId: string;
  supplierOrderItemId: string | null;
  requestedQuantity: number | null;
  targetPickedQuantity: number | null;
  expectedOrderUpdatedAt: string;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
};

type CreateSupplierOrderPickupProposalInput = Omit<
  SupplierOrderPickupProposalPayload,
  "version" | "action" | "issuedAt" | "expiresAt"
>;

export type VerifyAssistantActionTokenResult =
  | {
      ok: true;
      payload: SupplierOrderPickupProposalPayload;
    }
  | {
      ok: false;
      reason: "expired";
      payload: SupplierOrderPickupProposalPayload;
    }
  | {
      ok: false;
      reason:
        | "configuration"
        | "invalid"
        | "user_mismatch";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeSecret(secret: string) {
  return secret.trim().length >= 32;
}

function createSignature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest();
}

function parsePayload(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const keys = Object.keys(value);
  const expectedKeys = [
    "version",
    "action",
    "mode",
    "userId",
    "supplierOrderId",
    "supplierOrderItemId",
    "requestedQuantity",
    "targetPickedQuantity",
    "expectedOrderUpdatedAt",
    "idempotencyKey",
    "issuedAt",
    "expiresAt",
  ];

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(key)) ||
    value.version !== assistantActionTokenVersion ||
    value.action !== "supplier_order_pickup" ||
    !["increment", "set_total", "mark_all"].includes(String(value.mode)) ||
    typeof value.userId !== "string" ||
    !uuidPattern.test(value.userId) ||
    typeof value.supplierOrderId !== "string" ||
    !uuidPattern.test(value.supplierOrderId) ||
    (value.supplierOrderItemId !== null &&
      (typeof value.supplierOrderItemId !== "string" ||
        !uuidPattern.test(value.supplierOrderItemId))) ||
    (value.requestedQuantity !== null &&
      (!Number.isSafeInteger(value.requestedQuantity) ||
        Number(value.requestedQuantity) <= 0 ||
        Number(value.requestedQuantity) > 2_147_483_647)) ||
    (value.targetPickedQuantity !== null &&
      (!Number.isSafeInteger(value.targetPickedQuantity) ||
        Number(value.targetPickedQuantity) < 0 ||
        Number(value.targetPickedQuantity) > 2_147_483_647)) ||
    typeof value.expectedOrderUpdatedAt !== "string" ||
    Number.isNaN(Date.parse(value.expectedOrderUpdatedAt)) ||
    typeof value.idempotencyKey !== "string" ||
    !uuidPattern.test(value.idempotencyKey) ||
    !Number.isSafeInteger(value.issuedAt) ||
    !Number.isSafeInteger(value.expiresAt) ||
    Number(value.issuedAt) <= 0 ||
    Number(value.expiresAt) <= Number(value.issuedAt) ||
    Number(value.expiresAt) - Number(value.issuedAt) >
      assistantActionTokenLifetimeSeconds ||
    (value.mode === "mark_all"
      ? value.supplierOrderItemId !== null ||
        value.requestedQuantity !== null ||
        value.targetPickedQuantity !== null
      : value.supplierOrderItemId === null ||
        value.requestedQuantity === null ||
        value.targetPickedQuantity === null)
  ) {
    return null;
  }

  return {
    version: assistantActionTokenVersion,
    action: "supplier_order_pickup",
    mode: value.mode as SupplierOrderPickupMode,
    userId: value.userId.toLowerCase(),
    supplierOrderId: value.supplierOrderId.toLowerCase(),
    supplierOrderItemId:
      typeof value.supplierOrderItemId === "string"
        ? value.supplierOrderItemId.toLowerCase()
        : null,
    requestedQuantity:
      typeof value.requestedQuantity === "number"
        ? value.requestedQuantity
        : null,
    targetPickedQuantity:
      typeof value.targetPickedQuantity === "number"
        ? value.targetPickedQuantity
        : null,
    // Keep PostgreSQL's full timestamptz precision. Date#toISOString truncates
    // microseconds to milliseconds and would create a false version conflict.
    expectedOrderUpdatedAt: value.expectedOrderUpdatedAt,
    idempotencyKey: value.idempotencyKey.toLowerCase(),
    issuedAt: value.issuedAt as number,
    expiresAt: value.expiresAt as number,
  } satisfies SupplierOrderPickupProposalPayload;
}

export function createSupplierOrderPickupProposalToken(
  input: CreateSupplierOrderPickupProposalInput,
  secret: string,
  now = new Date(),
) {
  if (!isSafeSecret(secret)) {
    return null;
  }

  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = parsePayload({
    version: assistantActionTokenVersion,
    action: "supplier_order_pickup",
    ...input,
    issuedAt,
    expiresAt: issuedAt + assistantActionTokenLifetimeSeconds,
  });

  if (!payload) {
    return null;
  }

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
  const signature = createSignature(encodedPayload, secret).toString(
    "base64url",
  );

  return {
    token: `${encodedPayload}.${signature}`,
    payload,
  };
}

export function verifySupplierOrderPickupProposalToken(
  token: string,
  secret: string,
  expectedUserId: string,
  now = new Date(),
): VerifyAssistantActionTokenResult {
  if (!isSafeSecret(secret)) {
    return { ok: false, reason: "configuration" };
  }

  if (
    !token ||
    token.length > maximumTokenLength ||
    !uuidPattern.test(expectedUserId)
  ) {
    return { ok: false, reason: "invalid" };
  }

  const parts = token.split(".");

  if (
    parts.length !== 2 ||
    !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
  ) {
    return { ok: false, reason: "invalid" };
  }

  const [encodedPayload, encodedSignature] = parts;
  const suppliedSignature = Buffer.from(
    encodedSignature,
    "base64url",
  );
  const expectedSignature = createSignature(encodedPayload, secret);

  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return { ok: false, reason: "invalid" };
  }

  let decodedPayload: unknown;

  try {
    decodedPayload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const payload = parsePayload(decodedPayload);

  if (!payload) {
    return { ok: false, reason: "invalid" };
  }

  if (payload.userId !== expectedUserId.toLowerCase()) {
    return { ok: false, reason: "user_mismatch" };
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (
    payload.expiresAt < nowSeconds ||
    payload.issuedAt > nowSeconds + 60
  ) {
    return { ok: false, reason: "expired", payload };
  }

  return { ok: true, payload };
}
