import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/assistant/order-photo/interpret/route.ts";

const originalFetch = globalThis.fetch;
const originalInfo = console.info; const originalWarn = console.warn;
const previousKeys = { openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY };
let calls = 0; let user = "media-test-user"; let active = true; let lookupFails = false;
const logs = [];
test.before(() => {
  console.info = (...values) => logs.push(values); console.warn = (...values) => logs.push(values);
  globalThis.__mediaTestSupabase = {
    auth: { getClaims: async () => ({ data: { claims: { sub: user } } }) },
    from: table => {
      assert.ok(["profiles", "supplier_order_summaries"].includes(table));
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: active ? { id: user } : null }),
        limit: async () => ({ data: [], error: lookupFails ? new Error("private lookup") : null }),
      };
      return query;
    },
  };
});
test.beforeEach(() => {
  calls = 0; user = "media-test-user"; active = true; lookupFails = false; logs.length = 0;
  globalThis.__mediaPhotoCatalogFails = false;
  process.env.OPENAI_API_KEY = "mock-only"; delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async url => {
    calls++; assert.equal(url, "https://api.openai.com/v1/responses");
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
      documentType: "supplier_order", negotiationNumber: "000123", orderDate: "2026-10-08",
      lines: [{ rawCode: "1H", rawDescription: "SERVO MBF-025", quantity: 3, needsReview: false, warning: null }], documentWarnings: [],
    }) }] }] });
  };
});
test.after(() => {
  globalThis.fetch = originalFetch; console.info = originalInfo; console.warn = originalWarn;
  for (const [name, value] of [["OPENAI_API_KEY", previousKeys.openai], ["GEMINI_API_KEY", previousKeys.gemini]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  delete globalThis.__mediaTestSupabase; delete globalThis.__mediaPhotoCatalogFails;
});
function request({ invalid = false, origin = "https://nk.test" } = {}) {
  const bytes = new Uint8Array(32); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, 10); new DataView(bytes.buffer).setUint32(20, 10);
  const body = new FormData(); body.append("image", new File([invalid ? new Uint8Array(32) : bytes], "sanitized.png", { type: "image/png" }));
  return new Request("https://nk.test/api/assistant/order-photo/interpret", { method: "POST", body, headers: { origin } });
}
test("foto rota: Gemini não configurado usa OpenAI e retorna preview canônico sem writer", async () => {
  const response = await POST(request());
  assert.equal(response.status, 200); assert.equal(calls, 1);
  const body = await response.json(); assert.equal(body.structuredBlock.totalQuantity, 3);
  assert.equal(body.structuredBlock.negotiationNumber, "000123");
  assert.equal(logs[0][1].finalProvider, "openai");
  assert.doesNotMatch(JSON.stringify(logs), /SERVO MBF-025|000123|mock-only|base64|Authorization/);
});
for (const [label, setup, options, status] of [
  ["sessão", () => { user = null; }, {}, 401],
  ["perfil", () => { active = false; }, {}, 403],
  ["origem", () => {}, { origin: "https://external.test" }, 403],
  ["arquivo", () => {}, { invalid: true }, 415],
]) {
  test(`foto rota: ${label} inválido nunca aciona provider/fallback`, async () => {
    setup(); assert.equal((await POST(request(options))).status, status); assert.equal(calls, 0);
  });
}
for (const stage of ["catalog", "order_lookup"]) {
  test(`foto rota: ${stage} falha sem repetir/fallback visual adicional`, async () => {
    if (stage === "catalog") globalThis.__mediaPhotoCatalogFails = true; else lookupFails = true;
    const response = await POST(request()); assert.equal(response.status, 502); assert.equal(calls, 1);
    assert.equal(logs[0][1].stage, stage);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private|OpenAI|Gemini|API|provider|quota/);
  });
}
