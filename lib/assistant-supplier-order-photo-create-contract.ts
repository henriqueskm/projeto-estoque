import type { AssistantSupplierOrderPhotoPreviewBlock } from "./assistant-supplier-order-photo-contract.ts";

export const supplierOrderPhotoCreateMaxLines = 100;
export const supplierOrderPhotoCreateMaxRequestLines = 1_000;
export const supplierOrderPhotoCreateMaxBodyBytes = 256_000;
export const supplierOrderPhotoCreateMaxTokenLength = 65_536;
export const supplierOrderPhotoCreateConfirmBodyBytes = 70_000;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupplierOrderPhotoCreatePrepareInput = {
  negotiationNumber: string;
  orderDate: string;
  lines: Array<{ code: string; quantity: number }>;
};

export type SupplierOrderPhotoCreateCanonicalLine = {
  kind: "ITEM" | "COMMERCIAL_CONFIGURATION";
  targetId: string;
  commercialConfigurationCodeId: string | null;
  code: string;
  description: string;
  quantity: number;
};

export type SupplierOrderPhotoCreatePreparation = {
  negotiationNumber: string;
  orderDate: string;
  lines: SupplierOrderPhotoCreateCanonicalLine[];
  lineCount: number;
  totalQuantity: number;
  proposalToken: string;
  expiresAt: string;
};

export type AssistantSupplierOrderPhotoCreateResultBlock = {
  kind: "supplier_order_photo_create_result";
  outcome: "success" | "duplicate";
  title: string;
  message: string;
  order: {
    negotiationNumber: string;
    status: "PENDING" | "PARTIAL" | "COMPLETED" | "CANCELLED";
    href: string;
  };
  lineCount: number;
  totalQuantity: number;
  fallbackText: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

export function isRealSupplierOrderPhotoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function parseSupplierOrderPhotoCreatePrepareInput(
  value: unknown,
): SupplierOrderPhotoCreatePrepareInput | null {
  if (!isRecord(value) || !hasExactKeys(value, ["negotiationNumber", "orderDate", "lines"]) ||
    typeof value.negotiationNumber !== "string" ||
    !/^[0-9]{1,120}$/.test(value.negotiationNumber.trim()) ||
    typeof value.orderDate !== "string" || !isRealSupplierOrderPhotoDate(value.orderDate) ||
    !Array.isArray(value.lines) || value.lines.length < 1 ||
    value.lines.length > supplierOrderPhotoCreateMaxRequestLines) return null;
  const lines: SupplierOrderPhotoCreatePrepareInput["lines"] = [];
  for (const raw of value.lines) {
    if (!isRecord(raw) || !hasExactKeys(raw, ["code", "quantity"]) ||
      typeof raw.code !== "string" || !raw.code.trim() || raw.code.trim().length > 120 ||
      !Number.isInteger(raw.quantity) || Number(raw.quantity) < 1 ||
      Number(raw.quantity) > 2_147_483_647) return null;
    lines.push({ code: raw.code.trim(), quantity: Number(raw.quantity) });
  }
  return { negotiationNumber: value.negotiationNumber.trim(), orderDate: value.orderDate, lines };
}

export function supplierOrderPhotoPreviewCanCreate(
  block: AssistantSupplierOrderPhotoPreviewBlock,
) {
  return block.state === "READY_FOR_REVIEW" &&
    Boolean(block.negotiationNumber && /^[0-9]{1,120}$/.test(block.negotiationNumber)) &&
    Boolean(block.orderDate && isRealSupplierOrderPhotoDate(block.orderDate)) &&
    block.lines.length > 0 && !block.existingOrder &&
    block.lines.every((line) => line.resolution === "IDENTIFIED" &&
      line.blockingReasons.length === 0 && Boolean(line.displayCode) &&
      Number.isInteger(line.quantity) && Number(line.quantity) > 0 &&
      Number(line.quantity) <= 2_147_483_647);
}

export function createSupplierOrderPhotoPrepareInputFromPreview(
  block: AssistantSupplierOrderPhotoPreviewBlock,
): SupplierOrderPhotoCreatePrepareInput | null {
  if (!supplierOrderPhotoPreviewCanCreate(block)) return null;
  return {
    negotiationNumber: block.negotiationNumber as string,
    orderDate: block.orderDate as string,
    lines: block.lines.map((line) => ({
      code: line.displayCode as string,
      quantity: line.quantity as number,
    })),
  };
}

export function parseSupplierOrderPhotoCreatePreparation(
  value: unknown,
): SupplierOrderPhotoCreatePreparation | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "negotiationNumber", "orderDate", "lines", "lineCount", "totalQuantity",
    "proposalToken", "expiresAt",
  ]) || typeof value.negotiationNumber !== "string" ||
    !/^[0-9]{1,120}$/.test(value.negotiationNumber) ||
    typeof value.orderDate !== "string" || !isRealSupplierOrderPhotoDate(value.orderDate) ||
    !Array.isArray(value.lines) || value.lines.length < 1 ||
    value.lines.length > supplierOrderPhotoCreateMaxLines ||
    value.lineCount !== value.lines.length || !Number.isInteger(value.totalQuantity) ||
    Number(value.totalQuantity) < 1 || typeof value.proposalToken !== "string" ||
    value.proposalToken.length > supplierOrderPhotoCreateMaxTokenLength ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.proposalToken) ||
    typeof value.expiresAt !== "string" || Number.isNaN(Date.parse(value.expiresAt))) return null;
  const lines: SupplierOrderPhotoCreateCanonicalLine[] = [];
  for (const raw of value.lines) {
    if (!isRecord(raw) || !hasExactKeys(raw, [
      "kind", "targetId", "commercialConfigurationCodeId", "code", "description", "quantity",
    ]) || !["ITEM", "COMMERCIAL_CONFIGURATION"].includes(String(raw.kind)) ||
      typeof raw.targetId !== "string" || !uuidPattern.test(raw.targetId) ||
      (raw.commercialConfigurationCodeId !== null &&
        (typeof raw.commercialConfigurationCodeId !== "string" ||
          !uuidPattern.test(raw.commercialConfigurationCodeId))) ||
      (raw.kind === "ITEM" && raw.commercialConfigurationCodeId !== null) ||
      (raw.kind === "COMMERCIAL_CONFIGURATION" && raw.commercialConfigurationCodeId === null) ||
      typeof raw.code !== "string" || !raw.code.trim() || raw.code.length > 120 ||
      typeof raw.description !== "string" || !raw.description.trim() || raw.description.length > 500 ||
      !Number.isInteger(raw.quantity) || Number(raw.quantity) < 1 ||
      Number(raw.quantity) > 2_147_483_647) return null;
    lines.push({
      kind: raw.kind as SupplierOrderPhotoCreateCanonicalLine["kind"],
      targetId: raw.targetId.toLowerCase(),
      commercialConfigurationCodeId: typeof raw.commercialConfigurationCodeId === "string"
        ? raw.commercialConfigurationCodeId.toLowerCase() : null,
      code: raw.code.trim(), description: raw.description.trim(), quantity: Number(raw.quantity),
    });
  }
  if (lines.reduce((sum, line) => sum + line.quantity, 0) !== value.totalQuantity) return null;
  return {
    negotiationNumber: value.negotiationNumber, orderDate: value.orderDate, lines,
    lineCount: value.lineCount as number, totalQuantity: value.totalQuantity as number,
    proposalToken: value.proposalToken, expiresAt: value.expiresAt,
  };
}

