export type CatalogCodeTarget = {
  code: string;
};

export function normalizeCatalogCodeForLookup(value: string) {
  return value
    .trim()
    .toLocaleUpperCase("pt-BR")
    .replace(/[\s-]+(?=INV(?:\d|$))/g, "");
}

export function resolveCatalogCode<T extends CatalogCodeTarget>(
  catalog: readonly T[],
  code: string,
) {
  const normalized = normalizeCatalogCodeForLookup(code);
  const matches = catalog.filter(
    (target) => normalizeCatalogCodeForLookup(target.code) === normalized,
  );

  if (matches.length === 1) {
    return { kind: "FOUND" as const, target: matches[0] };
  }

  if (matches.length > 1) {
    return {
      kind: "AMBIGUOUS" as const,
      reason: "EXACT_DUPLICATE" as const,
      candidates: matches,
    };
  }

  if (!/INV$/.test(normalized)) {
    return { kind: "NOT_FOUND" as const };
  }

  const familyMatches = catalog.filter((target) => {
    const officialCode = normalizeCatalogCodeForLookup(target.code);
    return (
      officialCode.startsWith(normalized) &&
      /^\d+$/.test(officialCode.slice(normalized.length))
    );
  });

  if (familyMatches.length === 1) {
    return { kind: "FOUND" as const, target: familyMatches[0] };
  }

  return familyMatches.length > 1
    ? {
        kind: "AMBIGUOUS" as const,
        reason: "KNOWN_FAMILY" as const,
        candidates: familyMatches,
      }
    : { kind: "NOT_FOUND" as const };
}

export function assessNewLoosePartCode<T extends CatalogCodeTarget>(
  catalog: readonly T[],
  code: string,
) {
  const resolution = resolveCatalogCode(catalog, code);
  return resolution.kind === "NOT_FOUND"
    ? { allowed: true as const }
    : { allowed: false as const, resolution };
}
