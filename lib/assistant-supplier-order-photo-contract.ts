export const supplierOrderPhotoMaxFileBytes = 3_900_000;
export const supplierOrderPhotoClientTargetBytes = 3_500_000;
export const supplierOrderPhotoMaxLines = 1_000;
export const supplierOrderPhotoMaxQuantity = 2_147_483_647;
export const supplierOrderPhotoMaxDimension = 12_000;
export const supplierOrderPhotoMaxPixels = 60_000_000;
export const supplierOrderPhotoModel = "gemini-3.7-flash";

export const supplierOrderPhotoMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type SupplierOrderPhotoMimeType =
  (typeof supplierOrderPhotoMimeTypes)[number];

export type SupplierOrderPhotoExtraction = {
  documentType: "supplier_order" | "unknown";
  negotiationNumber: string | null;
  orderDate: string | null;
  lines: Array<{
    rawCode: string | null;
    rawDescription: string | null;
    quantity: number | null;
    needsReview: boolean;
    warning: string | null;
  }>;
  documentWarnings: string[];
};

export type AssistantSupplierOrderPhotoPreviewState =
  | "READY_FOR_REVIEW"
  | "NEEDS_REVIEW"
  | "DUPLICATE_NEGOTIATION"
  | "NOT_A_SUPPLIER_ORDER"
  | "UNREADABLE"
  | "ERROR";

export type AssistantSupplierOrderPhotoPreviewLine = {
  rawCode: string | null;
  displayCode: string | null;
  description: string | null;
  rawDescription: string | null;
  quantity: number | null;
  resolution: "IDENTIFIED" | "NEEDS_REVIEW";
  blockingReasons: Array<
    | "CODE_NOT_FOUND"
    | "CODE_MISSING"
    | "CODE_AMBIGUOUS"
    | "CODE_UNCERTAIN"
    | "DESCRIPTION_CONFLICT"
    | "QUANTITY_MISSING"
    | "VISUAL_REVIEW"
  >;
  descriptionMatch: "MATCH" | "NOT_PRESENT" | "CONFLICT" | "UNCERTAIN";
  warning: string | null;
  consolidatedLineCount: number;
};

export type AssistantSupplierOrderPhotoPreviewBlock = {
  kind: "supplier_order_photo_preview";
  state: AssistantSupplierOrderPhotoPreviewState;
  title: string;
  message: string;
  banner: "Somente prévia — nenhum Pedido foi criado.";
  negotiationNumber: string | null;
  orderDate: string | null;
  lines: AssistantSupplierOrderPhotoPreviewLine[];
  totalQuantity: number;
  warnings: string[];
  existingOrder: {
    negotiationNumber: string;
    status: string;
    href: string;
  } | null;
  fallbackText: string;
};

export type SupplierOrderPhotoInterpretSuccess = {
  message: string;
  structuredBlock: AssistantSupplierOrderPhotoPreviewBlock;
};

export type SupplierOrderPhotoInterpretError = { error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function parseNullableText(
  value: unknown,
  maximumLength: number,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) return undefined;
  return normalized;
}

function isRealIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseSupplierOrderPhotoExtraction(
  value: unknown,
): SupplierOrderPhotoExtraction | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "documentType",
      "negotiationNumber",
      "orderDate",
      "lines",
      "documentWarnings",
    ]) ||
    (value.documentType !== "supplier_order" &&
      value.documentType !== "unknown") ||
    !Array.isArray(value.lines) ||
    value.lines.length > supplierOrderPhotoMaxLines ||
    !Array.isArray(value.documentWarnings) ||
    value.documentWarnings.length > 50
  ) {
    return null;
  }

  const negotiationNumber = parseNullableText(value.negotiationNumber, 120);
  const orderDate = parseNullableText(value.orderDate, 10);
  if (
    negotiationNumber === undefined ||
    orderDate === undefined ||
    (orderDate !== null && !isRealIsoDate(orderDate))
  ) {
    return null;
  }

  const documentWarnings: string[] = [];
  for (const warning of value.documentWarnings) {
    const parsed = parseNullableText(warning, 300);
    if (parsed === undefined || parsed === null) return null;
    documentWarnings.push(parsed);
  }

  const lines: SupplierOrderPhotoExtraction["lines"] = [];
  for (const rawLine of value.lines) {
    if (
      !isRecord(rawLine) ||
      !hasExactKeys(rawLine, [
        "rawCode",
        "rawDescription",
        "quantity",
        "needsReview",
        "warning",
      ]) ||
      typeof rawLine.needsReview !== "boolean"
    ) {
      return null;
    }

    const rawCode = parseNullableText(rawLine.rawCode, 120);
    const rawDescription = parseNullableText(rawLine.rawDescription, 500);
    const warning = parseNullableText(rawLine.warning, 300);
    if (
      rawCode === undefined ||
      rawDescription === undefined ||
      warning === undefined ||
      (rawLine.quantity !== null &&
        (typeof rawLine.quantity !== "number" ||
          !Number.isInteger(rawLine.quantity) ||
          rawLine.quantity < 1 ||
          rawLine.quantity > supplierOrderPhotoMaxQuantity))
    ) {
      return null;
    }

    lines.push({
      rawCode,
      rawDescription,
      quantity: rawLine.quantity as number | null,
      needsReview: rawLine.needsReview,
      warning,
    });
  }

  return {
    documentType: value.documentType,
    negotiationNumber,
    orderDate,
    lines,
    documentWarnings,
  };
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

