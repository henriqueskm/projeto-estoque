import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  detectSupplierOrderPhotoMimeType,
  parseAssistantSupplierOrderPhotoPreviewBlock,
  parseSupplierOrderPhotoExtraction,
  readSupplierOrderPhotoDimensions,
  supplierOrderPhotoDimensionsAreSafe,
  validateSupplierOrderPhotoBytes,
} from "../lib/assistant-supplier-order-photo-contract.ts";
import {
  classifySupplierOrderPhotoLineRole,
  interpretSupplierOrderPhoto,
} from "../lib/assistant-supplier-order-photo.ts";
import {
  extractSupplierOrderPhotoWithProvider,
  SupplierOrderPhotoProviderError,
  supplierOrderPhotoInteractionsBudgetMs,
  supplierOrderPhotoProviderTotalBudgetMs,
} from "../lib/ai/supplier-order-photo-gemini.ts";

const validExtraction = {
  documentType: "supplier_order",
  negotiationNumber: "000123",
  orderDate: "2026-08-12",
  lines: [
    { rawCode: "2e", rawDescription: "SERVO MBF-025 + KT-22", quantity: 3, needsReview: false, warning: null },
  ],
  documentWarnings: [],
};

const catalog = [
  { identity: "CONFIGURATION:a", codeIdentity: "code-a", code: "2E", description: "SERVO MBF-025 + KT-22" },
  { identity: "ITEM:b", codeIdentity: "item-b", code: "11", description: "SERVO AL-10 SEM KIT" },
  { identity: "ITEM:r066", codeIdentity: "item-r066", code: "R066", description: "JOGO DE REPARO 066" },
  { identity: "CONFIGURATION:10a", codeIdentity: "code-10a", code: "10A", description: "SERVO MC-040 + KT-48" },
  { identity: "CONFIGURATION:2a", codeIdentity: "code-2a", code: "2A", description: "SERVO MBF-025 + KT-18" },
  { identity: "CONFIGURATION:1b", codeIdentity: "code-1b", code: "1B", description: "SERVO MBF-015 + KT-20" },
  { identity: "CONFIGURATION:6c", codeIdentity: "code-6c", code: "6C", description: "SERVO VF-040 + KT-50" },
  { identity: "CONFIGURATION:6f", codeIdentity: "code-6f", code: "6F", description: "SERVO VF-040 + KT-51" },
  { identity: "ITEM:091", codeIdentity: "item-091", code: "091", description: "TAMPA INTERMEDIARIA 025 - 028" },
];

function dependencies(extraction = validExtraction, existingOrder = null) {
  let catalogLoads = 0;
  return {
    value: {
      extract: async () => structuredClone(extraction),
      loadCatalog: async () => { catalogLoads += 1; return catalog; },
      findExistingOrder: async () => existingOrder,
    },
    getCatalogLoads: () => catalogLoads,
  };
}

function providerClient({
  interactionResponse = { output_text: JSON.stringify(validExtraction) },
  interactionError = null,
  fallbackResponse = { text: JSON.stringify(validExtraction) },
  fallbackError = null,
} = {}) {
  const calls = { interactions: [], generateContent: [] };
  return {
    calls,
    client: {
      interactions: {
        create: async (...args) => {
          calls.interactions.push(args);
          if (interactionError) throw interactionError;
          return interactionResponse;
        },
      },
      models: {
        generateContent: async (params) => {
          calls.generateContent.push(params);
          if (fallbackError) throw fallbackError;
          return fallbackResponse;
        },
      },
    },
  };
}

function providerHttpError(status, message = `provider status ${status}`) {
  return Object.assign(new Error(message), { status, code: `HTTP_${status}` });
}

test("aceita o schema multimodal estrito e preserva zeros à esquerda", () => {
  assert.deepEqual(parseSupplierOrderPhotoExtraction(validExtraction), validExtraction);
  assert.equal(parseSupplierOrderPhotoExtraction({ ...validExtraction, rpcName: "create_supplier_order" }), null);
  assert.equal(parseSupplierOrderPhotoExtraction({ ...validExtraction, orderDate: "2026-02-30" }), null);
});

test("rejeita quantidade zero, negativa, decimal, excessiva e linha extra", () => {
  for (const quantity of [0, -1, 1.5, 2_147_483_648]) {
    const value = structuredClone(validExtraction);
    value.lines[0].quantity = quantity;
    assert.equal(parseSupplierOrderPhotoExtraction(value), null);
  }
  const extra = structuredClone(validExtraction);
  extra.lines[0].itemId = "invented";
  assert.equal(parseSupplierOrderPhotoExtraction(extra), null);
});

