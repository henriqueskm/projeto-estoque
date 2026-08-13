import { randomUUID } from "node:crypto";
import type { SupplierOrderActionResult, SupplierOrderLineInput } from "./supplier-orders-types.ts";
import type {
  AssistantSupplierOrderPhotoCreateResultBlock,
  SupplierOrderPhotoCreateCanonicalLine,
  SupplierOrderPhotoCreatePrepareInput,
  SupplierOrderPhotoCreatePreparation,
} from "./assistant-supplier-order-photo-create-contract.ts";
import type { SupplierOrderPhotoCatalogTarget } from "./assistant-supplier-order-photo.ts";
import type {
  SupplierOrderPhotoCreateProposalPayload,
  SupplierOrderPhotoCreateTokenVerification,
} from "./ai/supplier-order-photo-create-token.ts";

const supplierOrderPhotoCreateMaxLines = 100;

function resolveSupplierOrderPhotoCatalogCode(
  catalog: SupplierOrderPhotoCatalogTarget[],
  code: string,
) {
  const normalized = code.trim().toLocaleUpperCase("pt-BR");
  const matches = catalog.filter(
    (target) => target.code.trim().toLocaleUpperCase("pt-BR") === normalized,
  );
  return matches.length === 1 ? { kind: "FOUND" as const, target: matches[0] }
    : matches.length === 0 ? { kind: "NOT_FOUND" as const }
      : { kind: "AMBIGUOUS" as const };
}

export type SupplierOrderPhotoCreateExistingOrder = {
  id: string;
  negotiationNumber: string;
  status: "PENDING" | "PARTIAL" | "COMPLETED" | "CANCELLED";
  isInHistory: boolean;
};

type PrepareDependencies = {
  loadCatalog: () => Promise<SupplierOrderPhotoCatalogTarget[]>;
  findExistingOrder: (negotiationNumber: string) => Promise<SupplierOrderPhotoCreateExistingOrder | null>;
  createProposal: (input: {
    userId: string;
    negotiationNumber: string;
    orderDate: string;
    lines: SupplierOrderPhotoCreateProposalPayload["lines"];
    idempotencyKey: string;
  }) => { token: string; payload: SupplierOrderPhotoCreateProposalPayload } | null;
  createIdempotencyKey?: () => string;
};

type ConfirmDependencies = {
  verifyProposal: (token: string, expectedUserId: string) => SupplierOrderPhotoCreateTokenVerification;
  loadCatalog: () => Promise<SupplierOrderPhotoCatalogTarget[]>;
  findExistingOrder: (negotiationNumber: string) => Promise<SupplierOrderPhotoCreateExistingOrder | null>;
  createOrder: (input: {
    negotiation_number: string;
    order_date: string;
    notes: null;
    lines: SupplierOrderLineInput[];
    idempotency_key: string;
  }) => Promise<SupplierOrderActionResult>;
};

export type SupplierOrderPhotoCreatePrepareResult =
  | { ok: true; preparation: SupplierOrderPhotoCreatePreparation }
  | { ok: false; code: "DUPLICATE"; block: AssistantSupplierOrderPhotoCreateResultBlock }
  | { ok: false; code: "TOO_MANY_LINES" | "CATALOG_NOT_FOUND" | "CATALOG_AMBIGUOUS" | "CONFIGURATION"; error: string };

export type SupplierOrderPhotoCreateConfirmResult =
  | { ok: true; block: AssistantSupplierOrderPhotoCreateResultBlock }
  | { ok: false; code: "EXPIRED" | "INVALID_TOKEN" | "USER_MISMATCH" | "CATALOG_CHANGED" | "TRANSPORT_UNCERTAIN"; error: string };

function orderHref(order: SupplierOrderPhotoCreateExistingOrder) {
  return `/pedidos?view=${order.isInHistory ? "history" : "active"}&order=${encodeURIComponent(order.id)}`;
}

