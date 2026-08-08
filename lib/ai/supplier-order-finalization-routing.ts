export type SupplierOrderFinalizationRequest = {
  negotiationNumber: string;
};

export type SupplierOrderFinalizationRoute =
  | { kind: "NOT_FINALIZATION" }
  | { kind: "BUTTON_CONFIRMATION_TEXT" }
  | { kind: "CANCEL" }
  | { kind: "INVALID"; message: string }
  | { kind: "ACTION"; request: SupplierOrderFinalizationRequest };

function normalizeNegotiationNumber(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");

  return normalized &&
    normalized.length <= 120 &&
    /^[\p{L}\p{N} /-]+$/u.test(normalized)
    ? normalized
    : null;
}

export function routeSupplierOrderFinalizationAction(
  rawMessage: string,
): SupplierOrderFinalizationRoute {
  const message = rawMessage.trim();
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

  if (/^(?:sim|confirme|confirmar|pode\s+finalizar|pode\s+encerrar|ok|execute|manda\s+ver)[?!.]*$/.test(normalized)) {
    return { kind: "BUTTON_CONFIRMATION_TEXT" };
  }

  if (/^cancele?(?:\s+(?:esta|essa|a))?\s+finaliza[cç][aã]o(?:\s+do\s+pedido)?[?!.]*$/iu.test(message)) {
    return { kind: "CANCEL" };
  }

  const match = message.match(
    /^\s*(?:(?:pode\s+)?(?:finalize|finalizar|encerrar|concluir))\s+(?:o\s+)?pedido\s+(?:n(?:[úu]mero)?\s+)?(.+?)\s*[?!.]*\s*$/iu,
  );

  if (!match) {
    return { kind: "NOT_FINALIZATION" };
  }

  const negotiationNumber = normalizeNegotiationNumber(match[1] ?? "");

  if (!negotiationNumber) {
    return {
      kind: "INVALID",
      message: "Informe o número exato do Pedido que deseja finalizar.",
    };
  }

  return { kind: "ACTION", request: { negotiationNumber } };
}
