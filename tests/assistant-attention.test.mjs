import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assistantAttentionDetailLineLimit,
  assistantAttentionMaxItems,
  buildAssistantAttentionSummary,
} from "../lib/assistant-attention.ts";
import { loadAssistantAttention } from "../lib/assistant-attention-data.ts";
import {
  createAssistantAttentionMessage,
  formatAssistantAttentionDetail,
} from "../lib/assistant-attention-chat.ts";

const generatedAt = new Date("2026-09-03T15:00:00.000Z");
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function input(overrides = {}) {
  return {
    purchaseRecommendations: [],
    readyPickupOrders: [],
    pendingStockOrders: [],
    ...overrides,
  };
}

function replenishment(overrides = {}) {
  return {
    targetKind: "item",
    targetId: "item-1",
    primaryCode: "1B",
    currentStock: 2,
    minimumStock: 5,
    pendingPurchaseQuantity: 0,
    remainingGap: 3,
    ...overrides,
  };
}

test("nenhuma pendência produz ALL_CLEAR", () => {
  const result = buildAssistantAttentionSummary(input(), generatedAt);

  assert.equal(result.status, "ALL_CLEAR");
  assert.deepEqual(result.items, []);
  assert.equal(result.generatedAt, generatedAt.toISOString());
});

test("estoque abaixo do mínimo sem cobertura produz reposição", () => {
  const result = buildAssistantAttentionSummary(
    input({ purchaseRecommendations: [replenishment()] }),
    generatedAt,
  );

  assert.equal(result.status, "HAS_ATTENTION");
  assert.equal(result.items[0].kind, "REPLENISHMENT_NEEDED");
  assert.equal(result.items[0].severity, "HIGH");
  assert.equal(result.items[0].metadata.uncoveredCount, 1);
  assert.match(result.items[0].summary, /sem cobertura em Pedidos/);
});

test("estoque abaixo do mínimo totalmente coberto não aparece como urgente", () => {
  const result = buildAssistantAttentionSummary(
    input({
      purchaseRecommendations: [
        replenishment({
          pendingPurchaseQuantity: 3,
          remainingGap: 0,
        }),
      ],
    }),
    generatedAt,
  );

  assert.equal(result.status, "ALL_CLEAR");
  assert.equal(
    result.items.some((item) => item.kind === "REPLENISHMENT_NEEDED"),
    false,
  );
});

test("cobertura parcial mantém a lacuna visível sem refazer a fórmula", () => {
  const result = buildAssistantAttentionSummary(
    input({
      purchaseRecommendations: [
        replenishment({
          pendingPurchaseQuantity: 2,
          remainingGap: 1,
        }),
      ],
    }),
    generatedAt,
  );
  const card = result.items[0];

  assert.equal(card.kind, "REPLENISHMENT_NEEDED");
  assert.equal(card.metadata.partiallyCoveredCount, 1);
  assert.match(card.summary, /cobertura parcial/);
});

test("item zerado e sem cobertura recebe prioridade máxima", () => {
  const result = buildAssistantAttentionSummary(
    input({
      purchaseRecommendations: [replenishment({ currentStock: 0 })],
    }),
    generatedAt,
  );

  assert.equal(result.items[0].severity, "CRITICAL");
  assert.equal(result.items[0].metadata.zeroStockCount, 1);
});

test("ready_quantity ainda não retirada aparece agrupada por Pedido", () => {
  const result = buildAssistantAttentionSummary(
    input({
      readyPickupOrders: [
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          readyWaitingPickupQuantity: 2,
        },
        {
          supplierOrderId: "order-2",
          negotiationNumber: "40971",
          readyWaitingPickupQuantity: 3,
        },
      ],
    }),
    generatedAt,
  );
  const card = result.items.find(
    (item) => item.kind === "SAFISA_READY_PICKUP",
  );

  assert.equal(card?.count, 2);
  assert.equal(card?.metadata.readyQuantity, 5);
  assert.match(card?.summary ?? "", /2 Pedidos têm 5 unidades prontas/);
});

test("picked_quantity ainda não estocada aparece como entrada pendente", () => {
  const result = buildAssistantAttentionSummary(
    input({
      pendingStockOrders: [
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          orderDate: "2026-08-24",
          waitingStockQuantity: 4,
        },
      ],
    }),
    generatedAt,
  );
  const card = result.items.find(
    (item) => item.kind === "SUPPLIER_ORDER_PENDING_STOCK",
  );

  assert.equal(card?.count, 1);
  assert.equal(card?.metadata.waitingStockQuantity, 4);
  assert.equal(card?.detail.lines[0].negotiationNumber, "40959");
});

