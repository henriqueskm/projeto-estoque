import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assistantSemanticRouterMaximumLines,
  assistantSemanticRouterTimeoutMs,
  isSemanticManualActionPreparationAllowed,
  parseAssistantSemanticResult,
  resolveAssistantSemanticRouterModel,
  routeAssistantMessageSemantically,
} from "../lib/ai/assistant-semantic-router.ts";
import {
  assistantCapabilities,
  buildAssistantCapabilityHelp,
  isAssistantCapabilityId,
} from "../lib/ai/assistant-capabilities.ts";
import {
  resolveAssistantSemanticManualActionDisposition,
  resolveAssistantSemanticQueryPlan,
} from "../lib/ai/assistant-semantic-integration.ts";
import { answerAssistantQuestion } from "../lib/ai/assistant.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const emptyContext = {
  topic: "GENERAL",
  itemQuery: null,
  itemReferenceKind: null,
  supplierOrderId: null,
  supplierOrderCatalogCode: null,
  lastIntent: null,
  suggestedFollowUp: null,
  statisticsPeriod: null,
  statisticsIntent: null,
  statisticsCode: null,
};

function fakeClientFor(routes, requests = []) {
  return {
    interactions: {
      async create(request, options) {
        requests.push({ request, options });
        const prompt = JSON.parse(request.input[0].content[0].text);
        const output = routes.get(prompt.currentMessage);
        if (output instanceof Error) throw output;
        return { output_text: typeof output === "string" ? output : JSON.stringify(output) };
      },
    },
  };
}

async function classifyWithFake(message, output, options = {}) {
  const requests = [];
  const outcome = await routeAssistantMessageSemantically(
    {
      message,
      recentConversation: options.recentConversation ?? [],
      conversationContext: options.conversationContext ?? emptyContext,
    },
    { client: fakeClientFor(new Map([[message, output]]), requests), timeoutMs: options.timeoutMs },
  );
  return { outcome, requests };
}

function answerWithSemanticFake(message, semanticResult, dependencies = {}, context = emptyContext) {
  return answerAssistantQuestion(
    message,
    context.itemQuery,
    context.supplierOrderId,
    context.supplierOrderCatalogCode,
    "Henrique",
    "test-user",
    "Henrique Klein",
    null,
    null,
    null,
    null,
    null,
    null,
    [],
    context,
    {
      semanticRouter: async () => ({
        status: "ROUTED",
        result: semanticResult,
        model: "semantic-fake",
      }),
      ...dependencies,
    },
  );
}

test("HELP diferencia explicação de pedido operacional e não produz linhas de ação", async () => {
  const cases = [
    ["como faço para dar saída aqui pelo chat?", "MANUAL_STOCK_OUTPUT"],
    ["me ensina a dar entrada de vários itens", "MANUAL_STOCK_ENTRY"],
    ["se eu quiser baixar 2 do 1B, como faço?", "MANUAL_STOCK_OUTPUT"],
    ["como funciona a montagem?", "CONFIGURATION_ASSEMBLY"],
    ["o que você consegue fazer?", "ASSISTANT_OVERVIEW"],
    ["errei o saldo, como corrijo?", "STOCK_ADJUSTMENT"],
  ];
  for (const [message, capabilityId] of cases) {
    const { outcome } = await classifyWithFake(message, {
      intent: "HELP",
      capabilityIds: [capabilityId],
    });
    assert.equal(outcome.status, "ROUTED", message);
    assert.equal(outcome.result.intent, "HELP", message);
    assert.deepEqual(outcome.result.capabilityIds, [capabilityId], message);
    assert.equal("action" in outcome.result, false, message);
  }
});

