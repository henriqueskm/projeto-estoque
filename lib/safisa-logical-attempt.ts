export type SafisaAttemptPayload =
  | {
      kind: "INCREMENT_READY_QUANTITY";
      supplierOrderId: string;
      supplierOrderItemId: string;
      incrementQuantity: number;
    }
  | {
      kind: "MARK_LINE_REMAINING_READY";
      supplierOrderId: string;
      supplierOrderItemId: string;
      incrementQuantity: number;
    }
  | {
      kind: "MARK_ORDER_REMAINING_READY";
      supplierOrderId: string;
    }
  | {
      kind: "CORRECT_READY_QUANTITY";
      supplierOrderId: string;
      supplierOrderItemId: string;
      newReadyQuantity: number;
      justification: string;
      expectedUpdatedAt: string;
    };

export type SafisaLogicalAttempt = {
  idempotencyKey: string;
  canonicalPayload: string;
  payload: SafisaAttemptPayload;
  state: "SUBMITTING" | "RESULT_UNKNOWN";
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function parsePayload(value: unknown): SafisaAttemptPayload | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;

  if (value.kind === "MARK_ORDER_REMAINING_READY") {
    return hasExactKeys(value, ["kind", "supplierOrderId"]) &&
      isUuid(value.supplierOrderId)
      ? value as SafisaAttemptPayload
      : null;
  }

  if (
    value.kind === "INCREMENT_READY_QUANTITY" ||
    value.kind === "MARK_LINE_REMAINING_READY"
  ) {
    return hasExactKeys(value, [
      "incrementQuantity",
      "kind",
      "supplierOrderId",
      "supplierOrderItemId",
    ]) &&
      isUuid(value.supplierOrderId) &&
      isUuid(value.supplierOrderItemId) &&
      isPositiveInteger(value.incrementQuantity)
      ? value as SafisaAttemptPayload
      : null;
  }

  if (value.kind === "CORRECT_READY_QUANTITY") {
    return hasExactKeys(value, [
      "expectedUpdatedAt",
      "justification",
      "kind",
      "newReadyQuantity",
      "supplierOrderId",
      "supplierOrderItemId",
    ]) &&
      isUuid(value.supplierOrderId) &&
      isUuid(value.supplierOrderItemId) &&
      Number.isSafeInteger(value.newReadyQuantity) &&
      (value.newReadyQuantity as number) >= 0 &&
      typeof value.justification === "string" &&
      value.justification.trim().length > 0 &&
      value.justification.length <= 500 &&
      typeof value.expectedUpdatedAt === "string" &&
      !Number.isNaN(Date.parse(value.expectedUpdatedAt))
      ? value as SafisaAttemptPayload
      : null;
  }

  return null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

export function canonicalSafisaAttemptPayload(payload: SafisaAttemptPayload) {
  return JSON.stringify(canonicalValue(payload));
}

export function beginSafisaLogicalAttempt(
  current: SafisaLogicalAttempt | null,
  payload: SafisaAttemptPayload,
  createIdempotencyKey: () => string,
): SafisaLogicalAttempt {
  const canonicalPayload = canonicalSafisaAttemptPayload(payload);

  if (current?.canonicalPayload === canonicalPayload) {
    return { ...current, payload, state: "SUBMITTING" };
  }

  return {
    idempotencyKey: createIdempotencyKey(),
    canonicalPayload,
    payload,
    state: "SUBMITTING",
  };
}

export function markSafisaAttemptResultUnknown(
  attempt: SafisaLogicalAttempt,
): SafisaLogicalAttempt {
  return { ...attempt, state: "RESULT_UNKNOWN" };
}

export function serializeSafisaLogicalAttempt(attempt: SafisaLogicalAttempt) {
  return JSON.stringify(attempt);
}

export function restoreSafisaLogicalAttempt(serialized: string): SafisaLogicalAttempt | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["canonicalPayload", "idempotencyKey", "payload", "state"]) ||
      (value.state !== "SUBMITTING" && value.state !== "RESULT_UNKNOWN") ||
      !isUuid(value.idempotencyKey) ||
      typeof value.canonicalPayload !== "string"
    ) {
      return null;
    }

    const payload = parsePayload(value.payload);
    if (!payload || canonicalSafisaAttemptPayload(payload) !== value.canonicalPayload) {
      return null;
    }

    return {
      idempotencyKey: value.idempotencyKey,
      canonicalPayload: value.canonicalPayload,
      payload,
      // A request that was submitting when the page unloaded is now unknown.
      state: "RESULT_UNKNOWN",
    };
  } catch {
    return null;
  }
}