test("detecta magic bytes e rejeita MIME declarado incompatível", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new TextEncoder().encode("RIFF0000WEBP");
  const heic = new Uint8Array([...new Uint8Array(4), ...new TextEncoder().encode("ftypheic")]);
  assert.equal(detectSupplierOrderPhotoMimeType(jpeg), "image/jpeg");
  assert.equal(detectSupplierOrderPhotoMimeType(png), "image/png");
  assert.equal(detectSupplierOrderPhotoMimeType(webp), "image/webp");
  assert.equal(detectSupplierOrderPhotoMimeType(heic), "image/heic");
  assert.deepEqual(validateSupplierOrderPhotoBytes("image/jpeg", jpeg), { ok: true, mimeType: "image/jpeg" });
  assert.deepEqual(validateSupplierOrderPhotoBytes("image/png", jpeg), { ok: false });
  assert.deepEqual(validateSupplierOrderPhotoBytes("application/pdf", jpeg), { ok: false });
});

test("valida dimensões e rejeita imagem descomprimida excessiva", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 2800);
  new DataView(png.buffer).setUint32(20, 1800);
  assert.deepEqual(readSupplierOrderPhotoDimensions(png, "image/png"), { width: 2800, height: 1800 });
  assert.equal(supplierOrderPhotoDimensionsAreSafe({ width: 2800, height: 1800 }), true);
  assert.equal(supplierOrderPhotoDimensionsAreSafe({ width: 12000, height: 12000 }), false);
  assert.equal(supplierOrderPhotoDimensionsAreSafe(null), false);
});

test("resolve código sem fuzzy match, usa descrição oficial e não expõe IDs", async () => {
  const deps = dependencies();
  const block = await interpretSupplierOrderPhoto(deps.value);
  assert.equal(block.state, "READY_FOR_REVIEW");
  assert.equal(block.negotiationNumber, "000123");
  assert.equal(block.lines[0].displayCode, "2E");
  assert.equal(block.lines[0].description, "SERVO MBF-025 + KT-22");
  assert.equal(block.lines[0].quantity, 3);
  assert.equal(deps.getCatalogLoads(), 1);
  assert.doesNotMatch(JSON.stringify(block), /code-a|CONFIGURATION:a|itemId|configurationId/);
});

test("código desconhecido e código quase igual exigem revisão", async () => {
  for (const rawCode of ["11F", "2F"]) {
    const extraction = structuredClone(validExtraction);
    extraction.lines[0].rawCode = rawCode;
    const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
    assert.equal(block.state, "NEEDS_REVIEW");
    assert.equal(block.lines[0].displayCode, null);
    assert.match(block.lines[0].warning, /não foi identificado/);
  }
});

test("classifica encargos não-estoque sem depender do Gemini", () => {
  for (const rawDescription of [
    "FRETE - SEDEX",
    "FRETE",
    "TRANSPORTE RODOVIARIO",
    "ENVIO SEDEX",
    "TAXA LOGISTICA",
    "TARIFA DE FRETE",
    "SERVICO DE TRANSPORTE",
  ]) {
    assert.equal(classifySupplierOrderPhotoLineRole({ rawDescription, hasExactCatalogMatch: false }), "NON_STOCK_CHARGE");
  }
  assert.equal(classifySupplierOrderPhotoLineRole({ rawDescription: "SUPORTE DO SERVO", hasExactCatalogMatch: false }), "PRODUCT");
});

test("encargo é excluído, não entra no total e não bloqueia a prévia", async () => {
  const extraction = structuredClone(validExtraction);
  extraction.lines = [
    { rawCode: "2E", rawDescription: "SERVO MBF-025 + KT-22", quantity: 3, needsReview: false, warning: null },
    { rawCode: "FR-01", rawDescription: "FRETE - SEDEX", quantity: 1, needsReview: false, warning: null },
    { rawCode: null, rawDescription: "FRETE", quantity: 1, needsReview: false, warning: null },
  ];
  const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
  assert.equal(block.state, "READY_FOR_REVIEW");
  assert.equal(block.lines.length, 1);
  assert.equal(block.totalQuantity, 3);
  assert.doesNotMatch(JSON.stringify(block.lines), /FR-01|FRETE/);
  assert.match(block.warnings.join(" "), /Frete\/encargo não incluído/);
});