test("capability registry responde somente com capacidades e restrições reais", () => {
  assert.equal(isAssistantCapabilityId("MANUAL_STOCK_OUTPUT"), true);
  assert.equal(isAssistantCapabilityId("INVENTAR_PEDIDO"), false);
  const outputHelp = buildAssistantCapabilityHelp(["MANUAL_STOCK_OUTPUT"]);
  assert.match(outputHelp, /quantidade e código/);
  assert.match(outputHelp, /Confirme somente pelo botão/);
  const minimumHelp = buildAssistantCapabilityHelp(["MINIMUM_STOCK_MANAGEMENT"]);
  assert.match(minimumHelp, /não pelo chat/);
  assert.match(minimumHelp, /Tela relacionada: \/estoque/);
  const overview = buildAssistantCapabilityHelp(["ASSISTANT_OVERVIEW"]);
  assert.match(overview, /O que a Assistente NK consegue fazer/);
  assert.match(overview, /Toda alteração operacional gera uma prévia/);
  assert.equal(
    assistantCapabilities.find(({ id }) => id === "CONFIGURATION_ASSEMBLY")?.page,
    "/estoque",
  );
  assert.equal(
    assistantCapabilities.find(({ id }) => id === "CONFIGURATION_DISASSEMBLY")?.page,
    "/estoque",
  );
  const adjustmentHelp = buildAssistantCapabilityHelp(["STOCK_ADJUSTMENT"]);
  assert.match(adjustmentHelp, /Ajustar estoque/);
  assert.match(adjustmentHelp, /não executa ajuste de saldo pelo chat/);
  assert.match(adjustmentHelp, /Tela relacionada: \/estoque/);
});

test("pipeline semântico preserva todas as rotas ricas de recomendação de compra", () => {
  const cases = [
    ["Quanto preciso comprar do 1B?", "code", "1B", "recommendation"],
    ["O 1B já está comprado/em Pedido?", "code", "1B", "pending"],
    ["O que já foi comprado?", "already_ordered", null, null],
    ["Quais produtos estão sem estoque mínimo?", "missing_minimum", null, null],
    ["O que preciso comprar?", "buy_now", null, null],
  ];

  for (const [message, mode, queryCode, codeIntent] of cases) {
    const plan = resolveAssistantSemanticQueryPlan({
      message,
      semanticQuery: { kind: "PURCHASE_RECOMMENDATION" },
      lastItemQuery: null,
      lastSupplierOrderId: null,
      lastSupplierOrderCatalogCode: null,
    });
    assert.equal(plan.kind, "PURCHASE_RECOMMENDATION", message);
    assert.equal(plan.source, "DETERMINISTIC", message);
    assert.deepEqual(plan.route, {
      kind: "QUERY",
      mode,
      queryCode,
      codeIntent,
    }, message);
  }
});

test("pipeline semântico preserva negociação, código e pendências de Pedidos", () => {
  const cases = [
    {
      message: "Como está o Pedido 40959?",
      focus: "ALL",
      verify(query) {
        assert.equal(query.mode, "DETAIL");
        assert.equal(query.negotiationNumber, "40959");
      },
    },
    {
      message: "Tenho 1B nos Pedidos?",
      focus: "ALL",
      verify(query) {
        assert.equal(query.catalogCode, "1B");
      },
    },
    {
      message: "O que falta retirar dos Pedidos?",
      focus: "WAITING_PICKUP",
      verify(query) {
        assert.equal(query.hasWaitingPickup, true);
        assert.equal(query.lineFocus, "WAITING_PICKUP");
      },
    },
    {
      message: "Quais Pedidos têm entrada pendente?",
      focus: "WAITING_STOCK",
      verify(query) {
        assert.equal(query.hasWaitingStock, true);
        assert.equal(query.lineFocus, "WAITING_STOCK");
      },
    },
  ];

  for (const { message, focus, verify } of cases) {
    const plan = resolveAssistantSemanticQueryPlan({
      message,
      semanticQuery: { kind: "SUPPLIER_ORDERS", focus },
      lastItemQuery: null,
      lastSupplierOrderId: null,
      lastSupplierOrderCatalogCode: null,
      now: new Date("2026-09-03T12:00:00-03:00"),
    });
    assert.equal(plan.kind, "SUPPLIER_ORDERS", message);
    assert.equal(plan.route.kind, "ORDER_QUERY", message);
    verify(plan.route.query);
  }
});

