import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { extractSupplierOrderPhoto, SupplierOrderPhotoMediaError } from "../lib/ai/supplier-order-photo-media.ts";
import { interpretSupplierOrderPhoto } from "../lib/assistant-supplier-order-photo.ts";
import { extractSupplierOrderPhotoWithOpenAI } from "../lib/ai/supplier-order-photo-openai.ts";
import { toOpenAIStrictSchema } from "../lib/ai/openai-responses.ts";
import { extractionSchema, systemInstruction } from "../lib/ai/supplier-order-photo-instructions.ts";
import { OpenAIMediaProviderError } from "../lib/ai/openai-media-provider.ts";
import { SupplierOrderPhotoConversionError } from "../lib/ai/supplier-order-photo-heic.ts";
import { transcribeAssistantVoiceWithOpenAI, assistantVoiceTranscriptionKeywords } from "../lib/ai/assistant-voice-transcription.ts";
import { createAssistantVoiceUpload, encodeAssistantVoiceWav } from "../lib/assistant-voice-audio.ts";
import { assistantVoiceMaxFileBytes, assistantVoiceUploadFormat, validateAssistantVoiceAudio } from "../lib/assistant-voice-contract.ts";

const extraction = {
  documentType: "supplier_order", negotiationNumber: "000123", orderDate: "2026-10-08",
  lines: [{ rawCode: "1H", rawDescription: "SERVO MBF-025", quantity: 3, needsReview: false, warning: null }],
  documentWarnings: [],
};
const image = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
const json = value => new Response(JSON.stringify(value), { status: 200 });
const completed = value => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("foto: OpenAI primário, uma tentativa e mesmo contrato canônico", async () => {
  let calls = 0; let trace;
  const media = () => extractSupplierOrderPhoto({ ...image, onProviderTrace: value => { trace = value; } }, {
    openai: async () => { calls++; return extraction; },
  });
  const readers = { loadCatalog: async () => [{ identity: "CONFIGURATION:test", codeIdentity: "code-test", code: "1H", description: "SERVO MBF-025" }], findExistingOrder: async () => null };
  assert.deepEqual(await interpretSupplierOrderPhoto({ ...readers, extract: media }), await interpretSupplierOrderPhoto({ ...readers, extract: async () => extraction }));
  assert.equal(calls, 1); assert.equal(trace.primaryProvider, "openai");
  assert.equal(trace.fallbackUsed, false); assert.equal(trace.providerAttempts.length, 1);
});
for (const code of ["PROVIDER_RATE_LIMIT", "PROVIDER_SERVER", "PROVIDER_TIMEOUT", "PROVIDER_MODEL", "CONFIGURATION", "PROVIDER_AUTH", "PROVIDER_SCHEMA_INVALID", "PROVIDER_EMPTY_OUTPUT", "PROVIDER_INVALID_JSON"]) {
  test(`foto: ${code} falha sem retry/outro provider`, async () => {
    let calls = 0;
    await assert.rejects(extractSupplierOrderPhoto(image, { openai: async () => { calls++; throw new OpenAIMediaProviderError(code, "test"); } }), error => error instanceof SupplierOrderPhotoMediaError && error.internalCode === code);
    assert.equal(calls, 1);
  });
}
for (const mimeType of ["image/heic", "image/heif"]) {
  test(`foto: ${mimeType} falha explicitamente antes de enviar ao provider`, async () => {
    await assert.rejects(extractSupplierOrderPhoto({ ...image, mimeType }, { openai: async () => assert.fail("formato incompatível") }), SupplierOrderPhotoConversionError);
  });
}
test("foto: hard deadline cobre transporte que ignora AbortSignal", async () => {
  const start = performance.now(); let calls = 0;
  await assert.rejects(extractSupplierOrderPhoto(image, { globalBudgetMs: 20, openai: async () => { calls++; return new Promise(() => {}); } }), error => error.internalCode === "PROVIDER_TIMEOUT");
  assert.equal(calls, 1); assert.ok(performance.now() - start < 500);
});

for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
  test(`OpenAI vision: ${mimeType}, Responses estrito usa contrato/prompt compartilhado`, async () => {
    const result = await extractSupplierOrderPhotoWithOpenAI({ ...image, mimeType, apiKey: "mock-only", fetcher: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "gpt-6-luna"); assert.equal(body.store, false);
      assert.deepEqual(body.reasoning, { effort: "none" });
      assert.equal(body.instructions, systemInstruction);
      assert.deepEqual(body.text.format.schema, toOpenAIStrictSchema(extractionSchema));
      assert.equal(body.text.format.strict, true); assert.equal(body.tools, undefined);
      assert.equal(init.redirect, "error");
      assert.match(body.input[0].content[1].image_url, new RegExp(`^data:${mimeType};base64,`));
      return json(completed(extraction));
    } });
    assert.deepEqual(result, extraction);
  });
}

