import "server-only";

import { assessNewLoosePartCode } from "@/lib/catalog-code-policy";
import type { InboundRequestLine } from "@/lib/inbound-types";
import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type CatalogOnlyLoosePartWrite = {
  kind: "CATALOG_ONLY_LOOSE_PART";
  code: string;
  description: string;
};

type StockInboundWrite = {
  kind: "STOCK_INBOUND";
  lines: InboundRequestLine[];
  idempotencyKey: string;
  description: string | null;
};

export type CatalogWrite = CatalogOnlyLoosePartWrite | StockInboundWrite;

export type CatalogWritePolicyErrorReason =
  | "CATALOG_READ_FAILED"
  | "KNOWN_CODE"
  | "AMBIGUOUS_CODE";

export class CatalogWritePolicyError extends Error {
  readonly reason: CatalogWritePolicyErrorReason;
  readonly requestedCode: string | null;
  readonly catalogCodes: string[];

  constructor(
    reason: CatalogWritePolicyErrorReason,
    options: {
      requestedCode?: string;
      catalogCodes?: string[];
    } = {},
  ) {
    super(reason);
    this.name = "CatalogWritePolicyError";
    this.reason = reason;
    this.requestedCode = options.requestedCode ?? null;
    this.catalogCodes = options.catalogCodes ?? [];
  }
}

function parseCatalogCodes(data: unknown) {
  if (!Array.isArray(data)) {
    throw new CatalogWritePolicyError("CATALOG_READ_FAILED");
  }

  return data.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      typeof (row as Record<string, unknown>).code !== "string" ||
      !(row as Record<string, string>).code.trim()
    ) {
      throw new CatalogWritePolicyError("CATALOG_READ_FAILED");
    }

    return { code: (row as Record<string, string>).code };
  });
}

async function loadCatalogCodes(supabase: SupabaseClient) {
  const [itemsResult, commercialCodesResult] = await Promise.all([
    supabase.from("items").select("code"),
    supabase.from("commercial_configuration_codes").select("code"),
  ]);

  if (itemsResult.error || commercialCodesResult.error) {
    throw new CatalogWritePolicyError("CATALOG_READ_FAILED");
  }

  return [
    ...parseCatalogCodes(itemsResult.data),
    ...parseCatalogCodes(commercialCodesResult.data),
  ];
}

function loosePartsFromWrite(write: CatalogWrite) {
  return write.kind === "CATALOG_ONLY_LOOSE_PART"
    ? [{ code: write.code }]
    : write.lines.flatMap((line) =>
        line.kind === "NEW_LOOSE_PART" ? [{ code: line.code }] : [],
      );
}

async function enforceCatalogWritePolicy(
  supabase: SupabaseClient,
  write: CatalogWrite,
) {
  const looseParts = loosePartsFromWrite(write);

  if (looseParts.length === 0) {
    return;
  }

  let catalog: Awaited<ReturnType<typeof loadCatalogCodes>>;

  try {
    catalog = await loadCatalogCodes(supabase);
  } catch (error) {
    if (error instanceof CatalogWritePolicyError) {
      throw error;
    }

    throw new CatalogWritePolicyError("CATALOG_READ_FAILED");
  }

  const acceptedLooseParts: Array<{ code: string }> = [];

  for (const loosePart of looseParts) {
    const pendingAssessment = assessNewLoosePartCode(
      acceptedLooseParts,
      loosePart.code,
    );

    if (!pendingAssessment.allowed) {
      const catalogCodes = pendingAssessment.resolution.kind === "FOUND"
        ? [pendingAssessment.resolution.target.code]
        : pendingAssessment.resolution.candidates.map(
            (candidate) => candidate.code,
          );

      throw new CatalogWritePolicyError("AMBIGUOUS_CODE", {
        requestedCode: loosePart.code,
        catalogCodes,
      });
    }

    const assessment = assessNewLoosePartCode(catalog, loosePart.code);

    if (assessment.allowed) {
      acceptedLooseParts.push({ code: loosePart.code });
      continue;
    }

    const catalogCodes =
      assessment.resolution.kind === "FOUND"
        ? [assessment.resolution.target.code]
        : assessment.resolution.candidates.map((candidate) => candidate.code);

    throw new CatalogWritePolicyError(
      assessment.resolution.kind === "FOUND"
        ? "KNOWN_CODE"
        : "AMBIGUOUS_CODE",
      { requestedCode: loosePart.code, catalogCodes },
    );
  }
}

export async function executeCatalogWrite(
  supabase: SupabaseClient,
  write: CatalogWrite,
) {
  await enforceCatalogWritePolicy(supabase, write);

  if (write.kind === "CATALOG_ONLY_LOOSE_PART") {
    return supabase.rpc("create_loose_part", {
      p_code: write.code,
      p_description: write.description,
    });
  }

  return supabase.rpc("stock_inbound_lines", {
    p_lines: write.lines,
    p_idempotency_key: write.idempotencyKey,
    p_description: write.description,
  });
}