test("scope guard impede preview manual de operações vinculadas a Pedido", () => {
  const cases = [
    ["Retire 2 do 1B no Pedido 40959", "DEFER_TO_SUPPLIER_ORDER_PIPELINE"],
    ["Dê entrada em 2 do 1B no Pedido 40959", "DEFER_TO_SUPPLIER_ORDER_PIPELINE"],
    ["Baixe 2 do 1B", "ALLOW_MANUAL_PREVIEW"],
  ];
  for (const [message, expected] of cases) {
    assert.equal(
      resolveAssistantSemanticManualActionDisposition({
        message,
        conversationContext: emptyContext,
      }),
      expected,
      message,
    );
  }

  assert.equal(
    resolveAssistantSemanticManualActionDisposition({
      message: "Coloque 2 do 1B",
      conversationContext: { ...emptyContext, topic: "SUPPLIER_ORDER" },
    }),
    "CLARIFY_SUPPLIER_ORDER_SCOPE",
  );
});

test("answerAssistantQuestion entrega HELP final pelo registry sem preview", async () => {
  let manualBuilderCalls = 0;
  const answer = await answerWithSemanticFake(
    "Como faço para dar saída aqui pelo chat?",
    { intent: "HELP", capabilityIds: ["MANUAL_STOCK_OUTPUT"] },
    {
      manualStockOutputPreview: async () => {
        manualBuilderCalls += 1;
        throw new Error("HELP não pode chamar builder manual.");
      },
      manualStockOutputBatchPreview: async () => {
        manualBuilderCalls += 1;
        throw new Error("HELP não pode chamar builder batch.");
      },
    },
  );

  assert.match(answer.message, /Saída manual/);
  assert.match(answer.message, /Confirme somente pelo botão/);
  assert.equal(answer.structuredBlock, undefined);
  assert.equal(answer.proposalToken, undefined);
  assert.equal(manualBuilderCalls, 0);
});

test("answerAssistantQuestion encaminha ACTION manual ao builder batch oficial substituível", async () => {
  const received = [];
  let singleBuilderCalls = 0;
  const answer = await answerWithSemanticFake(
    "Pode tirar dois 1B e um 11A pra mim?",
    {
      intent: "ACTION",
      action: {
        kind: "MANUAL_STOCK_OUTPUT",
        lines: [
          { quantity: 2, targetQuery: "1B", requestedIdentity: null },
          { quantity: 1, targetQuery: "11A", requestedIdentity: null },
        ],
      },
    },
    {
      manualStockOutputPreview: async () => {
        singleBuilderCalls += 1;
        throw new Error("A lista não pode usar o builder unitário.");
      },
      manualStockOutputBatchPreview: async (lines, actor) => {
        received.push({ lines, actor });
        return {
          message: "Revise a saída preparada.",
          structuredBlock: { kind: "manual_stock_output_preview" },
          proposalToken: "preview-only-test-token",
        };
      },
    },
  );

  assert.equal(received.length, 1);
  assert.deepEqual(received[0].lines.map(({ quantity, targetQuery }) => ({ quantity, targetQuery })), [
    { quantity: 2, targetQuery: "1B" },
    { quantity: 1, targetQuery: "11A" },
  ]);
  assert.deepEqual(received[0].actor, { userId: "test-user", profileName: "Henrique Klein" });
  assert.equal(singleBuilderCalls, 0);
  assert.equal(answer.structuredBlock.kind, "manual_stock_output_preview");
  assert.equal(answer.proposalToken, "preview-only-test-token");
});