test("match exato do catálogo prevalece sobre heurística textual", async () => {
  const extraction = structuredClone(validExtraction);
  extraction.lines[0] = { rawCode: "2E", rawDescription: "ENVIO DO SERVO", quantity: 1, needsReview: false, warning: null };
  const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
  assert.equal(block.lines.length, 1);
  assert.equal(block.lines[0].displayCode, "2E");
  assert.equal(block.totalQuantity, 1);
});

test("Pedido 40959 exclui FR-01 e preserva total físico 5", async () => {
  const extraction = {
    documentType: "supplier_order", negotiationNumber: "40959", orderDate: "2026-08-13",
    lines: [
      { rawCode: "10A", rawDescription: "SERVO MC-040 - 10A", quantity: 1, needsReview: false, warning: null },
      { rawCode: "6F", rawDescription: "SERVO VF-040 - 6F", quantity: 1, needsReview: false, warning: null },
      { rawCode: "091/VF", rawDescription: "TAMPA INTERMEDIARIA VF - 024,5", quantity: 2, needsReview: false, warning: null },
      { rawCode: "091", rawDescription: "TAMPA INTERMEDIARIA 025 - 028", quantity: 1, needsReview: false, warning: null },
      { rawCode: "FR-01", rawDescription: "FRETE - SEDEX", quantity: 1, needsReview: false, warning: null },
    ], documentWarnings: [],
  };
  const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
  assert.equal(block.lines.length, 4);
  assert.equal(block.totalQuantity, 5);
  assert.equal(block.lines.some((line) => line.rawCode === "FR-01"), false);
  assert.ok(block.lines.find((line) => line.rawCode === "091/VF")?.blockingReasons.includes("CODE_NOT_FOUND"));
  assert.equal(block.lines.find((line) => line.rawCode === "091")?.resolution, "IDENTIFIED");
});

test("regressões 40930 e 40963 preservam totais e R066 identificado", async () => {
  const order40930 = structuredClone(validExtraction);
  order40930.negotiationNumber = "40930";
  order40930.lines = [
    ["10", "SERVO MC-040 SEM KIT", 5], ["10A", "SERVO MC-040 - 10A", 5],
    ["2A", "SERVO MBF-025 - 2A", 5], ["1", "SERVO MBF-015 SEM KIT", 5],
    ["1B", "SERVO MBF-015 - 1B", 3], ["2C", "SERVO MBF-025 - 2C", 2],
    ["5", "SERVO MBF-040 SEM KIT", 2], ["6", "SERVO VF-040 SEM KIT", 5],
    ["6C", "SERVO VF-040 - 6C", 2], ["6F", "SERVO VF-040 - 6F", 2],
    ["7AC", "SERVO BR-040 - 7AC", 1], ["10E", "SERVO MC-040 - 10E", 2],
    ["11C", "SERVO AL-10 - 11C", 2],
  ].map(([rawCode, rawDescription, quantity]) => ({
    rawCode, rawDescription, quantity, needsReview: false, warning: null,
  }));
  const preview40930 = await interpretSupplierOrderPhoto(dependencies(order40930).value);
  assert.equal(preview40930.lines.length, 13);
  assert.equal(preview40930.totalQuantity, 41);

  const order40963 = structuredClone(validExtraction);
  order40963.negotiationNumber = "40963";
  order40963.lines[0] = { rawCode: "R066", rawDescription: "JG REPARO 066 - VF-040", quantity: 2, needsReview: false, warning: null };
  const preview40963 = await interpretSupplierOrderPhoto(dependencies(order40963).value);
  assert.equal(preview40963.lines[0].displayCode, "R066");
  assert.equal(preview40963.lines[0].resolution, "IDENTIFIED");
});

test("descrição conflitante não troca silenciosamente o código", async () => {
  const extraction = structuredClone(validExtraction);
  extraction.lines[0].rawDescription = "SERVO AL-10 + KT-23";
  const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
  assert.equal(block.state, "NEEDS_REVIEW");
  assert.equal(block.lines[0].descriptionMatch, "CONFLICT");
  assert.equal(block.lines[0].displayCode, "2E");
});

