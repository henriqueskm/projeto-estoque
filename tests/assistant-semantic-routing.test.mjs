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
  buildAssistantCapabilityHelp,
  isAssistantCapabilityId,
} from "../lib/ai/assistant-capabilities.ts";

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

test("HELP diferencia explicação de pedido operacional e não produz linhas de ação", async () => {
  const cases = [
    ["como faço para dar saída aqui pelo chat?", "MANUAL_STOCK_OUTPUT"],
    ["me ensina a dar entrada de vários itens", "MANUAL_STOCK_ENTRY"],
    ["se eu quiser baixar 2 do 1B, como faço?", "MANUAL_STOCK_OUTPUT"],
    ["como funciona a montagem?", "CONFIGURATION_ASSEMBLY"],
    ["o que você consegue fazer?", "ASSISTANT_OVERVIEW"],
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
});
