export const manualStockListMaximumLines = 12;

const quantityWordPattern =
  "(?:\\+?\\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)";
const lineStartPattern = new RegExp(
  `^${quantityWordPattern}(?:\\s+unidades?)?\\s+(?:do|da|de|no|na)\\b`,
  "iu",
);

function normalizeIntentText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function splitManualStockList(value) {
  const normalized = value
    .replace(/^\s*:\s*/u, "")
    .replace(new RegExp(`^\\s*(?:de|em)\\s+(?=${quantityWordPattern}\\b)`, "iu"), "")
    .trim();
  if (!normalized) return null;

  const coarseParts = normalized.split(/\r?\n+|;+/u);
  const parts = [];

  for (const coarsePart of coarseParts) {
    const commaParts = coarsePart.split(/,\s*(?=(?:\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)(?:\s+unidades?)?\s+(?:do|da|de|no|na)\b)/iu);
    for (const commaPart of commaParts) {
      const conjunctionParts = commaPart.split(/\s+e\s+(?=(?:\+?\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)(?:\s+unidades?)?\s+(?:do|da|de|no|na)\b)/iu);
      parts.push(...conjunctionParts.map((part) => part.trim()).filter(Boolean));
    }
  }

  if (parts.length < 2 || parts.some((part) => !lineStartPattern.test(part))) {
    return null;
  }
  return parts.length <= manualStockListMaximumLines ? parts : [];
}

export function hasInvalidManualStockListQuantity(value) {
  return /(?:^|\s)-\s*\d+/u.test(value) || /\b\d+[,.]\d+\b/u.test(value) || /\b\d{11,}\b/u.test(value);
}

export function hasMixedManualStockIntent(value) {
  const normalized = normalizeIntentText(value);
  const hasEntry = /\bentrada\b|\b(?:adicionar|adicione|colocar|coloque|lancar|lance)\b[^.!?\n]{0,50}\bestoque\b/u.test(normalized);
  const hasOutput = /\bsaida\b|\b(?:baixa|baixar|baixe|retirar|retire|tirar|tire|remover|remova)\b/u.test(normalized);
  return hasEntry && hasOutput;
}

export function requiresManualStockIdentityChoice(value, requestedIdentity) {
  return requestedIdentity === null && /\bmbf\s*-?\s*\d+/i.test(value);
}

/**
 * @template T
 * @param {Array<{ identityKey: string; target: T; quantity: number }>} lines
 * @returns {Array<{ target: T; quantity: number }>}
 */
export function consolidateResolvedManualStockLines(lines) {
  const consolidated = new Map();
  for (const line of lines) {
    const current = consolidated.get(line.identityKey);
    const quantity = (current?.quantity ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2_147_483_647) {
      return [];
    }
    consolidated.set(line.identityKey, {
      target: current?.target ?? line.target,
      quantity,
    });
  }
  return Array.from(consolidated.values());
}
