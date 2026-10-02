import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantAttentionSummaryView } from "../components/assistant-attention-summary.tsx";
import { buildAssistantAttentionSummary } from "../lib/assistant-attention.ts";

function attention(count = 20) {
  return buildAssistantAttentionSummary({
    purchaseRecommendations: Array.from({ length: count }, (_, index) => ({
      targetKind: "item", targetId: String(index), primaryCode: `P-${index + 1}`,
      description: "Peça avulsa com descrição longa para leitura em celulares",
      currentStock: 2, minimumStock: 5, pendingPurchaseQuantity: index === 0 ? 1 : 0,
      remainingGap: index === 0 ? 2 : 3,
    })), readyPickupOrders: [], pendingStockOrders: [],
  }, new Date("2026-10-02T15:00:00Z"));
}

function render(summary) {
  return renderToStaticMarkup(createElement(AssistantAttentionSummaryView, {
    attention: summary, attentionError: null, firstName: null, onAttentionSelect() {},
  }));
}

test("reposição usa disclosure nativo acessível e tabela compacta com todos os itens", () => {
  const html = render(attention());
  assert.match(html, /<details[^>]*><summary/);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.match(html, /nk-focus/);
  assert.match(html, /Ver todos os itens/);
  assert.match(html, /w-full table-fixed/);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 20);
  assert.match(html, />P-20<\/span>/);
  for (const label of ["Saldo", "Mín.", "Comprar"]) assert.ok(html.includes(label));
  assert.match(html, /Em Pedidos: 1/);
});

test("Abrir lista recomendada fica depois de todos os itens e usa o deep link existente", () => {
  const html = render(attention());
  assert.ok(html.indexOf("Abrir lista recomendada") > html.indexOf("</table>"));
  assert.match(html, /href="\/estoque\?view=purchase-recommendations"/);
  assert.match(html, /min-h-11 w-full/);
});

test("valores oficiais de saldo, mínimo, cobertura e compra são mantidos no detalhe", () => {
  const summary = attention(1);
  const html = render(summary);
  const line = summary.items[0].detail.lines[0];
  assert.deepEqual([line.currentStock, line.minimumStock, line.pendingPurchaseQuantity, line.remainingGap], [2, 5, 1, 2]);
  assert.match(html, /tabular-nums text-red-700">2<\/td>/);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 1);
});

test("sem reposição não exibe lista ou botão e preserva ALL_CLEAR", () => {
  const html = render(attention(0));
  assert.match(html, /Tudo em dia por aqui/);
  assert.doesNotMatch(html, /<details|<table|Abrir lista recomendada/);
});
