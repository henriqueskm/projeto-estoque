import type { AssistantAttentionItem } from "@/lib/assistant-attention";
import type { AssistantConversationMessage } from "@/lib/assistant-session";

const quantityFormatter = new Intl.NumberFormat("pt-BR");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeInlineLabel(value: string) {
  return value
    .replace(/[\r\n*_`\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanOrderNumber(value: string) {
  const normalized = safeInlineLabel(value);
  return normalized && !uuidPattern.test(normalized) ? normalized : null;
}

function remainingLine(
  count: number,
  singular: string,
  plural: string,
) {
  if (count <= 0) return [];
  return [`- E mais ${quantityFormatter.format(count)} ${count === 1 ? singular : plural}.`];
}

export function formatAssistantAttentionDetail(item: AssistantAttentionItem) {
  if (item.kind === "REPLENISHMENT_NEEDED") {
    const lines = item.detail.lines.map((line) => {
      const pending = line.pendingPurchaseQuantity > 0
        ? ` · Já comprado ${quantityFormatter.format(line.pendingPurchaseQuantity)} · Comprar mais ${quantityFormatter.format(line.remainingGap)}`
        : ` · Comprar ${quantityFormatter.format(line.remainingGap)}`;

      return `- **${safeInlineLabel(line.code)}** — Est. ${quantityFormatter.format(line.currentStock)} · Mín. ${quantityFormatter.format(line.minimumStock)}${pending}`;
    });

    return [
      "**Reposição necessária**",
      "",
      ...lines,
      ...remainingLine(item.detail.remainingCount, "item", "itens"),
      "",
      item.summary,
    ].join("\n");
  }

  const heading =
    item.kind === "SAFISA_READY_PICKUP"
      ? "**Itens prontos para retirada**"
      : "**Aguardando entrada no estoque**";
  const lines = item.detail.lines.map((line) => {
    const negotiationNumber = humanOrderNumber(line.negotiationNumber);
    const label = negotiationNumber ? `Pedido ${negotiationNumber}` : "Pedido";
    return `- **${label}** — ${quantityFormatter.format(line.quantity)} ${line.quantity === 1 ? "unidade" : "unidades"}`;
  });

  return [
    heading,
    "",
    ...lines,
    ...remainingLine(item.detail.remainingCount, "Pedido", "Pedidos"),
    "",
    item.summary,
  ].join("\n");
}

export function createAssistantAttentionMessage(
  item: AssistantAttentionItem,
  id: string,
): AssistantConversationMessage {
  return {
    id,
    role: "assistant",
    content: formatAssistantAttentionDetail(item),
  };
}
