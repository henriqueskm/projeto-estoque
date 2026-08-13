import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  addAssistantConversationalCopy,
  buildAssistantRecentConversation,
  deriveAssistantConversationContext,
  emptyAssistantConversationContext,
  parseAssistantConversationContext,
  parseAssistantRecentConversation,
} from "../lib/assistant-conversation.ts";
import {
  extractServoModelCandidate,
  normalizeServoModel,
} from "../lib/servo-model-search.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function importProjectTypescript(path, aliases = {}) {
  const source = await read(path);
  let output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  output = output.replace(
    /import \{\s*assistantQueryMaxLength,?\s*\} from ["']@\/lib\/assistant-types["'];/,
    "const assistantQueryMaxLength = 120;",
  );

  for (const [specifier, target] of Object.entries(aliases)) {
    output = output.replaceAll(
      JSON.stringify(specifier),
      JSON.stringify(new URL(`../${target}`, import.meta.url).href),
    );
  }

  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const routingModule = importProjectTypescript("lib/ai/assistant-routing.ts", {
  "@/lib/servo-model-search": "lib/servo-model-search.ts",
});
const supplierOrderRoutingModule = importProjectTypescript(
  "lib/ai/supplier-order-routing.ts",
);

test("accepts at most three recent exchanges with a strict textual schema", () => {
  const valid = Array.from({ length: 3 }, (_, index) => [
    { role: "user", content: `Pergunta ${index + 1}` },
    { role: "assistant", content: `Resposta ${index + 1}` },
  ]).flat();

  assert.deepEqual(parseAssistantRecentConversation(valid), valid);
  assert.equal(
    parseAssistantRecentConversation([
      ...valid,
      { role: "user", content: "Quarta pergunta" },
    ]),
    null,
  );
  assert.equal(
    parseAssistantRecentConversation([
      { role: "user", content: "A" },
      { role: "user", content: "B" },
    ]),
    null,
  );
  assert.equal(
    parseAssistantRecentConversation([
      { role: "user", content: "A", structuredBlock: {} },
    ]),
    null,
  );
});

test("enforces the 6000 character budget and rejects tokens or UUIDs", () => {
  const oversized = Array.from({ length: 6 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(1001),
  }));

  assert.equal(parseAssistantRecentConversation(oversized), null);
  assert.equal(
    parseAssistantRecentConversation([
      {
        role: "user",
        content: "Use 123e4567-e89b-42d3-a456-426614174000 como autoridade",
      },
    ]),
    null,
  );
  assert.equal(
    parseAssistantRecentConversation([
      { role: "assistant", content: `eyJ${"a".repeat(90)}` },
    ]),
    null,
  );
});

test("builds memory from safe fallback text only", () => {
  const recent = buildAssistantRecentConversation([
    { role: "user", content: "Quanto tem do 2A?", structuredBlock: { secret: true } },
    { role: "assistant", content: "Saldo consultado.", proposalToken: "secret" },
  ]);

  assert.deepEqual(recent, [
    { role: "user", content: "Quanto tem do 2A?" },
    { role: "assistant", content: "Saldo consultado." },
  ]);
  assert.equal(JSON.stringify(recent).includes("structuredBlock"), false);
  assert.equal(JSON.stringify(recent).includes("proposalToken"), false);
});

test("keeps inventory and supplier order contexts mutually exclusive", () => {
  const inventory = parseAssistantConversationContext({
    topic: "INVENTORY",
    itemQuery: "MBF-025",
    itemReferenceKind: "SERVO_MODEL",
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: "inventory_item_summary",
  });
  assert.equal(inventory?.itemQuery, "MBF-025");
  assert.equal(inventory?.itemReferenceKind, "SERVO_MODEL");

  const order = deriveAssistantConversationContext(inventory, {
    message: "Pedido encontrado",
    contextItemQuery: null,
    contextSupplierOrderId: "123e4567-e89b-42d3-a456-426614174000",
    contextSupplierOrderCatalogCode: null,
    structuredBlock: { kind: "supplier_order_detail" },
  });
  assert.equal(order.topic, "SUPPLIER_ORDER");
  assert.equal(order.itemQuery, null);
  assert.equal(order.itemReferenceKind, null);
  assert.equal(order.supplierOrderId, "123e4567-e89b-42d3-a456-426614174000");

  assert.equal(
    parseAssistantConversationContext({
      ...inventory,
      supplierOrderId: "123e4567-e89b-42d3-a456-426614174000",
    }),
    null,
  );
});

