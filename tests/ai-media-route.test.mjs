import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/assistant/transcribe/route.ts";
import { assistantVoiceMaxFileBytes } from "../lib/assistant-voice-contract.ts";
import { resetAssistantVoiceRateLimitForTests } from "../lib/assistant-voice-rate-limit.ts";

let user = "media-test-user"; let active = true; let providerCalls = 0;
const logs = [];
const originalFetch = globalThis.fetch;
const originalInfo = console.info; const originalWarn = console.warn;
const originalKey = process.env.OPENAI_API_KEY;
test.before(() => {
  globalThis.__mediaTestSupabase = {
    auth: { getClaims: async () => ({ data: { claims: { sub: user } } }) },
    from: table => {
      assert.equal(table, "profiles");
      const query = {
        select: value => { assert.equal(value, "id"); return query; },
        eq: (field, value) => { if (field === "is_active") assert.equal(value, true); return query; },
        maybeSingle: async () => ({ data: active ? { id: user } : null }),
      };
      return query;
    },
  };
  console.info = (...values) => logs.push(values); console.warn = (...values) => logs.push(values);
});
test.beforeEach(() => {
  user = "media-test-user"; active = true; providerCalls = 0; logs.length = 0;
  resetAssistantVoiceRateLimitForTests();
  process.env.OPENAI_API_KEY = "mock-route-only";
  globalThis.fetch = async (url, init) => {
    providerCalls++; assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(init.body.get("file").name, "ditado-assistente.webm");
    return Response.json({ text: " PRIVATE_TRANSCRIPT_SENTINEL " });
  };
});
test.after(() => {
  globalThis.fetch = originalFetch; console.info = originalInfo; console.warn = originalWarn;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  delete globalThis.__mediaTestSupabase;
});

function request({ mime = "audio/webm;codecs=opus", bytes, origin = "https://nk.test", extra = false } = {}) {
  const audio = bytes ?? new Uint8Array(64);
  if (!bytes) { audio.set([0x1a, 0x45, 0xdf, 0xa3]); audio.set(new TextEncoder().encode("webm"), 8); }
  const body = new FormData(); body.append("audio", new File([audio], "private-name.webm", { type: mime }));
  if (extra) body.append("operation", "forbidden");
  return new Request("https://nk.test/api/assistant/transcribe", { method: "POST", body, headers: { origin, "sec-fetch-site": "same-origin" } });
}

test("rota: áudio comprimido autenticado retorna somente transcript e timing numérico", async () => {
  const response = await POST(request());
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { transcript: "PRIVATE_TRANSCRIPT_SENTINEL" });
  assert.equal(providerCalls, 1); assert.match(response.headers.get("server-timing"), /auth;dur=\d/);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_TRANSCRIPT_SENTINEL|mock-route-only|private-name|Authorization/);
});
test("rota: sessão ausente falha antes de ler áudio/provider", async () => {
  user = null; assert.equal((await POST(request())).status, 401); assert.equal(providerCalls, 0);
});
test("rota: perfil inativo falha fechado", async () => {
  active = false; assert.equal((await POST(request())).status, 403); assert.equal(providerCalls, 0);
});
test("rota: origem externa falha antes de provider", async () => {
  assert.equal((await POST(request({ origin: "https://external.test" }))).status, 403); assert.equal(providerCalls, 0);
});
test("rota: chave ausente é CONFIGURATION seguro 503 sem segredo/provider na resposta", async () => {
  delete process.env.OPENAI_API_KEY;
  const response = await POST(request());
  assert.equal(response.status, 503);
  const body = await response.json(); assert.match(body.error, /Não foi possível transcrever agora/);
  assert.doesNotMatch(body.error, /OpenAI|Gemini|API|provider|model|quota|429/i);
  assert.equal(logs[0][1].internalCode, "CONFIGURATION"); assert.equal(providerCalls, 0);
});
test("rota: multipart não aceita payload operacional extra", async () => {
  assert.equal((await POST(request({ extra: true }))).status, 400); assert.equal(providerCalls, 0);
});
for (const mime of ["audio/mpeg", "video/webm", "application/octet-stream", "audio/webm;codecs=wrong"]) {
  test(`rota: rejeita MIME ${mime}`, async () => {
    assert.equal((await POST(request({ mime }))).status, 415); assert.equal(providerCalls, 0);
  });
}
test("rota: magic bytes incompatíveis não chegam ao provider", async () => {
  assert.equal((await POST(request({ bytes: new Uint8Array(64) }))).status, 415); assert.equal(providerCalls, 0);
});
for (const contentLength of [null, "1"]) {
  test(`rota: teto real de streaming não confia em Content-Length ${contentLength}`, async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(assistantVoiceMaxFileBytes + 65_537)); }, cancel() { cancelled = true; } });
    const headers = { origin: "https://nk.test", "content-type": "multipart/form-data; boundary=test" };
    if (contentLength) headers["content-length"] = contentLength;
    const response = await POST(new Request("https://nk.test/api/assistant/transcribe", { method: "POST", body: stream, duplex: "half", headers }));
    assert.equal(response.status, 413); assert.equal(cancelled, true); assert.equal(providerCalls, 0);
  });
}
test("rota: rate-limit por usuário é preservado", async () => {
  for (let i = 0; i < 8; i++) assert.equal((await POST(request())).status, 200);
  assert.equal((await POST(request())).status, 429); assert.equal(providerCalls, 8);
});
test("rota: erro 429 externo não expõe conteúdo bruto e não tenta novamente", async () => {
  globalThis.fetch = async () => { providerCalls++; return new Response("PRIVATE_PROVIDER_SENTINEL", { status: 429 }); };
  const response = await POST(request());
  assert.equal(response.status, 502); assert.equal(providerCalls, 1);
  assert.doesNotMatch(JSON.stringify(await response.json()) + JSON.stringify(logs), /PRIVATE_PROVIDER_SENTINEL|mock-route-only/);
});
