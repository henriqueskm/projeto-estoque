import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { requestAssistantResponse, readOpenAIResponseText, toOpenAIStrictSchema, resolveAssistantModel } from "../lib/ai/openai-responses.ts";
import { semanticRouterSchema, parseAssistantSemanticResult } from "../lib/ai/assistant-semantic-router.ts";
import { resolveSupplierOrderPhotoModel } from "../lib/ai/supplier-order-photo-openai.ts";

const response = text => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] });
const input = { model: "gpt-6-luna", instructions: "Synthetic instruction", input: "Synthetic message", maxOutputTokens: 300, budgetMs: 100, apiKey: "mock-only" };

test("text REST body is bounded, server-only, store false, reasoning none and no tools", async () => {
  let calls = 0;
  const text = await requestAssistantResponse({ ...input, fetcher: async (url, options) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.method, "POST"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { model: input.model, instructions: input.instructions,
      store: false, reasoning: { effort: "none" }, max_output_tokens: 300,
      input: [{ role: "user", content: [{ type: "input_text", text: input.input }] }] });
    return Response.json({ ...response("Olá!"), usage: { input_tokens: 10, output_tokens: 4 } });
  } });
  assert.equal(text, "Olá!"); assert.equal(calls, 1);
});

test("REST collects message outputs, not SDK output_text or first output reasoning", () => {
  assert.equal(readOpenAIResponseText({ status: "completed", output: [{ type: "reasoning" }, ...response("Parte um.").output, ...response(" Parte dois.").output] }, input.model), "Parte um. Parte dois.");
  assert.throws(() => readOpenAIResponseText({ status: "completed", output_text: "SDK only" }, input.model));
});
for (const [label, data, code] of [
  ["empty", response(" "), "PROVIDER_EMPTY_OUTPUT"],
  ["refusal", { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] }] }, "PROVIDER_SCHEMA_INVALID"],
  ["incomplete", { ...response("partial"), status: "incomplete" }, "PROVIDER_SCHEMA_INVALID"],
  ["failed", { ...response("partial"), status: "failed" }, "PROVIDER_SCHEMA_INVALID"],
  ["unknown content", { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "input_text", text: "wrong" }] }] }, "PROVIDER_SCHEMA_INVALID"],
  ["unexpected tool", { status: "completed", output: [{ type: "function_call", name: "not_allowed" }, ...response("wrong").output] }, "PROVIDER_SCHEMA_INVALID"],
]) {
  test(`text rejects ${label}`, async () => {
    await assert.rejects(requestAssistantResponse({ ...input, fetcher: async () => Response.json(data) }), error => error.internalCode === code);
  });
}
for (const [status, code] of [[400, "PROVIDER_HTTP_400"], [401, "PROVIDER_AUTH"], [403, "PROVIDER_AUTH"], [404, "PROVIDER_MODEL"], [429, "PROVIDER_RATE_LIMIT"], [500, "PROVIDER_SERVER"], [503, "PROVIDER_SERVER"]]) {
  test(`HTTP ${status}: safe classification, single call/no retry/no provider body`, async () => {
    let calls = 0;
    await assert.rejects(requestAssistantResponse({ ...input, fetcher: async () => { calls++; return new Response("PRIVATE_SENTINEL", { status }); } }), error => error.internalCode === code && !JSON.stringify(error).includes("PRIVATE_SENTINEL"));
    assert.equal(calls, 1);
  });
}
test("deadline covers pending fetch and pending body even if AbortSignal is ignored", async () => {
  for (const fetcher of [async () => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    const start = performance.now();
    await assert.rejects(requestAssistantResponse({ ...input, budgetMs: 10, fetcher }), error => error.internalCode === "PROVIDER_TIMEOUT");
    assert.ok(performance.now() - start < 500);
  }
});
test("configuration absence never calls transport", async () => {
  await assert.rejects(requestAssistantResponse({ ...input, apiKey: "", fetcher: async () => assert.fail("unexpected request") }), error => error.internalCode === "CONFIGURATION");
});
test("safe telemetry excludes input/prompt/keys/provider payload", async () => {
  const previous = { info: console.info, warn: console.warn }; const logs = [];
  console.info = console.warn = (...args) => logs.push(args);
  try {
    await requestAssistantResponse({ ...input, input: "PRIVATE_SENTINEL", instructions: "PRIVATE_SENTINEL", fetcher: async () => Response.json(response("PRIVATE_SENTINEL")) });
    await assert.rejects(requestAssistantResponse({ ...input, fetcher: async () => { throw Error("PRIVATE_SENTINEL"); } }));
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_SENTINEL|mock-only|Authorization|Bearer/);
  } finally { Object.assign(console, previous); }
});
test("router root object envelope, required keys and documented nested anyOf subset", () => {
  const schema = toOpenAIStrictSchema(semanticRouterSchema);
  assert.equal(schema.type, "object"); assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["result"]); assert.equal(schema.anyOf, undefined);
  assert.ok(schema.properties.result.anyOf.length > 5);
  function visit(node) {
    if (!node || typeof node !== "object") return;
    assert.equal(node.oneOf, undefined); assert.equal(node.uniqueItems, undefined);
    assert.equal(node.minLength, undefined); assert.equal(node.maxLength, undefined);
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(visit); else visit(value); }
  }
  visit(schema);
  assert.equal(parseAssistantSemanticResult({ intent: "HELP", capabilityIds: ["MANUAL_STOCK_OUTPUT", "MANUAL_STOCK_OUTPUT"] }), null);
  assert.equal(parseAssistantSemanticResult({ intent: "ACTION", action: { kind: "MANUAL_STOCK_OUTPUT", lines: Array(13).fill({ quantity: 1, targetQuery: "1H", requestedIdentity: null }) } }), null);
});
test("photo env precedence is new model > compatible fallback override > default; no mandatory new env", () => {
  const old = { model: process.env.OPENAI_PHOTO_MODEL, fallback: process.env.OPENAI_PHOTO_FALLBACK_MODEL, text: process.env.OPENAI_ASSISTANT_MODEL };
  try {
    delete process.env.OPENAI_PHOTO_MODEL; delete process.env.OPENAI_PHOTO_FALLBACK_MODEL; delete process.env.OPENAI_ASSISTANT_MODEL;
    assert.equal(resolveSupplierOrderPhotoModel(), "gpt-6-luna"); assert.equal(resolveAssistantModel(), "gpt-6-luna");
    process.env.OPENAI_PHOTO_FALLBACK_MODEL = "compatible-model"; assert.equal(resolveSupplierOrderPhotoModel(), "compatible-model");
    process.env.OPENAI_PHOTO_MODEL = "photo-model"; assert.equal(resolveSupplierOrderPhotoModel(), "photo-model");
  } finally {
    for (const [name, value] of [["OPENAI_PHOTO_MODEL", old.model], ["OPENAI_PHOTO_FALLBACK_MODEL", old.fallback], ["OPENAI_ASSISTANT_MODEL", old.text]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
test("runtime text/router/photo/eval have no Gemini SDK/config dependency or operational writer", () => {
  for (const path of ["lib/ai/openai-responses.ts", "lib/ai/assistant-semantic-router.ts", "lib/ai/supplier-order-photo-media.ts", "lib/ai/supplier-order-photo-openai.ts", "evals/assistant/run-live.ts"]) {
    const source = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /GEMINI_|GoogleGenAI|@google\/genai|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  }
  assert.doesNotMatch(readFileSync(new URL("../package.json", import.meta.url), "utf8"), /@google\/genai/);
});