test("várias linhas da mesma categoria viram somente um card", () => {
  const result = buildAssistantAttentionSummary(
    input({
      purchaseRecommendations: [
        replenishment({ targetId: "item-1" }),
        replenishment({
          targetId: "item-2",
          primaryCode: "1E",
          currentStock: 4,
          remainingGap: 1,
        }),
      ],
      readyPickupOrders: [
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          readyWaitingPickupQuantity: 2,
        },
        {
          supplierOrderId: "order-2",
          negotiationNumber: "40971",
          readyWaitingPickupQuantity: 1,
        },
      ],
      pendingStockOrders: [
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          orderDate: "2026-08-24",
          waitingStockQuantity: 1,
        },
        {
          supplierOrderId: "order-2",
          negotiationNumber: "40971",
          orderDate: "2026-08-23",
          waitingStockQuantity: 2,
        },
      ],
    }),
    generatedAt,
  );

  assert.deepEqual(
    result.items.map((item) => item.kind),
    [
      "REPLENISHMENT_NEEDED",
      "SAFISA_READY_PICKUP",
      "SUPPLIER_ORDER_PENDING_STOCK",
    ],
  );
  assert.equal(new Set(result.items.map((item) => item.kind)).size, result.items.length);
  assert.ok(result.items.length <= assistantAttentionMaxItems);
});

test("linhas duplicadas não duplicam Pedido nem alvo", () => {
  const duplicated = replenishment();
  const result = buildAssistantAttentionSummary(
    input({
      purchaseRecommendations: [duplicated, duplicated],
      readyPickupOrders: [
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          readyWaitingPickupQuantity: 2,
        },
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          readyWaitingPickupQuantity: 2,
        },
      ],
      pendingStockOrders: [
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          orderDate: "2026-08-24",
          waitingStockQuantity: 3,
        },
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          orderDate: "2026-08-24",
          waitingStockQuantity: 3,
        },
      ],
    }),
    generatedAt,
  );

  assert.equal(result.items.find((item) => item.kind === "REPLENISHMENT_NEEDED")?.count, 1);
  assert.equal(result.items.find((item) => item.kind === "SAFISA_READY_PICKUP")?.count, 1);
  assert.equal(result.items.find((item) => item.kind === "SUPPLIER_ORDER_PENDING_STOCK")?.count, 1);
});

test("detalhe de reposição usa remainingGap oficial e limita cinco linhas", () => {
  const purchaseRecommendations = Array.from({ length: 8 }, (_, index) =>
    replenishment({
      targetId: `item-${index}`,
      primaryCode: `C${index + 1}`,
      currentStock: index < 2 ? 0 : 9,
      minimumStock: 10,
      pendingPurchaseQuantity: index === 0 ? 3 : 0,
      remainingGap: 8 - index,
    }),
  );
  const result = buildAssistantAttentionSummary(
    input({ purchaseRecommendations }),
    generatedAt,
  );
  const card = result.items.find(
    (item) => item.kind === "REPLENISHMENT_NEEDED",
  );

  assert.ok(card);
  assert.equal(card?.detail.lines.length, assistantAttentionDetailLineLimit);
  assert.equal(card?.detail.remainingCount, 3);
  assert.deepEqual(
    card?.detail.lines.slice(0, 2).map((line) => line.code),
    ["C1", "C2"],
  );
  assert.equal(card?.detail.lines[0].remainingGap, 8);
  assert.match(
    formatAssistantAttentionDetail(card),
    /Já comprado 3 · Comprar mais 8/,
  );
  assert.match(formatAssistantAttentionDetail(card), /E mais 3 itens/);
});

test("clique local pode criar somente uma resposta da Assistente", () => {
  const result = buildAssistantAttentionSummary(
    input({ purchaseRecommendations: [replenishment()] }),
    generatedAt,
  );
  const message = createAssistantAttentionMessage(
    result.items[0],
    "local-attention-message",
  );

  assert.deepEqual(
    { id: message.id, role: message.role },
    { id: "local-attention-message", role: "assistant" },
  );
  assert.match(message.content, /Reposição necessária/);
  assert.match(message.content, /Est\. 2 · Mín\. 5 · Comprar 3/);
});

test("detalhe Safisa mostra negociação humana e preserva a ordem oficial", () => {
  const hiddenId = "77777777-7777-4777-8777-777777777777";
  const result = buildAssistantAttentionSummary(
    input({
      readyPickupOrders: [
        {
          supplierOrderId: hiddenId,
          negotiationNumber: "40959",
          readyWaitingPickupQuantity: 12,
        },
        {
          supplierOrderId: "order-2",
          negotiationNumber: "40971",
          readyWaitingPickupQuantity: 8,
        },
      ],
    }),
    generatedAt,
  );
  const card = result.items.find(
    (item) => item.kind === "SAFISA_READY_PICKUP",
  );
  assert.ok(card);
  const content = formatAssistantAttentionDetail(card);

  assert.deepEqual(
    card?.detail.lines.map((line) => line.negotiationNumber),
    ["40959", "40971"],
  );
  assert.match(content, /Pedido 40959.*12 unidades/);
  assert.match(content, /Pedido 40971.*8 unidades/);
  assert.doesNotMatch(content, new RegExp(hiddenId, "i"));
});