test("answerAssistantQuestion não deixa ACTION semântica manual roubar retirada de Pedido", async () => {
  let manualBuilderCalls = 0;
  const pickupRequests = [];
  const answer = await answerWithSemanticFake(
    "Retire 2 do 1B no Pedido 40959",
    {
      intent: "ACTION",
      action: {
        kind: "MANUAL_STOCK_OUTPUT",
        lines: [{ quantity: 2, targetQuery: "1B", requestedIdentity: null }],
      },
    },
    {
      manualStockOutputPreview: async () => {
        manualBuilderCalls += 1;
        throw new Error("Pedido não pode usar builder de saída manual.");
      },
      manualStockOutputBatchPreview: async () => {
        manualBuilderCalls += 1;
        throw new Error("Pedido não pode usar builder batch manual.");
      },
      supplierOrderPickupPreview: async (request) => {
        pickupRequests.push(request);
        return {
          message: "Revise a retirada do Pedido.",
          structuredBlock: { kind: "assistant_action_preview" },
          proposalToken: "supplier-order-preview-token",
        };
      },
    },
  );

  assert.equal(manualBuilderCalls, 0);
  assert.equal(pickupRequests.length, 1);
  assert.equal(pickupRequests[0].negotiationNumber, "40959");
  assert.equal(pickupRequests[0].catalogCode, "1B");
  assert.equal(answer.structuredBlock.kind, "assistant_action_preview");
});

test("answerAssistantQuestion preserva consulta de compra específica até o reader", async () => {
  const routes = [];
  const answer = await answerWithSemanticFake(
    "Quanto preciso comprar do 1B?",
    { intent: "QUERY", query: { kind: "PURCHASE_RECOMMENDATION" } },
    {
      purchaseRecommendationReader: async (route) => {
        routes.push(route);
        return {
          kind: "purchase_recommendation",
          fallbackText: "Recomendação específica do 1B.",
          queryStatus: "FOUND",
          items: [{ primaryCode: "1B" }],
        };
      },
    },
  );

  assert.deepEqual(routes, [{
    kind: "QUERY",
    mode: "code",
    queryCode: "1B",
    codeIntent: "recommendation",
  }]);
  assert.equal(answer.message, "Recomendação específica do 1B.");
  assert.equal(answer.structuredBlock.kind, "purchase_recommendation");
  assert.equal(answer.contextItemQuery, "1B");
});

test("answerAssistantQuestion preserva negociação específica até o reader de Pedido", async () => {
  const queries = [];
  const answer = await answerWithSemanticFake(
    "Como está o Pedido 40959?",
    { intent: "QUERY", query: { kind: "SUPPLIER_ORDERS", focus: "ALL" } },
    {
      supplierOrderReader: async (query) => {
        queries.push(query);
        return {
          block: {
            kind: "supplier_order_detail",
            fallbackText: "Pedido 40959 encontrado.",
          },
          contextSupplierOrderId: "test-context-only",
        };
      },
    },
  );

  assert.equal(queries.length, 1);
  assert.equal(queries[0].mode, "DETAIL");
  assert.equal(queries[0].negotiationNumber, "40959");
  assert.equal(answer.message, "Pedido 40959 encontrado.");
  assert.equal(answer.structuredBlock.kind, "supplier_order_detail");
});

test("answerAssistantQuestion entrega ajuda PAGE_ONLY para ajuste sem mutação", async () => {
  const answer = await answerWithSemanticFake(
    "Errei o estoque, como corrijo?",
    { intent: "HELP", capabilityIds: ["STOCK_ADJUSTMENT"] },
  );

  assert.match(answer.message, /Ajustar estoque/);
  assert.match(answer.message, /Tela relacionada: \/estoque/);
  assert.match(answer.message, /não executa ajuste de saldo pelo chat/);
  assert.equal(answer.structuredBlock, undefined);
  assert.equal(answer.proposalToken, undefined);
});

