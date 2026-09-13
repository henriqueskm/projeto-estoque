export type CatalogCodeTarget = {
  code: string;
};

export type CatalogCodeWriteIdentity =
  | {
      kind: "VALID";
      canonicalCode: string;
      lockIdentity: string;
      modifierFamily: string | null;
      isModifierBase: boolean;
    }
  | {
      kind: "UNSUPPORTED";
    };

const supportedCodePattern = /^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*$/;
const supportedModifierPattern = /^(\d+)-?(INV|DESL)(\d*)$/i;
const modifierLikePattern = /^\d+.*(?:INV|DESL)/i;

export function getCatalogCodeWriteIdentity(
  value: string,
): CatalogCodeWriteIdentity {
  const trimmed = value.trim();

  if (!supportedCodePattern.test(trimmed)) {
    return { kind: "UNSUPPORTED" };
  }

  const modifierMatch = trimmed.match(supportedModifierPattern);

  if (!modifierMatch) {
    return modifierLikePattern.test(trimmed)
      ? { kind: "UNSUPPORTED" }
      : {
          kind: "VALID",
          canonicalCode: trimmed.toLocaleUpperCase("pt-BR"),
          lockIdentity: trimmed.toLocaleUpperCase("pt-BR"),
          modifierFamily: null,
          isModifierBase: false,
        };
  }

  const modifierFamily = `${modifierMatch[1]}${modifierMatch[2].toLocaleUpperCase("pt-BR")}`;
  const suffix = modifierMatch[3];

  return {
    kind: "VALID",
    canonicalCode: `${modifierFamily}${suffix}`,
    lockIdentity: modifierFamily,
    modifierFamily,
    isModifierBase: suffix.length === 0,
  };
}

export function normalizeCatalogCodeForLookup(value: string) {
  const identity = getCatalogCodeWriteIdentity(value);
  return identity.kind === "VALID"
    ? identity.canonicalCode
    : value.trim().toLocaleUpperCase("pt-BR");
}

export function catalogCodesConflict(left: string, right: string) {
  const leftIdentity = getCatalogCodeWriteIdentity(left);
  const rightIdentity = getCatalogCodeWriteIdentity(right);

  if (
    leftIdentity.kind === "UNSUPPORTED" ||
    rightIdentity.kind === "UNSUPPORTED"
  ) {
    return false;
  }

  return (
    leftIdentity.canonicalCode === rightIdentity.canonicalCode ||
    (leftIdentity.modifierFamily !== null &&
      leftIdentity.modifierFamily === rightIdentity.modifierFamily &&
      (leftIdentity.isModifierBase || rightIdentity.isModifierBase))
  );
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
  const writeIdentity = getCatalogCodeWriteIdentity(code);

  if (writeIdentity.kind === "UNSUPPORTED") {
    return {
      allowed: false as const,
      resolution: { kind: "UNSUPPORTED" as const },
    };
  }

  const resolution = resolveCatalogCode(catalog, code);

  if (resolution.kind !== "NOT_FOUND") {
    return { allowed: false as const, resolution };
  }

  const conflicts = catalog.filter((target) =>
    catalogCodesConflict(target.code, code),
  );

  return conflicts.length === 0
    ? { allowed: true as const }
    : {
        allowed: false as const,
        resolution: {
          kind: "AMBIGUOUS" as const,
          reason: "KNOWN_FAMILY" as const,
          candidates: conflicts,
        },
      };
}
