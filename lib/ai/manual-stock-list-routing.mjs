export const manualStockListMaximumLines = 12;

const quantityWordPattern =
  "(?:\\+?\\d{1,10}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)";
const quantityTargetSeparatorPattern =
  "(?:(?:\\s+unidades?)?\\s+(?:do|da|de|no|na)\\b|(?:\\s+unidades?)?\\s*-\\s+(?=\\S))";
const lineStartPattern = new RegExp(
  `^${quantityWordPattern}${quantityTargetSeparatorPattern}`,
  "iu",
);
const listIntroductionPattern = new RegExp(
  "^(?:(?:nessa|nesta)\\s+lista|na\\s+lista(?:\\s+abaixo)?|(?:os|dos)\\s+seguintes\\s+itens|destes\\s+itens)\\s*:?\\s*",
  "iu",
);

function removeLeadingListPunctuation(value) {
  return value.replace(/^\s*:\s*/u, "");
}

function normalizeManualStockListLine(value) {
  return value.replace(
    new RegExp(`^(${quantityWordPattern})((?:\\s+unidades?)?)\\s*-\\s+(?=\\S)`, "iu"),
    "$1$2 do ",
  );
}

export function hasManualStockListIntroduction(value) {
  return listIntroductionPattern.test(removeLeadingListPunctuation(value));
}

function normalizeIntentText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function splitManualStockList(value) {
  let normalized = removeLeadingListPunctuation(value)
    .replace(new RegExp(`^\\s*(?:de|em)\\s+(?=${quantityWordPattern}\\b)`, "iu"), "")
    .trim();
  if (!normalized) return null;

  const introductionMatch = listIntroductionPattern.exec(normalized);
  if (introductionMatch) {
    const candidateList = normalized.slice(introductionMatch[0].length).trim();
    if (!lineStartPattern.test(candidateList)) return null;
    normalized = candidateList;
  }

  const coarseParts = normalized.split(/\r?\n+|;+/u);
  const parts = [];

  for (const coarsePart of coarseParts) {
    const commaParts = coarsePart.split(new RegExp(`,\\s*(?=${quantityWordPattern}${quantityTargetSeparatorPattern})`, "iu"));
    for (const commaPart of commaParts) {
      const conjunctionParts = commaPart.split(new RegExp(`\\s+e\\s+(?=${quantityWordPattern}${quantityTargetSeparatorPattern})`, "iu"));
      parts.push(...conjunctionParts
        .map((part) => normalizeManualStockListLine(part.trim()))
        .filter(Boolean));
    }
  }

  if (parts.length < 2 || parts.some((part) => !lineStartPattern.test(part))) {
    return null;
  }
  return parts.length <= manualStockListMaximumLines ? parts : [];
}

export function hasInvalidManualStockListQuantity(value) {
  const negativeCandidates = value.matchAll(/(^|\s)(-\s*\d+)/gu);
  const validSeparatorPrefix = new RegExp(`^${quantityWordPattern}(?:\\s+unidades?)?$`, "iu");
  for (const match of negativeCandidates) {
    const signIndex = (match.index ?? 0) + match[1].length;
    const currentPartPrefix = value
      .slice(0, signIndex)
      .split(/\r?\n|[,;:]|\s+e\s+/iu)
      .at(-1)
      ?.trim() ?? "";
    const isSpacedListSeparator = /^-\s+\d/u.test(match[2]) && validSeparatorPrefix.test(currentPartPrefix);
    if (!isSpacedListSeparator) return true;
  }
  return /\b\d+[,.]\d+\b/u.test(value) || /\b\d{11,}\b/u.test(value);
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