function duplicateBlock(
  order: SupplierOrderPhotoCreateExistingOrder,
): AssistantSupplierOrderPhotoCreateResultBlock {
  return {
    kind: "supplier_order_photo_create_result",
    outcome: "duplicate",
    title: "Este Pedido já existe",
    message: `A negociação ${order.negotiationNumber} já está cadastrada.`,
    order: {
      negotiationNumber: order.negotiationNumber,
      status: order.status,
      href: orderHref(order),
    },
    lineCount: 0,
    totalQuantity: 0,
    fallbackText: `O Pedido ${order.negotiationNumber} já existe. Nenhum Pedido duplicado foi criado.`,
  };
}

function canonicalIdentity(line: SupplierOrderPhotoCreateCanonicalLine) {
  return `${line.kind}:${line.targetId}:${line.commercialConfigurationCodeId ?? "NONE"}`;
}

function canonicalLine(target: SupplierOrderPhotoCatalogTarget, quantity: number) {
  return {
    kind: target.kind,
    targetId: target.targetId.toLowerCase(),
    commercialConfigurationCodeId: target.commercialConfigurationCodeId?.toLowerCase() ?? null,
    code: target.code,
    description: target.description,
    quantity,
  } satisfies SupplierOrderPhotoCreateCanonicalLine;
}

function resolveCanonicalLines(
  catalog: SupplierOrderPhotoCatalogTarget[],
  inputLines: SupplierOrderPhotoCreatePrepareInput["lines"],
) {
  const consolidated = new Map<string, SupplierOrderPhotoCreateCanonicalLine>();
  for (const line of inputLines) {
    const resolution = resolveSupplierOrderPhotoCatalogCode(catalog, line.code);
    if (resolution.kind !== "FOUND") return resolution.kind;
    const resolved = canonicalLine(resolution.target, line.quantity);
    const identity = canonicalIdentity(resolved);
    const previous = consolidated.get(identity);
    const quantity = (previous?.quantity ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > 2_147_483_647) return "INVALID_QUANTITY" as const;
    consolidated.set(identity, { ...resolved, quantity });
  }
  return [...consolidated.values()].sort((left, right) =>
    canonicalIdentity(left).localeCompare(canonicalIdentity(right), "en"));
}

export async function prepareSupplierOrderPhotoCreate(
  input: SupplierOrderPhotoCreatePrepareInput,
  userId: string,
  dependencies: PrepareDependencies,
): Promise<SupplierOrderPhotoCreatePrepareResult> {
  if (input.lines.length > supplierOrderPhotoCreateMaxLines) {
    return { ok: false, code: "TOO_MANY_LINES", error: `A criação por foto aceita até ${supplierOrderPhotoCreateMaxLines} linhas. Use a tela tradicional para Pedidos maiores.` };
  }
  const [existingOrder, catalog] = await Promise.all([
    dependencies.findExistingOrder(input.negotiationNumber),
    dependencies.loadCatalog(),
  ]);
  if (existingOrder) return { ok: false, code: "DUPLICATE", block: duplicateBlock(existingOrder) };
  const lines = resolveCanonicalLines(catalog, input.lines);
  if (lines === "NOT_FOUND") {
    return { ok: false, code: "CATALOG_NOT_FOUND", error: "Um dos códigos não está mais disponível no catálogo. Revise a prévia." };
  }
  if (lines === "AMBIGUOUS") {
    return { ok: false, code: "CATALOG_AMBIGUOUS", error: "Um dos códigos possui mais de uma correspondência. Revise a prévia." };
  }
  if (lines === "INVALID_QUANTITY") {
    return { ok: false, code: "CATALOG_NOT_FOUND", error: "A soma das quantidades excede o limite seguro." };
  }
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (!Number.isSafeInteger(totalQuantity)) {
    return { ok: false, code: "CATALOG_NOT_FOUND", error: "O total do Pedido excede o limite seguro." };
  }
  const signed = dependencies.createProposal({
    userId, negotiationNumber: input.negotiationNumber, orderDate: input.orderDate,
    lines: lines.map((line) => ({
      kind: line.kind,
      targetId: line.targetId,
      commercialConfigurationCodeId: line.commercialConfigurationCodeId,
      code: line.code,
      quantity: line.quantity,
    })),
    idempotencyKey: (dependencies.createIdempotencyKey ?? randomUUID)(),
  });
  if (!signed) {
    return { ok: false, code: "CONFIGURATION", error: "Não foi possível preparar a confirmação segura agora." };
  }
  return {
    ok: true,
    preparation: {
      negotiationNumber: input.negotiationNumber, orderDate: input.orderDate, lines,
      lineCount: lines.length, totalQuantity, proposalToken: signed.token,
      expiresAt: new Date(signed.payload.expiresAt * 1_000).toISOString(),
    },
  };
}

