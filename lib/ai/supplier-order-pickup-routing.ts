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

export function normalizeAssistantCommandText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\bcod(?:igo)?\b\.?/g, "codigo")
    .replace(/[º°]/g, " ")
    .replace(/[.,;:!?()[\]{}"'“”‘’`]+/g, " ")
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

function extractNegotiationNumber(message: string) {
  const match = message.match(
    /\bpedido\b(?:\s+(?:n|numero)\b)?\s+(.+)$/,
  );
  const remainder = match?.[1]?.trim();

  if (!remainder) {
    return null;
  }

  const commandBoundary = remainder.search(
    /\s+(?=(?:retire|retirar|marque|marcar|acrescente|registr(?:e|ar)|defina|definir|deixe|deixar)\b|mais\s+(?:\d{1,10}|uma?|um)\b)/,
  );
  const candidate = (
    commandBoundary >= 0
      ? remainder.slice(0, commandBoundary)
      : remainder
  ).trim();
  const normalized = normalizeNegotiationNumber(candidate);

  if (
    !normalized ||
    /^(?:esse|este|desse|deste|todo|todos|tudo)$/i.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function extractCatalogCode(message: string) {
  const explicitCode = message.match(
    new RegExp(`\\bcodigo\\s+${catalogCodeCapture}\\b`),
  )?.[1];

  if (explicitCode) {
    return normalizeCatalogCode(explicitCode);
  }

  const contextualCodes = Array.from(
    message.matchAll(
      new RegExp(
        `\\b(?:do|da|de)\\s+${catalogCodeCapture}\\b`,
        "g",
      ),
    ),
  );

  for (const match of contextualCodes) {
    const code = normalizeCatalogCode(match[1]);

    if (code) {
      return code;
    }
  }

  return null;
}

function extractQuantity(
  message: string,
  patterns: RegExp[],
) {
  for (const pattern of patterns) {
    const candidate = message.match(pattern)?.[1];
    const quantity = candidate ? parseQuantity(candidate) : null;

    if (quantity) {
      return quantity;
    }
  }

  return null;
}

function extractPickupMode(message: string):
  | {
      mode: "increment" | "set_total";
      requestedQuantity: number;
    }
  | null {
  const setTotalQuantity = extractQuantity(message, [
    new RegExp(
      `\\b(?:defina|definir)\\s+(?:o\\s+)?total\\s+retirado\\b.*?\\b(?:como|em)\\s+${quantityCapture}\\b`,
    ),
    new RegExp(
      `\\b(?:deixe|deixar)\\s+(?:o\\s+)?total(?:\\s+retirado)?\\b.*?\\bem\\s+${quantityCapture}\\b`,
    ),
    new RegExp(
      `\\b(?:marque|marcar)\\s+(?:o\\s+)?total(?:\\s+retirado)?\\s+como\\s+${quantityCapture}\\b`,
    ),
    new RegExp(
      `\\b(?:marque|marcar)\\s+${quantityCapture}(?:\\s+unidades?)?\\b.*?\\bcomo\\s+retirad[oa]s?\\b`,
    ),
    new RegExp(
      `\\b(?:registre|registrar)\\s+${quantityCapture}(?:\\s+unidades?)?\\s+no\\s+total\\s+retirado\\b`,
    ),
  ]);

  if (setTotalQuantity) {
    return {
      mode: "set_total",
      requestedQuantity: setTotalQuantity,
    };
  }

  const incrementQuantity = extractQuantity(message, [
    new RegExp(
      `\\b(?:retire|retirar|marque|marcar|registre|registrar)\\b.*?\\bmais\\s+${quantityCapture}\\b`,
    ),
    new RegExp(
      `\\b(?:retire|retirar)\\s+${quantityCapture}(?:\\s+unidades?)?\\b`,
    ),
    new RegExp(
      `\\bacrescente\\s+${quantityCapture}(?:\\s+unidades?)?(?:\\s+(?:como\\s+)?retirad[oa]s?)?\\b`,
    ),
  ]);

  return incrementQuantity
    ? {
        mode: "increment",
        requestedQuantity: incrementQuantity,
      }
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
  const message = normalizeAssistantCommandText(rawMessage);

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

  const negotiationNumber = extractNegotiationNumber(message);
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

  const catalogCode = extractCatalogCode(message);
  const pickupMode = extractPickupMode(message);

  if (pickupMode && catalogCode) {
    return {
      kind: "PICKUP_ACTION",
      request: {
        mode: pickupMode.mode,
        catalogCode,
        requestedQuantity: pickupMode.requestedQuantity,
        negotiationNumber,
      },
    };
  }

  const ambiguousQuantity = extractQuantity(message, [
    new RegExp(
      `\\b(?:retire|retirar|marque|marcar)\\s+${quantityCapture}\\b`,
    ),
  ]);

  if (ambiguousQuantity && catalogCode) {
    return {
      kind: "AMBIGUOUS_PICKUP_MODE",
      catalogCode,
      requestedQuantity: ambiguousQuantity,
      negotiationNumber,
    };
  }

  if (
    /\b(?:retire|retirar|marque|marcar|acrescente|registre|registrar|defina|definir|deixe|deixar)\b/.test(
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
  readyQuantity: number;
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
      availableQuantity: number;
    }
  | {
      kind:
        | "invalid"
        | "no_change"
        | "reduction"
        | "above_limit"
        | "below_stocked";
      pickupLimit: number;
      availableQuantity: number;
    };

export function validateSupplierOrderPickupLine(
  mode: "increment" | "set_total",
  requestedQuantity: number,
  item: SupplierOrderPickupLineState,
): SupplierOrderPickupLineValidation {
  const values = [
    item.orderedQuantity,
    item.readyQuantity,
    item.cancelledQuantity,
    item.stockedQuantity,
    item.pickedQuantity,
  ];
  const pickupLimit = item.readyQuantity;
  const availableQuantity = Math.max(
    item.readyQuantity - item.pickedQuantity,
    0,
  );
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
    item.readyQuantity + item.cancelledQuantity > item.orderedQuantity ||
    item.pickedQuantity > item.readyQuantity ||
    item.pickedQuantity > pickupLimit ||
    item.stockedQuantity > item.pickedQuantity ||
    !target
  ) {
    return { kind: "invalid", pickupLimit, availableQuantity };
  }

  if (target.targetPickedQuantity < item.pickedQuantity) {
    return { kind: "reduction", pickupLimit, availableQuantity };
  }

  if (target.targetPickedQuantity === item.pickedQuantity) {
    return { kind: "no_change", pickupLimit, availableQuantity };
  }

  if (target.targetPickedQuantity > pickupLimit) {
    return { kind: "above_limit", pickupLimit, availableQuantity };
  }

  if (target.targetPickedQuantity < item.stockedQuantity) {
    return { kind: "below_stocked", pickupLimit, availableQuantity };
  }

  return {
    kind: "valid",
    targetPickedQuantity: target.targetPickedQuantity,
    addedQuantity: target.addedQuantity,
    remainingAfter: pickupLimit - target.targetPickedQuantity,
    availableQuantity,
  };
}

export function summarizeSupplierOrderMarkAll(
  items: SupplierOrderPickupLineState[],
) {
  return items.reduce(
    (summary, item) => {
      const addedQuantity = Math.max(
        item.readyQuantity - item.pickedQuantity,
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