test("código exato aceita descrições comerciais reais com o mesmo produto base", async () => {
  const cases = [
    ["R066", "JG REPARO 066 - VF-040", "JOGO DE REPARO 066"],
    ["10A", "SERVO MC-040 - 10A", "SERVO MC-040 + KT-48"],
    ["2A", "SERVO MBF-025 - 2A", "SERVO MBF-025 + KT-18"],
    ["1B", "SERVO MBF-015 - 1B", "SERVO MBF-015 + KT-20"],
    ["6C", "SERVO VF-040 - 6C", "SERVO VF-040 + KT-50"],
    ["6F", "SERVO VF-040 - 6F (INV)", "SERVO VF-040 + KT-51"],
  ];
  for (const [rawCode, rawDescription, officialDescription] of cases) {
    const extraction = structuredClone(validExtraction);
    extraction.lines[0] = { rawCode, rawDescription, quantity: 2, needsReview: false, warning: null };
    const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
    assert.equal(block.state, "READY_FOR_REVIEW", rawCode);
    assert.equal(block.lines[0].resolution, "IDENTIFIED", rawCode);
    assert.equal(block.lines[0].description, officialDescription, rawCode);
    assert.equal(block.lines[0].descriptionMatch, "MATCH", rawCode);
  }
});

test("modelo de Servo objetivamente diferente continua sendo conflito bloqueante", async () => {
  const extraction = structuredClone(validExtraction);
  extraction.lines[0] = {
    rawCode: "10A", rawDescription: "SERVO VF-040", quantity: 1, needsReview: false, warning: null,
  };
  const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
  assert.equal(block.state, "NEEDS_REVIEW");
  assert.equal(block.lines[0].resolution, "NEEDS_REVIEW");
  assert.equal(block.lines[0].descriptionMatch, "CONFLICT");
  assert.equal(block.lines[0].displayCode, "10A");
});

test("manuscrito não interferente é informativo; manuscrito sobre quantidade bloqueia", async () => {
  const informational = structuredClone(validExtraction);
  informational.lines[0] = {
    rawCode: "2A",
    rawDescription: "SERVO MBF-025 - 2A",
    quantity: 2,
    needsReview: true,
    warning: "Há anotação manuscrita nesta linha.",
  };
  const identified = await interpretSupplierOrderPhoto(dependencies(informational).value);
  assert.equal(identified.state, "READY_FOR_REVIEW");
  assert.equal(identified.lines[0].resolution, "IDENTIFIED");
  assert.match(identified.lines[0].warning, /anotação manuscrita/);

  const blocking = structuredClone(informational);
  blocking.lines[0].needsReview = true;
  blocking.lines[0].warning = "A anotação manuscrita cobre a quantidade impressa.";
  const review = await interpretSupplierOrderPhoto(dependencies(blocking).value);
  assert.equal(review.state, "NEEDS_REVIEW");
  assert.equal(review.lines[0].resolution, "NEEDS_REVIEW");
});

test("negociação inválida e data ausente nunca ficam prontas", async () => {
  for (const negotiationNumber of ["Pedido 1212", "12-12", "12 12", "ABC123", null]) {
    const extraction = structuredClone(validExtraction);
    extraction.negotiationNumber = negotiationNumber;
    extraction.orderDate = null;
    const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
    assert.equal(block.state, "NEEDS_REVIEW");
    assert.match(block.warnings.join(" "), /somente dígitos/);
  }
});

test("negociação existente gera bloqueio e link interno validado", async () => {
  const existing = { negotiationNumber: "000123", status: "PENDING", href: "/pedidos?view=active&order=11111111-1111-4111-8111-111111111111" };
  const block = await interpretSupplierOrderPhoto(dependencies(validExtraction, existing).value);
  assert.equal(block.state, "DUPLICATE_NEGOTIATION");
  assert.equal(block.existingOrder?.href, existing.href);
  assert.match(block.title, /já existe/);
});

test("documento desconhecido e foto sem linhas não criam falsa prévia pronta", async () => {
  const unknown = await interpretSupplierOrderPhoto(dependencies({ ...validExtraction, documentType: "unknown" }).value);
  assert.equal(unknown.state, "NOT_A_SUPPLIER_ORDER");
  const unreadable = await interpretSupplierOrderPhoto(dependencies({ ...validExtraction, lines: [] }).value);
  assert.equal(unreadable.state, "UNREADABLE");
});

test("linhas repetidas da mesma identidade e código são consolidadas com aviso", async () => {
  const extraction = structuredClone(validExtraction);
  extraction.lines.push({ ...extraction.lines[0], quantity: 2 });
  const block = await interpretSupplierOrderPhoto(dependencies(extraction).value);
  assert.equal(block.lines.length, 1);
  assert.equal(block.lines[0].quantity, 5);
  assert.equal(block.lines[0].consolidatedLineCount, 2);
  assert.match(block.lines[0].warning, /consolidadas/);
});