test("strictly validates the item reference discriminator", () => {
  const base = {
    topic: "INVENTORY",
    itemQuery: "2A",
    itemReferenceKind: "CATALOG_CODE",
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: "inventory_item_summary",
  };

  assert.equal(parseAssistantConversationContext(base)?.itemReferenceKind, "CATALOG_CODE");
  assert.equal(
    parseAssistantConversationContext({ ...base, itemReferenceKind: "UUID" }),
    null,
  );
  assert.equal(
    parseAssistantConversationContext({ ...base, itemReferenceKind: null }),
    null,
  );
  assert.equal(
    parseAssistantConversationContext({ ...base, itemQuery: null }),
    null,
  );
});

test("A-B: explicit MBF quantity queries route directly as servo models", async () => {
  const routing = await routingModule;

  for (const phrase of [
    "Quanto tem do MBF-025?",
    "Quanto tem do MBF025?",
    "Quanto tem do MBF 025?",
  ]) {
    assert.equal(routing.hasClearInventoryQueryIntent(phrase), true, phrase);
    assert.equal(
      normalizeServoModel(extractServoModelCandidate(phrase) ?? ""),
      "MBF025",
      phrase,
    );
  }
});

test("C-E: explicit code quantities bypass clarification while a bare code remains ambiguous", async () => {
  const routing = await routingModule;

  for (const [phrase, code] of [
    ["Quanto tem do 2A?", "2A"],
    ["Quanto tem do 6F?", "6F"],
    ["Quanto tem do 091?", "091"],
  ]) {
    assert.equal(routing.hasClearInventoryQueryIntent(phrase), true, phrase);
    assert.deepEqual(routing.routeInventoryItemSummaryQuestion(phrase, null), {
      queryCode: code,
      metric: "STOCK",
    });
  }

  assert.equal(routing.hasClearInventoryQueryIntent("2A"), false);
  assert.deepEqual(routing.routeAssistantClarification("2A", false), {
    kind: "CATALOG_CODE",
    code: "2A",
  });
  assert.deepEqual(routing.routeAssistantClarification("Me fale sobre 2A", false), {
    kind: "CATALOG_CODE",
    code: "2A",
  });
});

test("F-G: code follow-ups preserve 2A and select current status or composition", async () => {
  const routing = await routingModule;

  assert.deepEqual(
    routing.routeInventoryItemSummaryQuestion("tem pouco dele?", "2A"),
    { queryCode: "2A", metric: "STATUS" },
  );
  assert.deepEqual(
    routing.routeInventoryItemSummaryQuestion("E qual kit ele usa?", "2A"),
    { queryCode: "2A", metric: "COMPOSITION" },
  );

  const assistantData = await read("lib/assistant-data.ts");
  assert.match(assistantData, /installationKitCode:\s*configuration\.installation_kit\.code/);
  assert.match(assistantData, /minimum_stock > 0\s*\? item\.minimum_stock\s*:\s*null/);
});