test("detalhe de entrada pendente ordena quantidade e mostra negociação", () => {
  const result = buildAssistantAttentionSummary(
    input({
      pendingStockOrders: [
        {
          supplierOrderId: "order-1",
          negotiationNumber: "40959",
          orderDate: "2026-08-24",
          waitingStockQuantity: 3,
        },
        {
          supplierOrderId: "order-2",
          negotiationNumber: "40971",
          orderDate: "2026-08-23",
          waitingStockQuantity: 7,
        },
      ],
    }),
    generatedAt,
  );
  const card = result.items.find(
    (item) => item.kind === "SUPPLIER_ORDER_PENDING_STOCK",
  );
  assert.ok(card);
  const content = formatAssistantAttentionDetail(card);

  assert.equal(card?.detail.lines[0].negotiationNumber, "40971");
  assert.match(content, /Pedido 40971.*7 unidades/);
  assert.match(content, /Pedido 40959.*3 unidades/);
});

test("cards são botões acessíveis e injetam detalhes sem rede ou mutação", () => {
  const home = read("components/assistant-home.tsx");
  const view = read("components/assistant-attention-summary.tsx");
  const selectionHandler = home.slice(
    home.indexOf("function handleAttentionSelect"),
    home.indexOf("async function prepareSelectedImage"),
  );

  assert.match(view, /<button/);
  assert.match(view, /type="button"/);
  assert.match(view, /aria-label=\{`Mostrar/);
  assert.match(view, /min-h-24 w-full/);
  assert.match(view, /onClick=\{\(\) => onSelect\(item\)\}/);
  assert.doesNotMatch(view, /next\/link|<Link|href=/);
  assert.match(selectionHandler, /setMessages/);
  assert.match(selectionHandler, /createAssistantAttentionMessage/);
  assert.doesNotMatch(
    selectionHandler,
    /fetch|sendAssistantMessage|router\.|\/api\/assistant|rpc|supabase/i,
  );
});

test("detalhes locais não importam Gemini nem endpoints operacionais", () => {
  const detail = read("lib/assistant-attention-chat.ts");
  const view = read("components/assistant-attention-summary.tsx");

  for (const source of [detail, view]) {
    assert.doesNotMatch(
      source,
      /@google\/genai|Gemini|\/api\/assistant|createClient|supabase|fetch\(/i,
    );
  }
});

test("loader usa readers oficiais controlados e não chama Gemini", async () => {
  const calls = [];
  const result = await loadAssistantAttention({
    loadPurchaseRecommendations: async () => {
      calls.push("purchase");
      return {
        data: {
          allItems: [],
          buyNow: [],
          alreadyOrdered: [],
          missingMinimum: [],
          summary: {
            buyNowCount: 0,
            alreadyOrderedCount: 0,
            missingMinimumCount: 0,
          },
        },
        error: null,
      };
    },
    loadSafisaPickupAlerts: async () => {
      calls.push("safisa");
      return {
        data: { alerts: [], alertCount: 0, isComplete: true },
        error: null,
      };
    },
    loadPendingStockOrders: async () => {
      calls.push("orders");
      return [];
    },
    now: () => generatedAt,
  });

  assert.equal(result.data?.status, "ALL_CLEAR");
  assert.deepEqual(calls.sort(), ["orders", "purchase", "safisa"]);

  const attentionData = read("lib/assistant-attention-data.ts");
  const homePage = read("app/(authenticated)/page.tsx");
  assert.match(
    attentionData,
    /id, negotiation_number, order_date, waiting_stock_quantity/,
  );
  assert.doesNotMatch(attentionData, /Gemini|routeAssistantMessageSemantically|@google\/genai/);
  assert.doesNotMatch(homePage, /Gemini|routeAssistantMessageSemantically|@google\/genai/);
});

test("falha de reader não é convertida em falso ALL_CLEAR", async () => {
  const result = await loadAssistantAttention({
    loadPurchaseRecommendations: async () => ({
      data: null,
      error: "indisponível",
    }),
    loadSafisaPickupAlerts: async () => ({
      data: { alerts: [], alertCount: 0, isComplete: true },
      error: null,
    }),
    loadPendingStockOrders: async () => [],
    now: () => generatedAt,
  });

  assert.equal(result.data, null);
  assert.match(result.error, /Não foi possível conferir/);
});

test("Home substitui sugestões genéricas e ALL_CLEAR mantém o composer", () => {
  const home = read("components/assistant-home.tsx");
  const view = read("components/assistant-attention-summary.tsx");

  assert.match(home, /AssistantAttentionSummaryView/);
  assert.doesNotMatch(home, /initialSuggestions|Como posso ajudar\?/);
  assert.match(view, /Tudo em dia por aqui/);
  assert.match(view, /Se precisar de outra coisa, é só me perguntar/);
  assert.match(home, /sendAssistantMessage/);
  assert.match(home, /Digite uma mensagem/);
});
