const safeModelSeparators = /[\s._/\\-]+/g;

export function normalizeServoModel(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR")
    .replace(safeModelSeparators, "");

  return /^[A-Z0-9]+$/.test(normalized) &&
    /[A-Z]/.test(normalized) &&
    /\d/.test(normalized)
    ? normalized
    : "";
}

export function normalizeCatalogSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractServoModelCandidate(value: string) {
  const searchableValue = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const matches = Array.from(
    searchableValue.matchAll(
      /\b([\p{L}]{2,}[\p{L}\d]*(?:[\s._/\\-]*\d+)+)\b/gu,
    ),
  )
    .filter((match) => {
      const prefix = searchableValue
        .slice(Math.max(0, (match.index ?? 0) - 32), match.index)
        .toLocaleLowerCase("pt-BR");
      const normalizedMatch = normalizeCatalogSearchText(match[1]);

      return (
        !/^(?:pedido|negociacao)\b/.test(normalizedMatch) &&
        !/\b(?:pedido|negociacao)\s*(?:n(?:umero)?\s*)?[#:]?\s*$/.test(
          prefix,
        ) &&
        !/^(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+\d{2,4}$/.test(
          normalizedMatch,
        )
      );
    })
    .map((match) => match[1].trim());
  const uniqueMatches = Array.from(
    new Map(
      matches
        .map((match) => [normalizeServoModel(match), match] as const)
        .filter(([normalized]) => Boolean(normalized)),
    ).values(),
  );

  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
}

export function matchesServoModel(
  query: string,
  officialModel: string | null | undefined,
) {
  if (!officialModel) {
    return false;
  }

  const normalizedQuery = normalizeServoModel(query);
  const normalizedOfficialModel = normalizeServoModel(officialModel);

  if (!normalizedQuery || !normalizedOfficialModel) {
    return false;
  }

  return normalizedOfficialModel === normalizedQuery;
}

export function matchesCatalogDescription(
  query: string,
  description: string | null | undefined,
) {
  if (!description) {
    return false;
  }

  const normalizedQuery = normalizeCatalogSearchText(query);
  const normalizedDescription = normalizeCatalogSearchText(description);
  const compactQuery = normalizeServoModel(query);
  const compactDescription = normalizeServoModel(description);

  return (
    normalizedQuery.length >= 4 &&
    (normalizedDescription === normalizedQuery ||
      normalizedDescription.includes(normalizedQuery) ||
      (Boolean(compactQuery) &&
        compactDescription.includes(compactQuery)))
  );
}