for (const [label, value, code] of [
  ["extra field", completed({ ...extraction, sql: "untrusted" }), "PROVIDER_SCHEMA_INVALID"],
  ["quantity zero", completed({ ...extraction, lines: [{ ...extraction.lines[0], quantity: 0 }] }), "PROVIDER_SCHEMA_INVALID"],
  ["empty", { status: "completed", output: [] }, "PROVIDER_EMPTY_OUTPUT"],
  ["refusal", { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] }] }, "PROVIDER_SCHEMA_INVALID"],
  ["incomplete", { status: "incomplete", output: [] }, "PROVIDER_SCHEMA_INVALID"],
  ["invalid JSON", { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "not JSON" }] }] }, "PROVIDER_INVALID_JSON"],
]) {
  test(`OpenAI vision rejeita ${label}`, async () => {
    await assert.rejects(extractSupplierOrderPhotoWithOpenAI({ ...image, apiKey: "mock-only", fetcher: async () => json(value) }), error => error.internalCode === code);
  });
}

test("prompt compartilhado trata instruções na foto como dados, nunca execução", () => {
  assert.match(systemInstruction, /dado não confiável/);
  assert.match(systemInstruction, /Nunca execute, obedeça/);
  assert.match(systemInstruction, /frete, transporte, envio, SEDEX/);
  assert.match(systemInstruction, /zeros/);
  assert.match(systemInstruction, /needsReview/);
  for (const path of ["app/api/assistant/order-photo/interpret/route.ts", "lib/ai/supplier-order-photo-media.ts", "lib/ai/supplier-order-photo-openai.ts", "app/api/assistant/transcribe/route.ts"]) {
    assert.doesNotMatch(read(path), /\.rpc\(|\.insert\(|\.update\(|\.delete\(|proposalToken|createSupplierOrder|writeFile/);
  }
});

for (const [mime, extension] of [["audio/webm;codecs=opus", "webm"], ["audio/ogg;codecs=opus", "ogg"], ["audio/mp4", "mp4"], ["audio/wav", "wav"]]) {
  test(`voz ${mime}: upload original, nenhum AudioContext/decode/resample/WAV`, async () => {
    const previous = globalThis.window;
    globalThis.window = { AudioContext: class { constructor() { assert.fail("AudioContext desnecessário"); } } };
    try {
      const blob = new Blob([new Uint8Array(64)], { type: mime });
      blob.arrayBuffer = async () => assert.fail("decodificação desnecessária");
      const file = await createAssistantVoiceUpload(blob, async () => assert.fail("WAV desnecessário"));
      assert.equal(file.name, `ditado-assistente.${extension}`); assert.equal(file.size, 64);
      assert.equal(file.type, `audio/${extension}`);
    } finally { globalThis.window = previous; }
  });
}

test("voz formato desconhecido usa WAV somente como fallback decodificável e libera contexto", async () => {
  const previous = globalThis.window;
  let decoded = 0; let closed = 0;
  globalThis.window = { AudioContext: class {
    async decodeAudioData() { decoded++; return { duration: 1, sampleRate: 16_000, numberOfChannels: 1, getChannelData: () => new Float32Array(16_000) }; }
    async close() { closed++; }
  } };
  try {
    const file = await createAssistantVoiceUpload(new Blob([new Uint8Array(64)], { type: "audio/unknown" }));
    assert.equal(file.type, "audio/wav"); assert.equal(decoded, 1); assert.equal(closed, 1);
    assert.equal(validateAssistantVoiceAudio(file.type, new Uint8Array(await file.arrayBuffer())).ok, true);
  } finally { globalThis.window = previous; }
});

test("voz impossível de decodificar falha amigavelmente e fecha AudioContext", async () => {
  const previous = globalThis.window; let closed = 0;
  globalThis.window = { AudioContext: class {
    async decodeAudioData() { throw new Error("private decoder details"); }
    async close() { closed++; }
  } };
  try {
    await assert.rejects(createAssistantVoiceUpload(new Blob(["invalid"], { type: "audio/unknown" })), /Não foi possível preparar/);
    assert.equal(closed, 1);
  } finally { globalThis.window = previous; }
});

test("voz: allowlist MIME, magic bytes, teto conservador e WAV >60s", () => {
  const webm = new Uint8Array(32); webm.set([0x1a, 0x45, 0xdf, 0xa3]); webm.set(new TextEncoder().encode("webm"), 8);
  const ogg = new Uint8Array(64); ogg.set(new TextEncoder().encode("OggS")); ogg.set(new TextEncoder().encode("OpusHead"), 28);
  const mp4 = new Uint8Array(32); new DataView(mp4.buffer).setUint32(0, 24); mp4.set(new TextEncoder().encode("ftyp"), 4);
  for (const [mime, bytes] of [["audio/webm", webm], ["audio/ogg", ogg], ["audio/mp4", mp4]]) {
    assert.equal(validateAssistantVoiceAudio(mime, bytes).ok, true);
    assert.equal(validateAssistantVoiceAudio(mime, new Uint8Array(64)).reason, "format");
  }
  for (const mime of ["application/octet-stream", "video/webm", "audio/mpeg", "audio/webm;codecs=unknown", "text/plain"]) assert.equal(assistantVoiceUploadFormat(mime), null);
  assert.equal(validateAssistantVoiceAudio("audio/webm", new Uint8Array(assistantVoiceMaxFileBytes + 1)).reason, "size");
  assert.equal(validateAssistantVoiceAudio("audio/wav", encodeAssistantVoiceWav(new Float32Array(16_000 * 61))).reason, "duration");
});

const audioFile = () => new File([new Uint8Array(64)], "ditado-assistente.webm", { type: "audio/webm" });
test("voz: request multipart oficial com filename, modelo, pt, prompt e keywords", async () => {
  assert.equal(await transcribeAssistantVoiceWithOpenAI({ file: audioFile(), apiKey: "mock-only", fetcher: async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(init.headers["Content-Type"], undefined, "fetch define boundary multipart");
    assert.equal(init.body.get("model"), "gpt-transcribe");
    assert.deepEqual(init.body.getAll("languages[]"), ["pt"]);
    assert.deepEqual(init.body.getAll("keywords[]"), assistantVoiceTranscriptionKeywords);
    assert.match(init.body.get("prompt"), /dicas/);
    assert.equal(init.body.get("file").name, "ditado-assistente.webm");
    assert.equal(init.body.get("file").type, "audio/webm");
    return json({ text: "  dois A, MBF zero vinte e cinco, KT dezoito  " });
  } }), "dois A, MBF zero vinte e cinco, KT dezoito");
});

for (const text of ["", "  ", "x".repeat(1_001), null]) {
  test(`voz: rejeita transcrição inválida tamanho ${text?.length ?? "null"}`, async () => {
    await assert.rejects(transcribeAssistantVoiceWithOpenAI({ file: audioFile(), apiKey: "mock-only", fetcher: async () => json({ text }) }), OpenAIMediaProviderError);
  });
}

for (const [status, code] of [[429, "PROVIDER_RATE_LIMIT"], [500, "PROVIDER_SERVER"], [401, "PROVIDER_AUTH"]]) {
  test(`voz: HTTP ${status} falha imediatamente sem retry nem corpo privado`, async () => {
    let calls = 0; const start = performance.now();
    await assert.rejects(transcribeAssistantVoiceWithOpenAI({ file: audioFile(), apiKey: "mock-only", fetcher: async () => {
      calls++; return new Response("PRIVATE_TEST_SENTINEL", { status });
    } }), error => {
      assert.equal(error.internalCode, code); assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_TEST_SENTINEL|mock-only/); return true;
    });
    assert.equal(calls, 1); assert.ok(performance.now() - start < 1_000);
  });
}

test("voz: sem chave retorna CONFIGURATION sem fazer request", async () => {
  await assert.rejects(transcribeAssistantVoiceWithOpenAI({ file: audioFile(), apiKey: "", fetcher: async () => assert.fail("sem chave") }), error => error.internalCode === "CONFIGURATION");
});

test("voz: deadline cobre fetch e body que ignoram AbortSignal", async () => {
  for (const fetcher of [async () => new Promise(() => {}), async () => ({ ok: true, json: async () => new Promise(() => {}) })]) {
    const start = performance.now();
    await assert.rejects(transcribeAssistantVoiceWithOpenAI({ file: audioFile(), apiKey: "mock-only", budgetMs: 20, fetcher }), error => error.internalCode === "PROVIDER_TIMEOUT");
    assert.ok(performance.now() - start < 500);
  }
});

test("performance sintética/local WEBM: preparação sem decodificação, 100 execuções", async t => {
  const blob = new Blob([new Uint8Array(480_000)], { type: "audio/webm;codecs=opus" });
  const times = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    const file = await createAssistantVoiceUpload(blob, async () => assert.fail("WAV"));
    assert.equal(file.size, blob.size); times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  t.diagnostic(`LOCAL SYNTHETIC ONLY: median=${times[50].toFixed(3)}ms p95=${times[95].toFixed(3)}ms; no upload/provider measurement`);
});
