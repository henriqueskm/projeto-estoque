import type {
  AssistantSupplierOrderPhotoPreviewBlock,
  SupplierOrderPhotoExtraction,
} from "./assistant-supplier-order-photo-contract.ts";

export type SupplierOrderPhotoCatalogTarget = {
  identity: string;
  codeIdentity: string;
  code: string;
  description: string;
};

export type SupplierOrderPhotoExistingOrder = {
  negotiationNumber: string;
  status: string;
  href: string;
};

export type SupplierOrderPhotoDependencies = {
  extract: () => Promise<SupplierOrderPhotoExtraction>;
  loadCatalog: () => Promise<SupplierOrderPhotoCatalogTarget[]>;
  findExistingOrder: (negotiationNumber: string) => Promise<SupplierOrderPhotoExistingOrder | null>;
};

function normalizeCode(value: string) {
  return value.trim().toLocaleUpperCase("pt-BR");
}

function normalizeDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function servoModel(value: string) {
  const match = normalizeDescription(value).match(/\bSERVO\s+([A-Z]{2,4})\s+(\d{2,3})\b/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function repairNumber(value: string) {
  const match = normalizeDescription(value).match(/\b(?:JG\s+|JOGO\s+)?(?:DE\s+)?REPARO\s+0*(\d+)\b/);
  return match?.[1] ?? null;
}

function isInformationalAnnotationWarning(warning: string | null) {
  if (!warning) return false;
  const normalized = normalizeDescription(warning);
  if (!/\b(?:ANOTACAO|MANUSCRIT)/.test(normalized)) return false;
  return !/\b(?:COBRE|COBRINDO|SOBREPOE|ALTERA|ALTERANDO|CONTRADIZ|SUBSTITUI|ILEGIVEL|INCERTO|INCERTA|DUVIDA)\b/.test(normalized);
}

function descriptionMatch(
  rawDescription: string | null,
  officialDescription: string,
): "MATCH" | "NOT_PRESENT" | "CONFLICT" | "UNCERTAIN" {
  if (!rawDescription) return "NOT_PRESENT";
  const raw = normalizeDescription(rawDescription);
  const official = normalizeDescription(officialDescription);
  if (raw === official || raw.includes(official) || official.includes(raw)) return "MATCH";
  const rawServoModel = servoModel(raw);
  const officialServoModel = servoModel(official);
  if (rawServoModel && officialServoModel) {
    return rawServoModel === officialServoModel ? "MATCH" : "CONFLICT";
  }
  const rawRepairNumber = repairNumber(raw);
  const officialRepairNumber = repairNumber(official);
  if (rawRepairNumber && officialRepairNumber) {
    return rawRepairNumber === officialRepairNumber ? "MATCH" : "CONFLICT";
  }
  return "UNCERTAIN";
}

function createBase(
  overrides: Partial<AssistantSupplierOrderPhotoPreviewBlock>,
): AssistantSupplierOrderPhotoPreviewBlock {
  return {
    kind: "supplier_order_photo_preview",
    state: "NEEDS_REVIEW",
    title: "Pedido identificado",
    message: "Revise os dados extraídos da foto.",
    banner: "Somente prévia — nenhum Pedido foi criado.",
    negotiationNumber: null,
    orderDate: null,
    lines: [],
    totalQuantity: 0,
    warnings: [],
    existingOrder: null,
    fallbackText: "A foto foi analisada, mas nenhum Pedido foi criado.",
    ...overrides,
  };
}

export async function interpretSupplierOrderPhoto(
  dependencies: SupplierOrderPhotoDependencies,
): Promise<AssistantSupplierOrderPhotoPreviewBlock> {
  const extraction = await dependencies.extract();
  if (extraction.documentType !== "supplier_order") {
    return createBase({
      state: "NOT_A_SUPPLIER_ORDER",
      title: "Documento não identificado",
      message: "A imagem não parece ser um Pedido de fornecedor.",
      warnings: extraction.documentWarnings,
    });
  }

  const negotiationNumber = extraction.negotiationNumber?.trim() ?? null;
  const negotiationIsValid = Boolean(negotiationNumber && /^[0-9]{1,120}$/.test(negotiationNumber));
  const [catalog, existingOrder] = await Promise.all([
    dependencies.loadCatalog(),
    negotiationIsValid
      ? dependencies.findExistingOrder(negotiationNumber as string)
      : Promise.resolve(null),
  ]);
  const targetsByCode = new Map<string, SupplierOrderPhotoCatalogTarget[]>();
  for (const target of catalog) {
    const code = normalizeCode(target.code);
    const matches = targetsByCode.get(code) ?? [];
    matches.push(target);
    targetsByCode.set(code, matches);
  }

  const resolved = extraction.lines.map((line) => {
    const candidates = line.rawCode ? (targetsByCode.get(normalizeCode(line.rawCode)) ?? []) : [];
    const target = candidates.length === 1 ? candidates[0] : null;
    const match = target ? descriptionMatch(line.rawDescription, target.description) : "UNCERTAIN";
    const modelNeedsReview = line.needsReview && !isInformationalAnnotationWarning(line.warning);
    const needsReview =
      modelNeedsReview || !line.rawCode || !line.quantity || !target || match === "CONFLICT";
    const warning =
      line.warning ??
      (!line.rawCode
        ? "O código não pôde ser lido."
        : candidates.length === 0
          ? `O Cód. ${line.rawCode} não foi identificado no catálogo.`
          : candidates.length > 1
            ? `O Cód. ${line.rawCode} possui mais de uma correspondência.`
            : !line.quantity
              ? "A quantidade não pôde ser lida com segurança."
              : match === "CONFLICT"
                ? "A descrição da foto diverge do catálogo oficial."
                : match === "UNCERTAIN"
                  ? "A descrição comercial é parcial ou abreviada; a identidade foi confirmada pelo código oficial."
                  : null);
    return {
      identity: target ? `${target.identity}:${target.codeIdentity}` : null,
      line: {
        rawCode: line.rawCode,
        displayCode: target?.code ?? null,
        description: target?.description ?? null,
        rawDescription: line.rawDescription,
        quantity: line.quantity,
        resolution: needsReview ? "NEEDS_REVIEW" as const : "IDENTIFIED" as const,
        descriptionMatch: match,
        warning,
        consolidatedLineCount: 1,
      },
    };
  });

  const consolidated: typeof resolved = [];
  const indexByIdentity = new Map<string, number>();
  for (const entry of resolved) {
    if (!entry.identity || entry.line.resolution !== "IDENTIFIED" || entry.line.quantity === null) {
      consolidated.push(entry);
      continue;
    }
    const previousIndex = indexByIdentity.get(entry.identity);
    if (previousIndex === undefined) {
      indexByIdentity.set(entry.identity, consolidated.length);
      consolidated.push(entry);
      continue;
    }
    const previous = consolidated[previousIndex];
    const combinedQuantity = (previous.line.quantity ?? 0) + entry.line.quantity;
    if (Number.isSafeInteger(combinedQuantity) && combinedQuantity <= 2_147_483_647) {
      previous.line.quantity = combinedQuantity;
      previous.line.consolidatedLineCount += 1;
      previous.line.warning = "Linhas repetidas do mesmo código foram consolidadas nesta prévia.";
    } else {
      consolidated.push({
        ...entry,
        line: { ...entry.line, resolution: "NEEDS_REVIEW", warning: "A soma das quantidades excede o limite seguro." },
      });
    }
  }

  const lines = consolidated.map((entry) => entry.line);
  const totalQuantity = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  const warnings = [...extraction.documentWarnings];
  if (!negotiationIsValid) warnings.push("A negociação deve conter somente dígitos, preservando zeros à esquerda.");
  if (!extraction.orderDate) warnings.push("A data do Pedido não pôde ser confirmada.");
  if (lines.length === 0) warnings.push("Nenhuma linha de item pôde ser lida.");

  if (existingOrder) {
    return createBase({
      state: "DUPLICATE_NEGOTIATION",
      title: "Este Pedido já existe",
      message: `A negociação ${existingOrder.negotiationNumber} já está cadastrada.`,
      negotiationNumber,
      orderDate: extraction.orderDate,
      lines,
      totalQuantity,
      warnings,
      existingOrder,
      fallbackText: `O Pedido ${existingOrder.negotiationNumber} já existe. Nenhum Pedido foi criado.`,
    });
  }

  const needsReview =
    !negotiationIsValid || !extraction.orderDate || lines.length === 0 ||
    lines.some((line) => line.resolution === "NEEDS_REVIEW");
  return createBase({
    state: needsReview ? (lines.length === 0 ? "UNREADABLE" : "NEEDS_REVIEW") : "READY_FOR_REVIEW",
    title: needsReview ? "Pedido precisa de revisão" : "Pedido identificado",
    message: needsReview
      ? "Alguns dados não puderam ser confirmados com segurança."
      : "Confira os dados extraídos e validados no catálogo oficial.",
    negotiationNumber,
    orderDate: extraction.orderDate,
    lines,
    totalQuantity,
    warnings,
    fallbackText: needsReview
      ? "A foto foi analisada e precisa de revisão. Nenhum Pedido foi criado."
      : `Pedido ${negotiationNumber} identificado em prévia. Nenhum Pedido foi criado.`,
  });
}