test("H-I: model and catalog-code contexts remain distinct and the latest reference wins", async () => {
  const routing = await routingModule;
  const modelContext = parseAssistantConversationContext({
    topic: "INVENTORY",
    itemQuery: "MBF-025",
    itemReferenceKind: "SERVO_MODEL",
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: "servo_model_inventory_breakdown",
  });
  assert.ok(modelContext);
  assert.equal(routing.isItemFollowUpMessage("Quais caixas?"), true);

  const codeContext = deriveAssistantConversationContext(modelContext, {
    message: "Saldo consultado.",
    contextItemQuery: "2A",
    contextItemReferenceKind: "CATALOG_CODE",
    contextSupplierOrderId: null,
    contextSupplierOrderCatalogCode: null,
    structuredBlock: { kind: "inventory_item_summary" },
  });
  assert.equal(codeContext.itemQuery, "2A");
  assert.equal(codeContext.itemReferenceKind, "CATALOG_CODE");
  assert.deepEqual(
    routing.routeInventoryItemSummaryQuestion("E qual kit ele usa?", codeContext.itemQuery),
    { queryCode: "2A", metric: "COMPOSITION" },
  );
});

test("J-K: explicit supplier-order phrases are never claimed by direct inventory routing", async () => {
  const routing = await routingModule;
  const supplierRouting = await supplierOrderRoutingModule;

  for (const phrase of [
    "Tenho 2A nos Pedidos?",
    "Tenho MBF-025 nos Pedidos?",
    "Mostre os Pedidos com 6F",
  ]) {
    assert.equal(routing.hasClearInventoryQueryIntent(phrase), false, phrase);
    assert.equal(supplierRouting.routeSupplierOrderQuestion(phrase, null).kind, "ORDER_QUERY", phrase);
  }
});

test("direct inventory routing runs before generic catalog clarification", async () => {
  const source = await read("lib/ai/assistant.ts");
  assert.ok(
    source.indexOf("if (hasClearInventoryQueryIntent(message))") <
      source.indexOf("const clarificationRoute = routeAssistantClarification"),
  );
  assert.match(source, /itemReferenceKind === "SERVO_MODEL"/);
  assert.match(source, /itemReferenceKind === "CATALOG_CODE"/);
});

test("progressive servo-model questions distinguish totals, kit state, breakdown and physical boxes", async () => {
  const routing = await routingModule;

  for (const phrase of [
    "Quanto tem do MBF-025?",
    "Quanto tem do MBF025?",
    "Qual o estoque do MBF 025?",
    "Quanto tem do MBF-025 no total?",
  ]) {
    assert.equal(routing.routeServoModelInventoryView(phrase), "TOTAL", phrase);
  }

  for (const phrase of [
    "Quanto tem do MBF-025 com kit?",
    "E com kit?",
    "Quantos com kit?",
    "Quantos estão montados com kit?",
  ]) {
    assert.equal(routing.routeServoModelInventoryView(phrase), "MOUNTED", phrase);
  }

  for (const phrase of [
    "Quanto tem do MBF-025 sem kit?",
    "E sem kit?",
    "Quantos sem kit?",
    "Quantos estão separados?",
  ]) {
    assert.equal(routing.routeServoModelInventoryView(phrase), "LOOSE", phrase);
  }

  for (const phrase of [
    "Quais configurações?",
    "Quais códigos com kit?",
    "Em quais configurações ele está?",
    "Mostre as configurações com esse servo",
  ]) {
    assert.equal(routing.routeServoModelInventoryView(phrase), "BREAKDOWN", phrase);
  }

  for (const phrase of [
    "E dentro de caixas?",
    "Quanto tem do MBF-025 dentro de caixas?",
    "Quais caixas?",
  ]) {
    assert.equal(routing.routeServoModelInventoryView(phrase), "BOX_AMBIGUOUS", phrase);
  }

  for (const phrase of [
    "E com kit?",
    "Quantos com kit?",
    "E sem kit?",
    "Quantos estão separados?",
    "Quais configurações?",
    "E nas caixas?",
  ]) {
    assert.equal(routing.isItemFollowUpMessage(phrase), true, phrase);
    assert.equal(routing.isServoModelInventoryFollowUp(phrase), true, phrase);
  }

  assert.equal(routing.isServoModelInventoryFollowUp("E qual é o mínimo?"), false);
});