export function parseAssistantSupplierOrderPhotoCreateResultBlock(
  value: unknown,
): AssistantSupplierOrderPhotoCreateResultBlock | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "kind", "outcome", "title", "message", "order", "lineCount", "totalQuantity", "fallbackText",
  ]) || value.kind !== "supplier_order_photo_create_result" ||
    !["success", "duplicate"].includes(String(value.outcome)) ||
    typeof value.title !== "string" || !value.title.trim() || value.title.length > 120 ||
    typeof value.message !== "string" || !value.message.trim() || value.message.length > 500 ||
    !isRecord(value.order) || !hasExactKeys(value.order, ["negotiationNumber", "status", "href"]) ||
    typeof value.order.negotiationNumber !== "string" ||
    !/^[0-9]{1,120}$/.test(value.order.negotiationNumber) ||
    !["PENDING", "PARTIAL", "COMPLETED", "CANCELLED"].includes(String(value.order.status)) ||
    typeof value.order.href !== "string" ||
    !/^\/pedidos\?view=(?:active|history)&order=[0-9a-f-]{36}$/i.test(value.order.href) ||
    !Number.isInteger(value.lineCount) || Number(value.lineCount) < 0 ||
    !Number.isInteger(value.totalQuantity) || Number(value.totalQuantity) < 0 ||
    typeof value.fallbackText !== "string" || !value.fallbackText.trim() ||
    value.fallbackText.length > 1_000) return null;
  return {
    kind: "supplier_order_photo_create_result",
    outcome: value.outcome as "success" | "duplicate",
    title: value.title.trim(), message: value.message.trim(),
    order: {
      negotiationNumber: value.order.negotiationNumber,
      status: value.order.status as AssistantSupplierOrderPhotoCreateResultBlock["order"]["status"],
      href: value.order.href,
    },
    lineCount: Number(value.lineCount), totalQuantity: Number(value.totalQuantity),
    fallbackText: value.fallbackText.trim(),
  };
}
