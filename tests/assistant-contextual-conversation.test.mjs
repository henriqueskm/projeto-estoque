import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addAssistantConversationalCopy,
  buildAssistantRecentConversation,
  deriveAssistantConversationContext,
  emptyAssistantConversationContext,
  parseAssistantConversationContext,
  parseAssistantRecentConversation,
} from "../lib/assistant-conversation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: "inventory_item_summary",
  });
  assert.equal(inventory?.itemQuery, "MBF-025");

  const order = deriveAssistantConversationContext(inventory, {
    message: "Pedido encontrado",
    contextItemQuery: null,
    contextSupplierOrderId: "123e4567-e89b-42d3-a456-426614174000",
    contextSupplierOrderCatalogCode: null,
    structuredBlock: { kind: "supplier_order_detail" },
  });
  assert.equal(order.topic, "SUPPLIER_ORDER");
  assert.equal(order.itemQuery, null);
  assert.equal(order.supplierOrderId, "123e4567-e89b-42d3-a456-426614174000");

  assert.equal(
    parseAssistantConversationContext({
      ...inventory,
      supplierOrderId: "123e4567-e89b-42d3-a456-426614174000",
    }),
    null,
  );
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
    supplierOrderId: null,
    supplierOrderCatalogCode: null,
    lastIntent: null,
  });
});