test("progressive model answers retain SERVO_MODEL context and use official physical totals", async () => {
  const assistant = await read("lib/ai/assistant.ts");
  const data = await read("lib/assistant-data.ts");

  assert.match(assistant, /block\.mountedQuantity/);
  assert.match(assistant, /block\.looseQuantity/);
  assert.match(assistant, /block\.totalQuantity/);
  assert.match(assistant, /contextItemReferenceKind:\s*"SERVO_MODEL"/);
  assert.match(assistant, /embalagens físicas/);
  assert.match(data, /mountedQuantity = matchingServos\[0\]\.mounted_quantity/);
  assert.match(data, /totalQuantity = matchingServos\[0\]\.total_quantity/);
  assert.match(data, /totalQuantity !== looseQuantity \+ mountedQuantity/);
});

test("a catalog-code context is not reinterpreted as a servo-model kit state", async () => {
  const routing = await routingModule;
  const codeContext = parseAssistantConversationContext({
    topic: "INVENTORY",
    itemQuery: "2A",
    itemReferenceKind: "CATALOG_CODE",
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: "inventory_item_summary",
  });

  assert.ok(codeContext);
  assert.equal(codeContext.itemReferenceKind, "CATALOG_CODE");
  assert.equal(routing.routeInventoryItemSummaryQuestion("E sem kit?", "2A"), null);
  const assistant = await read("lib/ai/assistant.ts");
  assert.match(assistant, /Esse contexto é de um código específico/);
});

test("wraps read cards with short copy and at most one suggestion", () => {
  const answer = addAssistantConversationalCopy({
    message: "fallback seguro",
    structuredBlock: {
      kind: "inventory_item_summary",
      metric: "STOCK",
    },
  });

  assert.equal(typeof answer.leadText, "string");
  assert.equal(typeof answer.followUpText, "string");
  assert.equal((answer.followUpText.match(/Se quiser/g) ?? []).length, 1);
  assert.doesNotMatch(answer.followUpText, /Posso ajudar em mais alguma coisa/i);
});

test("session v2 persists conversational copy and structured context", async () => {
  const source = await read("lib/assistant-session.ts");
  assert.match(source, /assistantSessionVersion = 2/);
  assert.match(source, /leadText/);
  assert.match(source, /followUpText/);
  assert.match(source, /conversationContext/);
  assert.doesNotMatch(source, /lastItemQuery:/);
});

test("renders one assistant response in text, card, text order", async () => {
  const source = await read("components/assistant-home.tsx");
  const lead = source.indexOf("chatMessage.leadText");
  const card = source.indexOf("<AssistantStructuredBlockView", lead);
  const follow = source.indexOf("chatMessage.followUpText", card);
  assert.ok(lead >= 0 && card > lead && follow > card);
});

test("new conversation resets messages and the entire structured context", async () => {
  const source = await read("components/assistant-conversation-provider.tsx");
  const reset = source.slice(
    source.indexOf("const resetConversation"),
    source.indexOf("useEffect(() =>", source.indexOf("const resetConversation")),
  );
  assert.match(reset, /setMessages\(\[\]\)/);
  assert.match(reset, /setConversationContext\(emptyAssistantConversationContext\(\)\)/);
});

test("contextual follow-ups are deterministic and text confirmation stays non-operational", async () => {
  const routing = await read("lib/ai/assistant-routing.ts");
  const assistant = await read("lib/ai/assistant.ts");
  assert.match(routing, /dentro\\s\+de/);
  assert.match(routing, /tem\|esta/);
  assert.match(assistant, /Use o botão Confirmar retirada/);
  assert.match(assistant, /Use o botão Confirmar entrada/);
  assert.match(assistant, /Use o botão Confirmar saída/);
});

test("empty context is deterministic", () => {
  assert.deepEqual(emptyAssistantConversationContext(), {
    topic: "GENERAL",
    itemQuery: null,
    itemReferenceKind: null,
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: null,
  });
});