export function detectSupplierOrderPhotoMimeType(
  bytes: Uint8Array,
): SupplierOrderPhotoMimeType | null {
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (
    bytes.length >= 12 &&
    new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder("ascii").decode(bytes.slice(4, 8)) === "ftyp"
  ) {
    const brand = new TextDecoder("ascii").decode(bytes.slice(8, 12));
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["heif", "mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

export function validateSupplierOrderPhotoBytes(
  declaredMimeType: string,
  bytes: Uint8Array,
): { ok: true; mimeType: SupplierOrderPhotoMimeType } | { ok: false } {
  const detected = detectSupplierOrderPhotoMimeType(bytes);
  if (!detected || !supplierOrderPhotoMimeTypes.includes(declaredMimeType as SupplierOrderPhotoMimeType)) {
    return { ok: false };
  }
  const compatible =
    detected === declaredMimeType ||
    ([detected, declaredMimeType].every((mime) =>
      mime === "image/heic" || mime === "image/heif",
    ));
  return compatible ? { ok: true, mimeType: detected } : { ok: false };
}

function readUint16BigEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

export function readSupplierOrderPhotoDimensions(
  bytes: Uint8Array,
  mimeType: SupplierOrderPhotoMimeType,
): { width: number; height: number } | null {
  if (mimeType === "image/png" && bytes.length >= 24) {
    return { width: readUint32BigEndian(bytes, 16), height: readUint32BigEndian(bytes, 20) };
  }
  if (mimeType === "image/jpeg") {
    let offset = 2;
    const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (startOfFrameMarkers.has(marker)) {
        return {
          height: readUint16BigEndian(bytes, offset + 5),
          width: readUint16BigEndian(bytes, offset + 7),
        };
      }
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = readUint16BigEndian(bytes, offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }
  if (mimeType === "image/webp" && bytes.length >= 30) {
    const chunk = new TextDecoder("ascii").decode(bytes.slice(12, 16));
    if (chunk === "VP8X") {
      return {
        width: readUint24LittleEndian(bytes, 24) + 1,
        height: readUint24LittleEndian(bytes, 27) + 1,
      };
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: readUint16BigEndian(Uint8Array.from([bytes[27], bytes[26]]), 0) & 0x3fff,
        height: readUint16BigEndian(Uint8Array.from([bytes[29], bytes[28]]), 0) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
      return {
        width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)),
        height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)),
      };
    }
  }
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    const marker = [0x69, 0x73, 0x70, 0x65];
    for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
      if (marker.every((byte, index) => bytes[offset + index] === byte)) {
        return {
          width: readUint32BigEndian(bytes, offset + 8),
          height: readUint32BigEndian(bytes, offset + 12),
        };
      }
    }
  }
  return null;
}

export function supplierOrderPhotoDimensionsAreSafe(
  dimensions: { width: number; height: number } | null,
) {
  return Boolean(
    dimensions &&
    Number.isSafeInteger(dimensions.width) && dimensions.width > 0 &&
    Number.isSafeInteger(dimensions.height) && dimensions.height > 0 &&
    dimensions.width <= supplierOrderPhotoMaxDimension &&
    dimensions.height <= supplierOrderPhotoMaxDimension &&
    dimensions.width * dimensions.height <= supplierOrderPhotoMaxPixels,
  );
}