test("ACTION extrai entrada e saída manual em linhas estritas sem resolver catálogo", async () => {
  const cases = [
    ["baixa 2 do 1B", "MANUAL_STOCK_OUTPUT", [{ quantity: 2, targetQuery: "1B", requestedIdentity: null }]],
    ["pode tirar dois 1B pra mim?", "MANUAL_STOCK_OUTPUT", [{ quantity: 2, targetQuery: "1B", requestedIdentity: null }]],
    ["saíram dois 1B e um 11A, dá baixa nisso pra mim", "MANUAL_STOCK_OUTPUT", [
      { quantity: 2, targetQuery: "1B", requestedIdentity: null },
      { quantity: 1, targetQuery: "11A", requestedIdentity: null },
    ]],
    ["chegaram três KT-18, lança no estoque pra mim", "MANUAL_STOCK_ENTRY", [
      { quantity: 3, targetQuery: "KT-18", requestedIdentity: null },
    ]],
    ["coloca 2 do 1B e 3 do 1E no estoque", "MANUAL_STOCK_ENTRY", [
      { quantity: 2, targetQuery: "1B", requestedIdentity: null },
      { quantity: 3, targetQuery: "1E", requestedIdentity: null },
    ]],
  ];
  for (const [message, kind, lines] of cases) {
    const { outcome } = await classifyWithFake(message, {
      intent: "ACTION",
      action: { kind, lines },
    });
    assert.equal(outcome.status, "ROUTED", message);
    assert.deepEqual(outcome.result, { intent: "ACTION", action: { kind, lines } }, message);
  }
});

test("relato passado, negação, hipótese, pergunta e consulta nunca viram preparação autorizada", async () => {
  const cases = [
    ["já dei baixa em 2 do 1B", { intent: "CHAT" }],
    ["não dê baixa no 1B", { intent: "CHAT" }],
    ["se eu der baixa em 2 do 1B, o que acontece?", { intent: "HELP", capabilityIds: ["MANUAL_STOCK_OUTPUT"] }],
    ["como faço para baixar 2 do 1B?", { intent: "HELP", capabilityIds: ["MANUAL_STOCK_OUTPUT"] }],
    ["qual foi a baixa do 1B?", { intent: "QUERY", query: { kind: "STATISTICS", statisticsIntent: "CODE_OUTBOUND", period: null, targetQuery: "1B" } }],
  ];
  for (const [message, expected] of cases) {
    const { outcome } = await classifyWithFake(message, expected);
    assert.equal(outcome.status, "ROUTED", message);
    assert.deepEqual(outcome.result, expected, message);
    assert.notEqual(outcome.result.intent, "ACTION", message);
  }
  for (const message of [
    "já dei baixa em 2 do 1B",
    "não dê baixa no 1B",
    "por favor, não dê baixa no 1B",
    "se eu der baixa em 2 do 1B, o que acontece?",
    "como faço para baixar 2 do 1B?",
    "eu já dei baixa em 2 do 1B",
  ]) {
    assert.equal(isSemanticManualActionPreparationAllowed(message), false, message);
  }
  assert.equal(isSemanticManualActionPreparationAllowed("saíram dois 1B e um 11A, dá baixa nisso pra mim"), true);
});

test("QUERY seleciona apenas consultas oficiais existentes", async () => {
  const cases = [
    ["quanto sobrou do 1B?", { kind: "INVENTORY_ITEM", targetQuery: "1B", metric: "STOCK" }],
    ["tem alguma coisa acabando?", { kind: "LOW_STOCK" }],
    ["o que eu preciso comprar?", { kind: "PURCHASE_RECOMMENDATION" }],
    ["o que falta retirar dos pedidos?", { kind: "SUPPLIER_ORDERS", focus: "WAITING_PICKUP" }],
    ["qual produto mais saiu nos últimos 30 dias?", { kind: "STATISTICS", statisticsIntent: "TOP_CONFIGURATION", period: 30, targetQuery: null }],
  ];
  for (const [message, query] of cases) {
    const { outcome } = await classifyWithFake(message, { intent: "QUERY", query });
    assert.equal(outcome.status, "ROUTED", message);
    assert.deepEqual(outcome.result, { intent: "QUERY", query }, message);
  }
});

