import type { SupplierOrderPhotoCatalogTarget } from "./assistant-supplier-order-photo.ts";

export function normalizeSupplierOrderPhotoCode(value: string) {
  return value.trim().toLocaleUpperCase("pt-BR");
}

export function resolveSupplierOrderPhotoCatalogCode(
  catalog: SupplierOrderPhotoCatalogTarget[],
  code: string,
) {
  const normalized = normalizeSupplierOrderPhotoCode(code);
  const matches = catalog.filter(
    (target) => normalizeSupplierOrderPhotoCode(target.code) === normalized,
  );
  return matches.length === 1 ? { kind: "FOUND" as const, target: matches[0] }
    : matches.length === 0 ? { kind: "NOT_FOUND" as const }
      : { kind: "AMBIGUOUS" as const };
}