function signedLineMatchesTarget(
  line: SupplierOrderPhotoCreateProposalPayload["lines"][number],
  target: SupplierOrderPhotoCatalogTarget,
) {
  return line.kind === target.kind && line.targetId === target.targetId.toLowerCase() &&
    line.commercialConfigurationCodeId ===
      (target.commercialConfigurationCodeId?.toLowerCase() ?? null);
}

function toOrderLine(
  line: SupplierOrderPhotoCreateProposalPayload["lines"][number],
): SupplierOrderLineInput {
  return line.kind === "ITEM"
    ? { kind: "ITEM", item_id: line.targetId, quantity: line.quantity, notes: null }
    : {
        kind: "COMMERCIAL_CONFIGURATION",
        commercial_configuration_id: line.targetId,
        commercial_configuration_code_id: line.commercialConfigurationCodeId,
        quantity: line.quantity,
        notes: null,
      };
}

export async function confirmSupplierOrderPhotoCreate(
  proposalToken: string,
  userId: string,
  dependencies: ConfirmDependencies,
): Promise<SupplierOrderPhotoCreateConfirmResult> {
  const verified = dependencies.verifyProposal(proposalToken, userId);
  if (!verified.ok) {
    if (verified.reason === "expired") {
      return { ok: false, code: "EXPIRED", error: "Esta confirmação expirou. Gere uma nova prévia." };
    }
    return {
      ok: false,
      code: verified.reason === "user_mismatch" ? "USER_MISMATCH" : "INVALID_TOKEN",
      error: verified.reason === "user_mismatch"
        ? "Esta confirmação pertence a outra sessão." : "A confirmação é inválida.",
    };
  }
  const catalog = await dependencies.loadCatalog();
  const orderLines: SupplierOrderLineInput[] = [];
  for (const line of verified.payload.lines) {
    const resolution = resolveSupplierOrderPhotoCatalogCode(catalog, line.code);
    if (resolution.kind !== "FOUND" || !signedLineMatchesTarget(line, resolution.target)) {
      return { ok: false, code: "CATALOG_CHANGED", error: "Os dados do catálogo mudaram. Revise a prévia novamente." };
    }
    orderLines.push(toOrderLine(line));
  }
  const creation = await dependencies.createOrder({
    negotiation_number: verified.payload.negotiationNumber,
    order_date: verified.payload.orderDate,
    notes: null,
    lines: orderLines,
    idempotency_key: verified.payload.idempotencyKey,
  });
  if (creation.ok) {
    return {
      ok: true,
      block: {
        kind: "supplier_order_photo_create_result", outcome: "success",
        title: "Pedido criado",
        message: `Pedido ${creation.receipt.negotiationNumber} criado com segurança.`,
        order: {
          negotiationNumber: creation.receipt.negotiationNumber,
          status: creation.receipt.status,
          href: `/pedidos?view=active&order=${encodeURIComponent(creation.receipt.supplierOrderId)}`,
        },
        lineCount: creation.receipt.lineCount,
        totalQuantity: creation.receipt.orderedQuantity,
        fallbackText: `Pedido ${creation.receipt.negotiationNumber} criado com ${creation.receipt.lineCount} linhas e ${creation.receipt.orderedQuantity} unidades.`,
      },
    };
  }
  const existingOrder = await dependencies.findExistingOrder(verified.payload.negotiationNumber);
  if (existingOrder) return { ok: true, block: duplicateBlock(existingOrder) };
  return {
    ok: false, code: "TRANSPORT_UNCERTAIN",
    error: "Não foi possível confirmar o resultado. Verifique se o Pedido foi criado antes de iniciar uma nova tentativa.",
  };
}