export function parseAssistantSupplierOrderPhotoPreviewBlock(
  value: unknown,
): AssistantSupplierOrderPhotoPreviewBlock | null {
  if (
    !isRecord(value) ||
    value.kind !== "supplier_order_photo_preview" ||
    !hasExactKeys(value, [
      "kind", "state", "title", "message", "banner", "negotiationNumber",
      "orderDate", "lines", "totalQuantity", "warnings", "existingOrder", "fallbackText",
    ])
  ) return null;
  const states: AssistantSupplierOrderPhotoPreviewState[] = [
    "READY_FOR_REVIEW", "NEEDS_REVIEW", "DUPLICATE_NEGOTIATION",
    "NOT_A_SUPPLIER_ORDER", "UNREADABLE", "ERROR",
  ];
  if (
    !states.includes(value.state as AssistantSupplierOrderPhotoPreviewState) ||
    typeof value.title !== "string" || !value.title.trim() || value.title.length > 120 ||
    typeof value.message !== "string" || !value.message.trim() || value.message.length > 500 ||
    value.banner !== "Somente prévia — nenhum Pedido foi criado." ||
    (value.negotiationNumber !== null &&
      (typeof value.negotiationNumber !== "string" || value.negotiationNumber.length > 120)) ||
    (value.orderDate !== null &&
      (typeof value.orderDate !== "string" || !isRealIsoDate(value.orderDate))) ||
    !Array.isArray(value.lines) || value.lines.length > supplierOrderPhotoMaxLines ||
    !Number.isSafeInteger(value.totalQuantity) || (value.totalQuantity as number) < 0 ||
    !Array.isArray(value.warnings) || value.warnings.length > 100 ||
    typeof value.fallbackText !== "string" || !value.fallbackText.trim() || value.fallbackText.length > 2_000
  ) return null;

  const warnings = value.warnings.every((item) => typeof item === "string" && item.trim() && item.length <= 300)
    ? value.warnings.map((item) => (item as string).trim())
    : null;
  if (!warnings) return null;
  const lines: AssistantSupplierOrderPhotoPreviewLine[] = [];
  for (const raw of value.lines) {
    if (!isRecord(raw) || !hasExactKeys(raw, [
      "rawCode", "displayCode", "description", "rawDescription", "quantity",
      "resolution", "blockingReasons", "descriptionMatch", "warning", "consolidatedLineCount",
    ])) return null;
    const rawCode = parseNullableText(raw.rawCode, 120);
    const displayCode = parseNullableText(raw.displayCode, 120);
    const description = parseNullableText(raw.description, 500);
    const rawDescription = parseNullableText(raw.rawDescription, 500);
    const warning = parseNullableText(raw.warning, 300);
    if (
      rawCode === undefined || displayCode === undefined || description === undefined ||
      rawDescription === undefined || warning === undefined ||
      (raw.quantity !== null && (!Number.isSafeInteger(raw.quantity) || (raw.quantity as number) < 1)) ||
      !["IDENTIFIED", "NEEDS_REVIEW"].includes(String(raw.resolution)) ||
      !Array.isArray(raw.blockingReasons) || raw.blockingReasons.length > 6 ||
      raw.blockingReasons.some((reason) => ![
        "CODE_NOT_FOUND", "CODE_MISSING", "CODE_AMBIGUOUS", "CODE_UNCERTAIN",
        "DESCRIPTION_CONFLICT", "QUANTITY_MISSING", "VISUAL_REVIEW",
      ].includes(String(reason))) ||
      !["MATCH", "NOT_PRESENT", "CONFLICT", "UNCERTAIN"].includes(String(raw.descriptionMatch)) ||
      !Number.isSafeInteger(raw.consolidatedLineCount) || (raw.consolidatedLineCount as number) < 1
    ) return null;
    lines.push({ rawCode, displayCode, description, rawDescription,
      quantity: raw.quantity as number | null,
      resolution: raw.resolution as AssistantSupplierOrderPhotoPreviewLine["resolution"],
      blockingReasons: raw.blockingReasons as AssistantSupplierOrderPhotoPreviewLine["blockingReasons"],
      descriptionMatch: raw.descriptionMatch as AssistantSupplierOrderPhotoPreviewLine["descriptionMatch"],
      warning, consolidatedLineCount: raw.consolidatedLineCount as number });
  }
  const total = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  if (total !== value.totalQuantity) return null;

  let existingOrder: AssistantSupplierOrderPhotoPreviewBlock["existingOrder"] = null;
  if (value.existingOrder !== null) {
    if (!isRecord(value.existingOrder) ||
      !hasExactKeys(value.existingOrder, ["negotiationNumber", "status", "href"]) ||
      typeof value.existingOrder.negotiationNumber !== "string" ||
      !/^[0-9]{1,120}$/.test(value.existingOrder.negotiationNumber) ||
      !["PENDING", "PARTIAL", "COMPLETED", "CANCELLED"].includes(String(value.existingOrder.status)) ||
      typeof value.existingOrder.href !== "string" ||
      !/^\/pedidos\?view=(?:active|history)&order=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.existingOrder.href)) return null;
    existingOrder = {
      negotiationNumber: value.existingOrder.negotiationNumber,
      status: value.existingOrder.status as string,
      href: value.existingOrder.href,
    };
  }

  return {
    kind: "supplier_order_photo_preview",
    state: value.state as AssistantSupplierOrderPhotoPreviewState,
    title: value.title.trim(), message: value.message.trim(),
    banner: "Somente prévia — nenhum Pedido foi criado.",
    negotiationNumber: value.negotiationNumber as string | null,
    orderDate: value.orderDate as string | null,
    lines, totalQuantity: value.totalQuantity as number, warnings,
    existingOrder, fallbackText: value.fallbackText.trim(),
  };
}