test("CLARIFY exige dados ausentes em vez de inventar quantidade ou alvo", async () => {
  for (const [message, reason] of [
    ["faz 2", "MISSING_TARGET"],
    ["tira um daquele", "UNSAFE_REFERENCE"],
    ["coloca isso no estoque", "MISSING_QUANTITY"],
  ]) {
    const { outcome } = await classifyWithFake(message, { intent: "CLARIFY", reason });
    assert.equal(outcome.status, "ROUTED", message);
    assert.deepEqual(outcome.result, { intent: "CLARIFY", reason }, message);
  }
});

test("schema rejeita campos desconhecidos, quantidade inválida, alvo vazio e mais de 12 linhas", () => {
  const validLine = { quantity: 2, targetQuery: "1B", requestedIdentity: null };
  assert.equal(parseAssistantSemanticResult({ intent: "CHAT", extra: true }), null);
  assert.equal(parseAssistantSemanticResult({
    intent: "ACTION",
    action: { kind: "MANUAL_STOCK_OUTPUT", lines: [{ ...validLine, quantity: 0 }] },
  }), null);
  assert.equal(parseAssistantSemanticResult({
    intent: "ACTION",
    action: { kind: "MANUAL_STOCK_OUTPUT", lines: [{ ...validLine, targetQuery: " " }] },
  }), null);
  assert.equal(parseAssistantSemanticResult({
    intent: "ACTION",
    action: { kind: "MANUAL_STOCK_OUTPUT", lines: Array.from({ length: assistantSemanticRouterMaximumLines + 1 }, () => validLine) },
  }), null);
  assert.equal(parseAssistantSemanticResult({ intent: "HELP", capabilityIds: ["CAPABILITY_INVENTADA"] }), null);
});

test("provider usa structured output, store false, nenhuma ferramenta e zero retry", async () => {
  const requests = [];
  const message = "como faço para dar saída?";
  const outcome = await routeAssistantMessageSemantically(
    {
      message,
      recentConversation: [{ role: "user", content: "Pedido 11111111-1111-4111-8111-111111111111 eyJabcdefghijklmnopqrstuvwxyz123456" }],
      conversationContext: { ...emptyContext, supplierOrderId: "11111111-1111-4111-8111-111111111111" },
    },
    {
      client: fakeClientFor(new Map([[message, { intent: "HELP", capabilityIds: ["MANUAL_STOCK_OUTPUT"] }]]), requests),
    },
  );
  assert.equal(outcome.status, "ROUTED");
  assert.equal(requests.length, 1);
  const [{ request, options }] = requests;
  assert.equal(request.store, false);
  assert.equal(request.generation_config.tool_choice, "none");
  assert.equal("tools" in request, false);
  assert.equal(request.response_format.mime_type, "application/json");
  assert.ok(request.response_format.schema.oneOf.length > 5);
  assert.equal(options.maxRetries, 0);
  assert.equal(options.timeout, assistantSemanticRouterTimeoutMs);
  const serialized = JSON.stringify(request);
  assert.doesNotMatch(serialized, /11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(serialized, /eyJabcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(serialized, /proposalToken|idempotency/i);
});

test("timeout, JSON inválido e schema inválido fazem fallback determinístico sem lançar", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const timeout = await routeAssistantMessageSemantically(
      { message: "teste timeout", recentConversation: [], conversationContext: emptyContext },
      { client: { interactions: { create: () => new Promise(() => {}) } }, timeoutMs: 5 },
    );
    assert.deepEqual(timeout.status, "FALLBACK");
    assert.equal(timeout.reason, "TIMEOUT");

    const invalidJson = await classifyWithFake("json ruim", "não-json");
    assert.equal(invalidJson.outcome.status, "FALLBACK");
    assert.equal(invalidJson.outcome.reason, "INVALID_JSON");

    const invalidSchema = await classifyWithFake("schema ruim", { intent: "ACTION", action: { kind: "MANUAL_STOCK_ENTRY", lines: [] } });
    assert.equal(invalidSchema.outcome.status, "FALLBACK");
    assert.equal(invalidSchema.outcome.reason, "SCHEMA_INVALID");
  } finally {
    console.warn = originalWarn;
  }
});