test("parser do structured block rejeita href externo, total adulterado e campo extra", async () => {
  const block = await interpretSupplierOrderPhoto(dependencies().value);
  assert.deepEqual(parseAssistantSupplierOrderPhotoPreviewBlock(block), block);
  assert.equal(parseAssistantSupplierOrderPhotoPreviewBlock({ ...block, totalQuantity: 999 }), null);
  assert.equal(parseAssistantSupplierOrderPhotoPreviewBlock({ ...block, proposalToken: "forbidden" }), null);
  const duplicate = await interpretSupplierOrderPhoto(dependencies(validExtraction, {
    negotiationNumber: "000123", status: "PENDING", href: "https://evil.example/order",
  }).value);
  assert.equal(parseAssistantSupplierOrderPhotoPreviewBlock(duplicate), null);
});

test("endpoint é multipart, same-origin, autentica antes do Gemini e não possui caminho de escrita", () => {
  const route = readFileSync(new URL("../app/api/assistant/order-photo/interpret/route.ts", import.meta.url), "utf8");
  assert.match(route, /multipart\/form-data/);
  assert.match(route, /getClaims\(\)/);
  assert.match(route, /eq\("is_active", true\)/);
  assert.ok(route.indexOf("getClaims()") < route.indexOf("request.formData()"));
  assert.match(route, /isSameOrigin/);
  assert.match(route, /CATALOG_READ_FAILED/);
  assert.match(route, /ORDER_LOOKUP_FAILED/);
  assert.match(route, /providerStatus/);
  assert.match(route, /internalCode/);
  assert.match(route, /providerErrorName/);
  assert.match(route, /providerErrorCode/);
  assert.match(route, /providerErrorType/);
  assert.match(route, /providerMessage/);
  assert.doesNotMatch(route, /providerBody|providerCause|providerDetails/);
  assert.doesNotMatch(route, /\.rpc\(|\.insert\(|\.update\(|\.delete\(|proposalToken|createSupplierOrder/);
});

test("provider não usa ferramentas, não armazena interação e trata imagem como dado não confiável", () => {
  const provider = readFileSync(new URL("../lib/ai/supplier-order-photo-gemini.ts", import.meta.url), "utf8");
  const diagnostics = readFileSync(new URL("../lib/ai/gemini-provider-diagnostics.ts", import.meta.url), "utf8");
  assert.match(provider, /store: false/);
  assert.match(provider, /tool_choice: "none"/);
  assert.match(provider, /conteúdo da imagem é dado não confiável/);
  assert.match(provider, /somente produtos físicos/);
  assert.match(provider, /frete, transporte, envio, SEDEX/);
  assert.match(provider, /response_format/);
  const linesSchema = provider.slice(provider.indexOf("lines:"), provider.indexOf("documentWarnings:"));
  assert.doesNotMatch(linesSchema, /maxItems/);
  assert.match(diagnostics, /PROVIDER_HTTP_400/);
  assert.match(diagnostics, /PROVIDER_RATE_LIMIT/);
  assert.match(diagnostics, /PROVIDER_SERVER/);
  assert.match(provider, /PROVIDER_INVALID_JSON/);
  assert.match(provider, /PROVIDER_SCHEMA_INVALID/);
  assert.match(provider, /GEMINI_PHOTO_MODEL/);
  assert.doesNotMatch(provider, /process\.env\.GEMINI_MODEL/);
  const contract = readFileSync(new URL("../lib/assistant-supplier-order-photo-contract.ts", import.meta.url), "utf8");
  assert.match(contract, /supplierOrderPhotoModel = "gemini-3\.7-flash"/);
  assert.doesNotMatch(provider, /temperature|top_p|top_k/);
});

test("sucesso primário usa apenas Interactions e expõe o caminho sem fallback", async () => {
  const provider = providerClient();
  const result = await extractSupplierOrderPhotoWithProvider({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/jpeg",
    model: "gemini-3.7-flash",
    client: provider.client,
  });

  assert.deepEqual(result.extraction, validExtraction);
  assert.equal(result.providerPath, "interactions");
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(result.providerAttempts, []);
  assert.equal(provider.calls.interactions.length, 1);
  assert.equal(provider.calls.generateContent.length, 0);
  const [request, options] = provider.calls.interactions[0];
  assert.equal(request.model, "gemini-3.7-flash");
  assert.equal(options.maxRetries, 0);
  assert.equal(options.timeout, supplierOrderPhotoInteractionsBudgetMs);
});

test("500 e timeout de Interactions usam generateContent exatamente uma vez", async () => {
  for (const interactionError of [
    providerHttpError(500, "internal server error"),
    Object.assign(new Error("request timed out"), { name: "AbortError" }),
  ]) {
    const provider = providerClient({ interactionError });
    const result = await extractSupplierOrderPhotoWithProvider({
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: "image/jpeg",
      model: "gemini-3.7-flash",
      client: provider.client,
    });

    assert.deepEqual(result.extraction, validExtraction);
    assert.equal(result.providerPath, "interactions->generateContent");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.providerAttempts.length, 1);
    assert.equal(provider.calls.interactions.length, 1);
    assert.equal(provider.calls.generateContent.length, 1);

    const fallbackRequest = provider.calls.generateContent[0];
    assert.equal(fallbackRequest.model, "gemini-3.7-flash");
    assert.equal(fallbackRequest.config.systemInstruction.length > 0, true);
    assert.equal(fallbackRequest.config.responseMimeType, "application/json");
    assert.equal(fallbackRequest.config.responseJsonSchema.type, "object");
    assert.equal(fallbackRequest.config.httpOptions.retryOptions.attempts, 1);
    assert.equal(fallbackRequest.config.httpOptions.timeout > 0, true);
    assert.equal(
      fallbackRequest.config.httpOptions.timeout <= supplierOrderPhotoProviderTotalBudgetMs,
      true,
    );
    assert.equal("tools" in fallbackRequest.config, false);
    assert.deepEqual(fallbackRequest.contents[0], {
      inlineData: { mimeType: "image/jpeg", data: "BAUG" },
    });
  }
});

test("400, autenticação, modelo e 429 não acionam fallback", async () => {
  const cases = [
    [400, "PROVIDER_HTTP_400"],
    [401, "PROVIDER_AUTH"],
    [403, "PROVIDER_AUTH"],
    [404, "PROVIDER_MODEL"],
    [429, "PROVIDER_RATE_LIMIT"],
  ];

  for (const [status, expectedCode] of cases) {
    const provider = providerClient({ interactionError: providerHttpError(status) });
    await assert.rejects(
      () => extractSupplierOrderPhotoWithProvider({
        bytes: new Uint8Array([1]),
        mimeType: "image/png",
        model: "gemini-3.7-flash",
        client: provider.client,
      }),
      (error) => {
        assert.equal(error instanceof SupplierOrderPhotoProviderError, true);
        assert.equal(error.internalCode, expectedCode);
        assert.equal(error.providerPath, "interactions");
        assert.equal(error.fallbackUsed, false);
        return true;
      },
    );
    assert.equal(provider.calls.interactions.length, 1);
    assert.equal(provider.calls.generateContent.length, 0);
  }
});

test("resposta primária inválida não aciona fallback depois de uma chamada válida", async () => {
  const provider = providerClient({ interactionResponse: { output_text: "not-json" } });
  await assert.rejects(
    () => extractSupplierOrderPhotoWithProvider({
      bytes: new Uint8Array([2]),
      mimeType: "image/png",
      model: "gemini-3.7-flash",
      client: provider.client,
    }),
    (error) => {
      assert.equal(error instanceof SupplierOrderPhotoProviderError, true);
      assert.equal(error.internalCode, "PROVIDER_INVALID_JSON");
      assert.equal(error.providerPath, "interactions");
      assert.equal(error.fallbackUsed, false);
      return true;
    },
  );
  assert.equal(provider.calls.interactions.length, 1);
  assert.equal(provider.calls.generateContent.length, 0);
});

test("falha das duas chamadas encerra em duas tentativas e guarda só diagnósticos seguros", async () => {
  const apiKey = "AIzaSecretMustNotLeak";
  const userContent = "Pedido privado do usuário";
  const provider = providerClient({
    interactionError: providerHttpError(500, `server error ${apiKey} ${userContent}`),
    fallbackError: providerHttpError(503, `unavailable ${apiKey} ${userContent}`),
  });

  await assert.rejects(
    () => extractSupplierOrderPhotoWithProvider({
      bytes: new Uint8Array([7, 8, 9]),
      mimeType: "image/webp",
      model: "gemini-3.7-flash",
      client: provider.client,
    }),
    (error) => {
      assert.equal(error instanceof SupplierOrderPhotoProviderError, true);
      assert.equal(error.internalCode, "PROVIDER_SERVER");
      assert.equal(error.providerPath, "interactions->generateContent");
      assert.equal(error.fallbackUsed, true);
      assert.equal(error.providerAttempts.length, 2);
      assert.deepEqual(error.providerAttempts.map((attempt) => attempt.path), [
        "interactions",
        "generateContent",
      ]);
      const diagnostics = JSON.stringify(error.providerAttempts);
      assert.doesNotMatch(diagnostics, new RegExp(apiKey, "i"));
      assert.doesNotMatch(diagnostics, new RegExp(userContent, "i"));
      return true;
    },
  );
  assert.equal(provider.calls.interactions.length, 1);
  assert.equal(provider.calls.generateContent.length, 1);
});

test("orçamento total da foto é limitado e a UX amigável permanece inalterada", () => {
  assert.equal(supplierOrderPhotoInteractionsBudgetMs, 22_000);
  assert.equal(supplierOrderPhotoProviderTotalBudgetMs, 45_000);
  assert.equal(
    supplierOrderPhotoInteractionsBudgetMs < supplierOrderPhotoProviderTotalBudgetMs,
    true,
  );
  const route = readFileSync(new URL("../app/api/assistant/order-photo/interpret/route.ts", import.meta.url), "utf8");
  assert.match(route, /providerPath/);
  assert.match(route, /fallbackUsed/);
  assert.match(route, /providerAttempts/);
  assert.match(route, /Não foi possível analisar este Pedido agora\. Tente novamente\./);
  assert.doesNotMatch(route, /providerBody|providerCause|providerDetails|base64|Authorization/);
});

test("orçamento total aborta o segundo caminho sem ultrapassar duas chamadas", async () => {
  const calls = { interactions: 0, generateContent: 0 };
  const rejectWhenAborted = (signal) => new Promise((resolve, reject) => {
    const rejectTimeout = () => reject(Object.assign(new Error("request timed out"), {
      name: "AbortError",
    }));
    if (signal.aborted) rejectTimeout();
    else signal.addEventListener("abort", rejectTimeout, { once: true });
  });
  const client = {
    interactions: {
      create: async (_request, requestOptions) => {
        calls.interactions += 1;
        return rejectWhenAborted(requestOptions.fetchOptions.signal);
      },
    },
    models: {
      generateContent: async (request) => {
        calls.generateContent += 1;
        return rejectWhenAborted(request.config.abortSignal);
      },
    },
  };
  const startedAt = Date.now();

  await assert.rejects(
    () => extractSupplierOrderPhotoWithProvider({
      bytes: new Uint8Array([3]),
      mimeType: "image/jpeg",
      model: "gemini-3.7-flash",
      client,
      totalBudgetMs: 50,
      interactionsBudgetMs: 15,
    }),
    (error) => {
      assert.equal(error instanceof SupplierOrderPhotoProviderError, true);
      assert.equal(error.internalCode, "PROVIDER_TIMEOUT");
      assert.equal(error.providerAttempts.length, 2);
      return true;
    },
  );

  assert.equal(calls.interactions, 1);
  assert.equal(calls.generateContent, 1);
  assert.equal(Date.now() - startedAt < 500, true);
});

test("hard deadline de Interactions aciona fallback mesmo quando o provider ignora o signal", async () => {
  const calls = { interactions: 0, generateContent: 0 };
  const client = {
    interactions: {
      create: async () => {
        calls.interactions += 1;
        return new Promise(() => {});
      },
    },
    models: {
      generateContent: async () => {
        calls.generateContent += 1;
        return { text: JSON.stringify(validExtraction) };
      },
    },
  };

  const result = await extractSupplierOrderPhotoWithProvider({
    bytes: new Uint8Array([1]),
    mimeType: "image/jpeg",
    model: "gemini-3.7-flash",
    client,
    totalBudgetMs: 80,
    interactionsBudgetMs: 15,
  });

  assert.equal(result.providerPath, "interactions->generateContent");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.providerAttempts[0]?.internalCode, "PROVIDER_TIMEOUT");
  assert.deepEqual(calls, { interactions: 1, generateContent: 1 });
});

test("hard deadline total rejeita fallback pendente que ignora timeout e AbortSignal", async () => {
  const secret = "pedido-ultrassecreto-base64";
  const calls = { interactions: 0, generateContent: 0 };
  const client = {
    interactions: {
      create: async () => {
        calls.interactions += 1;
        throw providerHttpError(500, `server error ${secret}`);
      },
    },
    models: {
      generateContent: async () => {
        calls.generateContent += 1;
        return new Promise(() => {});
      },
    },
  };
  const startedAt = Date.now();

  await assert.rejects(
    () => extractSupplierOrderPhotoWithProvider({
      bytes: new Uint8Array([2]),
      mimeType: "image/jpeg",
      model: "gemini-3.7-flash",
      client,
      totalBudgetMs: 30,
      interactionsBudgetMs: 10,
    }),
    (error) => {
      assert.equal(error instanceof SupplierOrderPhotoProviderError, true);
      assert.equal(error.internalCode, "PROVIDER_TIMEOUT");
      assert.equal(error.providerPath, "interactions->generateContent");
      assert.equal(error.fallbackUsed, true);
      assert.equal(error.providerAttempts.length, 2);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(secret, "i"));
      return true;
    },
  );

  assert.deepEqual(calls, { interactions: 1, generateContent: 1 });
  assert.equal(Date.now() - startedAt < 250, true);
});

test("fallback não inicia quando Interactions consome o deadline total ignorando cancelamento", async () => {
  const calls = { interactions: 0, generateContent: 0 };
  const client = {
    interactions: {
      create: async () => {
        calls.interactions += 1;
        return new Promise(() => {});
      },
    },
    models: {
      generateContent: async () => {
        calls.generateContent += 1;
        return { text: JSON.stringify(validExtraction) };
      },
    },
  };

  await assert.rejects(
    () => extractSupplierOrderPhotoWithProvider({
      bytes: new Uint8Array([3]),
      mimeType: "image/jpeg",
      model: "gemini-3.7-flash",
      client,
      totalBudgetMs: 25,
      interactionsBudgetMs: 100,
    }),
    (error) => {
      assert.equal(error instanceof SupplierOrderPhotoProviderError, true);
      assert.equal(error.internalCode, "PROVIDER_TIMEOUT");
      assert.equal(error.providerPath, "interactions");
      assert.equal(error.fallbackUsed, false);
      return true;
    },
  );

  assert.deepEqual(calls, { interactions: 1, generateContent: 0 });
});

test("Promise atrasada é absorvida após o deadline sem rejeição não tratada ou nova chamada", async () => {
  const calls = { interactions: 0, generateContent: 0 };
  let rejectLateProvider;
  const lateProvider = new Promise((_resolve, reject) => {
    rejectLateProvider = reject;
  });
  const client = {
    interactions: {
      create: async () => {
        calls.interactions += 1;
        throw providerHttpError(500);
      },
    },
    models: {
      generateContent: async () => {
        calls.generateContent += 1;
        return lateProvider;
      },
    },
  };
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);

  try {
    await assert.rejects(
      () => extractSupplierOrderPhotoWithProvider({
        bytes: new Uint8Array([4]),
        mimeType: "image/jpeg",
        model: "gemini-3.7-flash",
        client,
        totalBudgetMs: 20,
        interactionsBudgetMs: 10,
      }),
      (error) => {
        assert.equal(error.internalCode, "PROVIDER_TIMEOUT");
        assert.equal(error.providerPath, "interactions->generateContent");
        return true;
      },
    );

    rejectLateProvider(new Error("late provider rejection"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
    assert.deepEqual(calls, { interactions: 1, generateContent: 1 });
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("composer envia somente o arquivo, não persiste blob/base64 e não oferece Criar Pedido", () => {
  const home = readFileSync(new URL("../components/assistant-home.tsx", import.meta.url), "utf8");
  const view = readFileSync(new URL("../components/assistant-structured-block.tsx", import.meta.url), "utf8");
  assert.match(home, /formData\.append\("image", attachment\.file\)/);
  assert.match(home, /Foto de Pedido enviada/);
  assert.doesNotMatch(home, /Foto de Pedido analisada/);
  assert.doesNotMatch(home, /readAsDataURL|sessionStorage.*attachment|base64/);
  assert.match(view, /\{block\.banner\}/);
  assert.match(view, /line\.resolution === "IDENTIFIED" \? "ℹ" : "⚠"/);
  assert.doesNotMatch(view, />Criar Pedido</);
});

test("formulário e Server Action tradicionais exigem somente dígitos sem converter zeros", () => {
  const action = readFileSync(new URL("../app/(authenticated)/pedidos/actions.ts", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../app/(authenticated)/pedidos/orders-workspace.tsx", import.meta.url), "utf8");
  assert.match(action, /\^\[0-9\]\+\$/);
  assert.match(action, /Informe somente números no Nº do Pedido/);
  assert.match(workspace, /inputMode="numeric"/);
  assert.match(workspace, /pattern="\[0-9\]\+"/);
  assert.doesNotMatch(action, /parseInt\(negotiationNumber|Number\(negotiationNumber/);
});
