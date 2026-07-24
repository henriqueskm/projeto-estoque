const knownVariantSuffix =
  /\s+(DESLOCADO|REBAIXADO|INVERTIDO(?:\s+\d{3}(?:\/[A-Z]+)?)?)$/i;

function normalizeModelLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function getServoModelLabel(
  model: string | null,
  description: string,
) {
  const normalizedModel = model ? normalizeModelLabel(model) : "";

  if (normalizedModel) {
    return normalizedModel;
  }

  return normalizeModelLabel(description).replace(/^SERVO\s+/i, "");
}

/**
 * Families are presentation-only. The catalog currently uses the explicit
 * suffixes Deslocado, Rebaixado and Invertido (optionally followed by a
 * three-digit variant such as 028 or 015/VF). Unknown formats remain intact
 * so an ambiguous model is never grouped by inference.
 */
export function getServoFamilyLabel(
  model: string | null,
  description: string,
) {
  const modelLabel = getServoModelLabel(model, description);
  const familyLabel = modelLabel.replace(knownVariantSuffix, "").trim();

  return familyLabel || modelLabel;
}

export function getServoVariantLabel(
  model: string | null,
  description: string,
) {
  const modelLabel = getServoModelLabel(model, description);
  const match = modelLabel.match(knownVariantSuffix);

  if (!match) {
    return "Normal";
  }

  const [variant, detail] = match[1].split(/\s+/, 2);
  const normalizedVariant =
    variant.charAt(0).toLocaleUpperCase("pt-BR") +
    variant.slice(1).toLocaleLowerCase("pt-BR");

  return detail
    ? `${normalizedVariant} ${detail.toLocaleUpperCase("pt-BR")}`
    : normalizedVariant;
}