test("modelo possui fallback de variável e default sem tornar variável nova obrigatória", () => {
  const previousRouter = process.env.GEMINI_ASSISTANT_ROUTER_MODEL;
  const previousAssistant = process.env.GEMINI_ASSISTANT_MODEL;
  try {
    process.env.GEMINI_ASSISTANT_ROUTER_MODEL = "router-test";
    process.env.GEMINI_ASSISTANT_MODEL = "assistant-test";
    assert.equal(resolveAssistantSemanticRouterModel(), "router-test");
    delete process.env.GEMINI_ASSISTANT_ROUTER_MODEL;
    assert.equal(resolveAssistantSemanticRouterModel(), "assistant-test");
    delete process.env.GEMINI_ASSISTANT_MODEL;
    assert.equal(resolveAssistantSemanticRouterModel(), "gemini-3.7-flash");
  } finally {
    if (previousRouter === undefined) delete process.env.GEMINI_ASSISTANT_ROUTER_MODEL;
    else process.env.GEMINI_ASSISTANT_ROUTER_MODEL = previousRouter;
    if (previousAssistant === undefined) delete process.env.GEMINI_ASSISTANT_MODEL;
    else process.env.GEMINI_ASSISTANT_MODEL = previousAssistant;
  }
});

test("integração semântica só encaminha ações manuais aos builders de prévia", () => {
  const assistant = read("lib/ai/assistant.ts");
  const semanticRouter = read("lib/ai/assistant-semantic-router.ts");
  assert.match(assistant, /routeAssistantMessageSemantically/);
  assert.match(assistant, /createAssistantManualStockEntry(?:Batch)?Preview/);
  assert.match(assistant, /createAssistantManualStockOutput(?:Batch)?Preview/);
  assert.match(assistant, /requiresManualStockIdentityChoice/);
  assert.match(assistant, /resolveAssistantSemanticQueryPlan/);
  assert.match(assistant, /resolveAssistantSemanticManualActionDisposition/);
  assert.doesNotMatch(semanticRouter, /\.rpc\(|createClient\(|proposalToken|idempotencyKey/);
  assert.doesNotMatch(semanticRouter, /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_GEMINI/);
  const semanticCallIndex = assistant.indexOf("const semanticOutcome");
  assert.ok(assistant.indexOf("getOperationalConfirmationGuard(") < semanticCallIndex);
  assert.ok(assistant.indexOf('stockEntrySelection?.action === "manual_stock_entry_batch"') < semanticCallIndex);
  assert.ok(assistant.indexOf("if (stockOutputSelection)") < semanticCallIndex);
  assert.ok(assistant.indexOf("if (configurationAssemblySelection)") < semanticCallIndex);
  assert.ok(assistant.indexOf("if (configurationDisassemblySelection)") < semanticCallIndex);
  assert.match(assistant, /Boolean\(selectedSupplierOrderItemId\)[\s\S]*routeAssistantMessageSemantically/);
  assert.doesNotMatch(semanticRouter, /confirmAssistant|executeAssistant|mark.*Ready|stock_movements/i);
  const scopeGuardIndex = assistant.indexOf("const manualActionDisposition");
  assert.ok(scopeGuardIndex > semanticCallIndex);
});
