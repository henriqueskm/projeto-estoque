export type SupplierOrderPickupMode =
  | "increment"
  | "set_total"
  | "mark_all";

export type SupplierOrderPickupActionRequest = {
  mode: SupplierOrderPickupMode;
  catalogCode: string | null;
  requestedQuantity: number | null;
  negotiationNumber: string | null;
};

export type SupplierOrderPickupRoutingResult =
  | { kind: "NOT_PICKUP_ACTION" }
  | { kind: "BUTTON_CONFIRMATION_TEXT" }
  | { kind: "CANCEL_PICKUP_ACTION" }
  | {
      kind: "INVALID_PICKUP_ACTION";
      message: string;
    }
  | {
      kind: "AMBIGUOUS_PICKUP_MODE";
      catalogCode: string;
      requestedQuantity: number;
      negotiationNumber: string | null;
    }
  | {
      kind: "PICKUP_ACTION";
      request: SupplierOrderPickupActionRequest;
    };

const maximumInteger = 2_147_483_647;
const catalogCodePattern =
  /^(?=.*\d)[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/;
const catalogCodeCapture =
  "((?=[a-z0-9-]*\\d)[a-z0-9]+(?:-[a-z0-9]+)*)";
const quantityCapture = "(\\d{1,10}|uma?|um)";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogCode(value: string) {
  const code = value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR");

  return catalogCodePattern.test(code) ? code : null;
}

function parseQuantity(value: string) {
  const quantity = /^(?:uma?|um)$/.test(value) ? 1 : Number(value);

  return Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    quantity <= maximumInteger
    ? quantity
    : null;
}

function normalizeNegotiationNumber(value: string) {
  const negotiationNumber = value
    .trim()
    .replace(/\s+/g, " ");

  if (
    !negotiationNumber ||
    negotiationNumber.length > 120 ||
    !/^[\p{L}\p{N} /-]+$/u.test(negotiationNumber)
  ) {
    return null;
  }

  return negotiationNumber;
}

function extractNegotiationNumber(rawMessage: string) {
  const match = rawMessage.match(
    /\bpedido\b(?:\s+(?:n|número|numero)\b)?\s*[º°#:]?\s*(.+?)(?=\s+como\s+retirad[oa]s?\b|[?!.;]*$)/iu,
  );
  const candidate = match?.[1]
    ?.replace(/^(?:no|na|do|da|de)\s+/iu, "")
    .trim();

  if (!candidate) {
    return null;
  }

  const normalized = normalizeNegotiationNumber(candidate);

  if (
    !normalized ||
    /^(?:esse|este|desse|deste|todo|todos|tudo)$/i.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function parseLineMatch(
  match: RegExpMatchArray | null,
): {
  requestedQuantity: number;
  catalogCode: string;
} | null {
  if (!match) {
    return null;
  }

  const requestedQuantity = parseQuantity(match[1]);
  const catalogCode = normalizeCatalogCode(match[2]);

  return requestedQuantity && catalogCode
    ? { requestedQuantity, catalogCode }
    : null;
}

function canonicalLinePrompt(
  mode: "increment" | "set_total",
  quantity: number,
  code: string,
  negotiationNumber: string | null,
) {
  const operation =
    mode === "increment"
      ? `Retire mais ${quantity} unidade${quantity === 1 ? "" : "s"} do Cód. ${code}`
      : `Defina o total retirado do Cód. ${code} como ${quantity}`;

  return `${operation}${negotiationNumber ? ` no Pedido ${negotiationNumber}` : " deste Pedido"}.`;
}

export function createSupplierOrderPickupPrompt(
  request: SupplierOrderPickupActionRequest,
) {
  if (request.mode === "mark_all") {
    return `Marque tudo${request.negotiationNumber ? ` do Pedido ${request.negotiationNumber}` : " deste Pedido"} como retirado.`;
  }

  return canonicalLinePrompt(
    request.mode,
    request.requestedQuantity ?? 0,
    request.catalogCode ?? "",
    request.negotiationNumber,
  );
}

export function routeSupplierOrderPickupAction(
  rawMessage: string,
): SupplierOrderPickupRoutingResult {
  const message = normalizeText(rawMessage);

  if (!message) {
    return { kind: "NOT_PICKUP_ACTION" };
  }

  if (
    /^(?:sim|confirme|confirmar|pode fazer|pode executar|ok|execute|executar|manda)[?!.]*$/.test(
      message,
    )
  ) {
    return { kind: "BUTTON_CONFIRMATION_TEXT" };
  }

  if (
    /^(?:cancelar|cancele)\s+(?:esta|essa)\s+retirada[?!.]*$/.test(
      message,
    )
  ) {
    return { kind: "CANCEL_PICKUP_ACTION" };
  }

  if (
    /^(?:quanto|quantos|quantas|qual|quais|mostre|mostrar|consulte|consultar)\b/.test(
      message,
    )
  ) {
    return { kind: "NOT_PICKUP_ACTION" };
  }

  const negotiationNumber = extractNegotiationNumber(rawMessage);
  const markAll =
    /\b(?:marque|marcar|retire|retirar)\s+(?:tudo|todos\s+os\s+itens|todo\s+o\s+saldo\s+restante)\b/.test(
      message,
    ) ||
    /\bretire\s+todo\s+o?\s*saldo\s+restante\s+(?:desse|deste|do)\s+pedido\b/.test(
      message,
    );

  if (markAll) {
    return {
      kind: "PICKUP_ACTION",
      request: {
        mode: "mark_all",
        catalogCode: null,
        requestedQuantity: null,
        negotiationNumber,
      },
    };
  }

  const incrementPatterns = [
    new RegExp(
      `\\b(?:retire|retirar|marque|marcar)\\s+mais\\s+${quantityCapture}(?:\\s+unidades?)?\\s+(?:do|da|de)\\s+(?:codigo\\s+)?${catalogCodeCapture}\\b`,
    ),
    new RegExp(
      `\\bacrescente\\s+${quantityCapture}(?:\\s+unidades?)?\\s+(?:retirad[oa]s?\\s+)?(?:do|da|de)\\s+(?:codigo\\s+)?${catalogCodeCapture}\\b`,
    ),
  ];

  for (const pattern of incrementPatterns) {
    const line = parseLineMatch(message.match(pattern));

    if (line) {
      return {
        kind: "PICKUP_ACTION",
        request: {
          mode: "increment",
          catalogCode: line.catalogCode,
          requestedQuantity: line.requestedQuantity,
          negotiationNumber,
        },
      };
    }
  }

  const setTotalPatterns = [
    new RegExp(
      `\\b(?:defina|definir|deixe|deixar)\\s+(?:o\\s+)?total\\s+retirado\\s+(?:do|da|de)\\s+(?:codigo\\s+)?${catalogCodeCapture}\\s+(?:como|em)\\s+${quantityCapture}\\b`,
    ),
    new RegExp(
      `\\b(?:marque|marcar)\\s+${quantityCapture}(?:\\s+unidades?)?\\s+(?:do|da|de)\\s+(?:codigo\\s+)?${catalogCodeCapture}\\s+como\\s+retirad[oa]s?\\b`,
    ),
  ];

  for (const [index, pattern] of setTotalPatterns.entries()) {
    const match = message.match(pattern);
    const reorderedMatch =
      index === 0 && match
        ? ([match[0], match[2], match[1]] as RegExpMatchArray)
        : match;
    const line = parseLineMatch(reorderedMatch);

    if (line) {
      return {
        kind: "PICKUP_ACTION",
        request: {
          mode: "set_total",
          catalogCode: line.catalogCode,
          requestedQuantity: line.requestedQuantity,
          negotiationNumber,
        },
      };
    }
  }

  const ambiguous = parseLineMatch(
    message.match(
      new RegExp(
        `\\b(?:retire|retirar|marque|marcar)\\s+${quantityCapture}(?:\\s+unidades?)?\\s+(?:do|da|de)\\s+(?:codigo\\s+)?${catalogCodeCapture}\\b`,
      ),
    ),
  );

  if (ambiguous) {
    return {
      kind: "AMBIGUOUS_PICKUP_MODE",
      catalogCode: ambiguous.catalogCode,
      requestedQuantity: ambiguous.requestedQuantity,
      negotiationNumber,
    };
  }

  if (
    /\b(?:retire|retirar|marque|marcar|acrescente|defina|definir|deixe|deixar)\b/.test(
      message,
    )
  ) {
    return {
      kind: "INVALID_PICKUP_ACTION",
      message:
        "Informe uma quantidade inteira positiva e o código exato da linha do Pedido.",
    };
  }

  return { kind: "NOT_PICKUP_ACTION" };
}

export function calculateSupplierOrderPickupTarget(
  mode: "increment" | "set_total",
  currentPickedQuantity: number,
  requestedQuantity: number,
) {
  if (
    !Number.isSafeInteger(currentPickedQuantity) ||
    currentPickedQuantity < 0 ||
    !Number.isSafeInteger(requestedQuantity) ||
    requestedQuantity <= 0
  ) {
    return null;
  }

  const targetPickedQuantity =
    mode === "increment"
      ? currentPickedQuantity + requestedQuantity
      : requestedQuantity;

  if (
    !Number.isSafeInteger(targetPickedQuantity) ||
    targetPickedQuantity > maximumInteger
  ) {
    return null;
  }

  return {
    targetPickedQuantity,
    addedQuantity: targetPickedQuantity - currentPickedQuantity,
  };
}

export type SupplierOrderPickupLineState = {
  orderedQuantity: number;
  cancelledQuantity: number;
  stockedQuantity: number;
  pickedQuantity: number;
};

export type SupplierOrderPickupLineValidation =
  | {
      kind: "valid";
      targetPickedQuantity: number;
      addedQuantity: number;
      remainingAfter: number;
    }
  | {
      kind:
        | "invalid"
        | "no_change"
        | "reduction"
        | "above_limit"
        | "below_stocked";
      pickupLimit: number;
    };

export function validateSupplierOrderPickupLine(
  mode: "increment" | "set_total",
  requestedQuantity: number,
  item: SupplierOrderPickupLineState,
): SupplierOrderPickupLineValidation {
  const values = [
    item.orderedQuantity,
    item.cancelledQuantity,
    item.stockedQuantity,
    item.pickedQuantity,
  ];
  const pickupLimit =
    item.orderedQuantity - item.cancelledQuantity;
  const target = calculateSupplierOrderPickupTarget(
    mode,
    item.pickedQuantity,
    requestedQuantity,
  );

  if (
    values.some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    item.cancelledQuantity > item.orderedQuantity ||
    item.pickedQuantity > pickupLimit ||
    item.stockedQuantity > item.pickedQuantity ||
    !target
  ) {
    return { kind: "invalid", pickupLimit };
  }

  if (target.targetPickedQuantity < item.pickedQuantity) {
    return { kind: "reduction", pickupLimit };
  }

  if (target.targetPickedQuantity === item.pickedQuantity) {
    return { kind: "no_change", pickupLimit };
  }

  if (target.targetPickedQuantity > pickupLimit) {
    return { kind: "above_limit", pickupLimit };
  }

  if (target.targetPickedQuantity < item.stockedQuantity) {
    return { kind: "below_stocked", pickupLimit };
  }

  return {
    kind: "valid",
    targetPickedQuantity: target.targetPickedQuantity,
    addedQuantity: target.addedQuantity,
    remainingAfter: pickupLimit - target.targetPickedQuantity,
  };
}

export function summarizeSupplierOrderMarkAll(
  items: SupplierOrderPickupLineState[],
) {
  return items.reduce(
    (summary, item) => {
      const addedQuantity = Math.max(
        item.orderedQuantity -
          item.cancelledQuantity -
          item.pickedQuantity,
        0,
      );

      return {
        changedLines:
          summary.changedLines + (addedQuantity > 0 ? 1 : 0),
        addedPickedQuantity:
          summary.addedPickedQuantity + addedQuantity,
      };
    },
    { changedLines: 0, addedPickedQuantity: 0 },
  );
}
