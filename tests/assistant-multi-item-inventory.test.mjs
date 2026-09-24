import assert from "node:assert/strict";
import test from "node:test";

import { AssistantDataError, consultAssistantInventoryMultiItemSummary } from "../lib/assistant-data.ts";
import {
  assistantMultiItemMaximumTargets,
  routeInventoryMultiItemSummaryQuestion,
} from "../lib/ai/assistant-routing.ts";
import { answerAssistantQuestion, AssistantServiceError } from "../lib/ai/assistant.ts";
import { parseAssistantStructuredBlock } from "../lib/assistant-types.ts";
import { deriveAssistantConversationContext } from "../lib/assistant-conversation.ts";

const emptyContext = {
  topic: "GENERAL", itemQuery: null, itemReferenceKind: null,
  supplierOrderId: null, supplierOrderCatalogCode: null, lastIntent: null,
  suggestedFollowUp: null, statisticsPeriod: null, statisticsIntent: null,
  statisticsCode: null,
};

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

function physicalTarget(code, number = 1) {
  return {
    targetKind: "item", targetId: uuid(number), displayCode: code,
    itemType: "INSTALLATION_KIT", typeLabel: "Kit de instalação",
    description: `Kit ${code}`, currentStock: 7, minimumStock: 2,
    stockUnitLabel: "Kits de instalação", status: "OK", statusLabel: "Em estoque",
    shortfall: 0, href: `/estoque?item=${uuid(number)}`, mediaDescriptor: null,
  };
}

function commercialTarget(code, number = 1) {
  return {
    targetKind: "commercial_configuration", targetId: uuid(number), displayCode: code,
    itemType: "COMPLETE_BOX", typeLabel: "Servo com kit", description: `Caixa ${code}`,
    currentStock: 3, minimumStock: 2, stockUnitLabel: "Servos com kit montados",
    status: "OK", statusLabel: "Em estoque", shortfall: 0,
    href: `/estoque?configuration=${uuid(number)}`, mediaDescriptor: null,
    composition: { servoCode: "2", servoDescription: "SERVO MBF-025", installationKitCode: "KT-18", installationKitDescription: "KIT KT-18" },
  };
}

function entryFor(code, index) {
  if (code === "7ZZ") {
    return { requestedCodes: [code], normalizedCode: code, status: "NOT_FOUND", results: [], resolvedCode: null, equivalentCodes: [] };
  }
  if (code === "AMB-1") {
    return { requestedCodes: [code], normalizedCode: code, status: "AMBIGUOUS", results: [physicalTarget(code, index + 1), commercialTarget(code, index + 101)], resolvedCode: null, equivalentCodes: [] };
  }
  const commercial = !code.startsWith("KT-") && !code.startsWith("P-");
  const target = commercial ? commercialTarget(code, index + 1) : physicalTarget(code, index + 1);
  return {
    requestedCodes: [code], normalizedCode: code.toUpperCase(), status: "FOUND",
    results: [target], resolvedCode: code, equivalentCodes: commercial ? [code] : [],
    ...(commercial ? { commercialDetails: { mountedQuantity: 3, servoCode: "2", servoDescription: "SERVO MBF-025", servoLooseQuantity: 5, installationKitCode: "KT-18", installationKitDescription: "KIT KT-18", installationKitLooseQuantity: 7, maximumAssemblable: 5 } } : {}),
  };
}

function multiBlock(codes, metric = "STOCK") {
  return {
    kind: "inventory_multi_item_summary", metric,
    entries: codes.map(entryFor), requestedCount: codes.length,
    inventoryHref: "/estoque", fallbackText: `Consultados: ${codes.join(", ")}`,
  };
}

function answer(message, dependencies = {}, context = emptyContext) {
  return answerAssistantQuestion(
    message, context.itemQuery, context.supplierOrderId, context.supplierOrderCatalogCode,
    "Henrique", "test-user", "Henrique Klein", null, null, null, null, null, null,
    [], context,
    { semanticRouter: async () => ({ status: "FALLBACK", reason: "TIMEOUT" }), ...dependencies },
  );
}

test("parser reconhece listas explícitas nos separadores suportados", () => {
  const cases = [
    ["Quanto tenho do 2A e 5G?", ["2A", "5G"]],
    ["Quanto temos do 2A, 5G e 7A?", ["2A", "5G", "7A"]],
    ["Qual o saldo de 2A 5G 7A?", ["2A", "5G", "7A"]],
    ["Me passe o estoque de 2A, 5G, 7A e KT-18", ["2A", "5G", "7A", "KT-18"]],
    ["Consulte 2A; 7A; KT-18", ["2A", "7A", "KT-18"]],
    ["Qual o saldo desses códigos:\n2A\n5G\n7A\nKT-18", ["2A", "5G", "7A", "KT-18"]],
  ];
  for (const [message, expected] of cases) {
    const route = routeInventoryMultiItemSummaryQuestion(message);
    assert.equal(route?.kind, "QUERY", message);
    assert.deepEqual(route?.queryCodes, expected, message);
  }
});

test("parser preserva códigos INV, repetição e igualdade exata sem prefixos", () => {
  assert.deepEqual(routeInventoryMultiItemSummaryQuestion("Saldo de 2INV, 7AINV e KT-18")?.queryCodes, ["2INV", "7AINV", "KT-18"]);
  assert.deepEqual(routeInventoryMultiItemSummaryQuestion("Saldo de 7A, 7AB, 7AC e 7AF")?.queryCodes, ["7A", "7AB", "7AC", "7AF"]);
  assert.deepEqual(routeInventoryMultiItemSummaryQuestion("Saldo de 2A, 2A e KT-18")?.queryCodes, ["2A", "2A", "KT-18"]);
});

test("limite aceita 20 alvos e rejeita acima sem executar reader", async () => {
  const twenty = Array.from({ length: assistantMultiItemMaximumTargets }, (_, index) => `X${index + 1}`);
  assert.equal(routeInventoryMultiItemSummaryQuestion(`Saldo de ${twenty.join(", ")}`)?.kind, "QUERY");
  const twentyOne = [...twenty, "X21"];
  assert.deepEqual(routeInventoryMultiItemSummaryQuestion(`Saldo de ${twentyOne.join(", ")}`), { kind: "LIMIT_EXCEEDED", requestedCount: 21, maximumTargets: 20 });
  let calls = 0;
  const response = await answer(`Saldo de ${twentyOne.join(", ")}`, { inventoryMultiSummaryReader: async () => { calls += 1; return multiBlock(twentyOne); } });
  assert.equal(calls, 0);
  assert.match(response.message, /Nenhum código foi consultado/);
});

test("rota multi precede o fallback semântico e cobre combinações comerciais e físicas", async () => {
  const cases = [
    ["Saldo de 2A e 5G", ["2A", "5G"]],
    ["Estoque de 2A, 5G, 7A e KT-18", ["2A", "5G", "7A", "KT-18"]],
    ["Consulte 2A e KT-18", ["2A", "KT-18"]],
    ["Consulte 2A e P-10", ["2A", "P-10"]],
  ];
  for (const [message, expected] of cases) {
    let semanticCalls = 0;
    const response = await answer(message, {
      semanticRouter: async () => { semanticCalls += 1; return { status: "FALLBACK", reason: "TIMEOUT" }; },
      inventoryMultiSummaryReader: async (codes) => multiBlock(codes),
    });
    assert.equal(semanticCalls, 0, message);
    assert.equal(response.structuredBlock?.kind, "inventory_multi_item_summary", message);
    assert.deepEqual(response.structuredBlock?.entries.flatMap((entry) => entry.requestedCodes), expected, message);
    assert.equal(response.contextItemQuery, null, message);
  }
});

test("resposta múltipla limpa o contexto unitário sem criar contexto multi-item", async () => {
  const previous = { ...emptyContext, topic: "INVENTORY", itemQuery: "2A", itemReferenceKind: "CATALOG_CODE", lastIntent: "inventory_item_summary" };
  const response = await answer("Saldo de 2A e 5G", { inventoryMultiSummaryReader: async (codes) => multiBlock(codes) }, previous);
  const context = deriveAssistantConversationContext(previous, response);
  assert.equal(context.itemQuery, null);
  assert.equal(context.itemReferenceKind, null);
  assert.equal(context.lastIntent, "inventory_multi_item_summary");
  assert.equal("multiItemQueries" in context, false);
});

test("bloco representa inexistente e ambíguo entre resultados válidos", async () => {
  const response = await answer("Saldo de 2A, 7ZZ e AMB-1", { inventoryMultiSummaryReader: async (codes) => multiBlock(codes) });
  assert.deepEqual(response.structuredBlock?.entries.map(({ status }) => status), ["FOUND", "NOT_FOUND", "AMBIGUOUS"]);
  assert.equal(response.structuredBlock?.entries[2].results.length, 2);
  assert.equal(
    parseAssistantStructuredBlock(response.structuredBlock)?.kind,
    "inventory_multi_item_summary",
  );
});

test("aliases oficiais podem compartilhar alvo sem apagar o solicitado", () => {
  for (const aliases of [["1B", "1D"], ["6C", "6I"], ["6E", "6F"]]) {
    const target = commercialTarget(aliases[0]);
    const block = multiBlock(aliases);
    block.entries = [{ ...block.entries[0], requestedCodes: aliases, results: [target], resolvedCode: aliases[0], equivalentCodes: aliases }];
    assert.equal(parseAssistantStructuredBlock(block)?.kind, "inventory_multi_item_summary");
    assert.deepEqual(parseAssistantStructuredBlock(block)?.entries[0].requestedCodes, aliases);
  }
});

test("resolver real deduplica aliases por identidade e mantém igualdade exata", async () => {
  const items = [
    { id: "servo", code: "2", description: "SERVO MBF-025", item_type: "SERVO", minimum_stock: 1, is_active: true },
    { id: "kit", code: "KT-18", description: "KIT KT-18", item_type: "INSTALLATION_KIT", minimum_stock: 2, is_active: true },
  ];
  const aliases = [["config-1", "1B"], ["config-1", "1D"], ["config-2", "6C"], ["config-2", "6I"], ["config-3", "6E"], ["config-3", "6F"], ["config-prefix", "7AB"]]
    .map(([configuration_id, code], index) => ({ id: `alias-${index}`, configuration_id, code, is_active: true }));
  const configurations = ["config-1", "config-2", "config-3", "config-prefix"].map((id) => ({ id, description: `Configuração ${id}`, servo_id: "servo", installation_kit_id: "kit", minimum_stock: 1, is_active: true, image_path: null }));
  const snapshot = {
    items, servoModels: [{ item_id: "servo", model: "MBF-025" }],
    stockBalances: [{ item_id: "servo", quantity: 5 }, { item_id: "kit", quantity: 7 }],
    configurations, configurationCodes: aliases,
    configurationBalances: configurations.map((configuration, index) => ({ configuration_id: configuration.id, quantity: index + 1 })),
    repairCompatibilities: [],
  };
  const requested = ["1B", "1D", "6C", "6I", "6E", "6F", "7A", "7AB", "KT-18"];
  let receivedCodes;
  const block = await consultAssistantInventoryMultiItemSummary(
    requested,
    "STOCK",
    async (codes) => { receivedCodes = codes; return snapshot; },
  );
  assert.deepEqual(receivedCodes, requested);
  assert.equal(block.requestedCount, requested.length);
  assert.deepEqual(block.entries[0].requestedCodes, ["1B", "1D"]);
  assert.deepEqual(block.entries[1].requestedCodes, ["6C", "6I"]);
  assert.deepEqual(block.entries[2].requestedCodes, ["6E", "6F"]);
  assert.equal(block.entries.find((entry) => entry.normalizedCode === "7A")?.status, "NOT_FOUND");
  assert.equal(block.entries.find((entry) => entry.normalizedCode === "7AB")?.status, "FOUND");
  assert.deepEqual(block.entries[0].commercialDetails, {
    mountedQuantity: 1, servoCode: "2", servoDescription: "SERVO MBF-025",
    servoLooseQuantity: 5, installationKitCode: "KT-18", installationKitDescription: "KIT KT-18",
    installationKitLooseQuantity: 7, maximumAssemblable: 5,
  });
  const kit = block.entries.find((entry) => entry.normalizedCode === "KT-18");
  assert.equal(kit?.results[0].currentStock, 17);
});

test("resolver real encontra modelo único junto de código físico", async () => {
  const snapshot = {
    items: [
      { id: "servo", code: "2", description: "SERVO MBF-025", item_type: "SERVO", minimum_stock: 1, is_active: true },
      { id: "kit", code: "KT-18", description: "KIT KT-18", item_type: "INSTALLATION_KIT", minimum_stock: 2, is_active: true },
    ],
    servoModels: [{ item_id: "servo", model: "MBF-025" }],
    stockBalances: [{ item_id: "servo", quantity: 5 }, { item_id: "kit", quantity: 7 }],
    configurations: [], configurationCodes: [], configurationBalances: [], repairCompatibilities: [],
  };
  const block = await consultAssistantInventoryMultiItemSummary(
    ["MBF025", "KT-18"], "STOCK", async () => snapshot,
  );
  const model = block.entries.find((entry) => entry.normalizedCode === "MBF025");
  assert.equal(model?.status, "FOUND");
  assert.equal(model?.results[0].displayCode, "2");
  assert.equal(model?.results[0].itemType, "SERVO");
  assert.equal(model?.results[0].currentStock, 5);
  assert.equal(block.entries.find((entry) => entry.normalizedCode === "KT-18")?.status, "FOUND");
});

test("resolver real separa Servo sem kit e configurações montadas para modelo ambíguo", async () => {
  const snapshot = {
    items: [
      { id: "servo", code: "2", description: "SERVO MBF-025", item_type: "SERVO", minimum_stock: 1, is_active: true },
      { id: "kit", code: "KT-18", description: "KIT KT-18", item_type: "INSTALLATION_KIT", minimum_stock: 2, is_active: true },
    ],
    servoModels: [{ item_id: "servo", model: "MBF-025" }],
    stockBalances: [{ item_id: "servo", quantity: 5 }, { item_id: "kit", quantity: 7 }],
    configurations: [{ id: "config", description: "MBF-025 + KT-18", servo_id: "servo", installation_kit_id: "kit", minimum_stock: 1, is_active: true, image_path: null }],
    configurationCodes: [{ id: "alias", configuration_id: "config", code: "2A", is_active: true }],
    configurationBalances: [{ configuration_id: "config", quantity: 3 }],
    repairCompatibilities: [],
  };
  const block = await consultAssistantInventoryMultiItemSummary(
    ["MBF-025", "KT-18"], "STOCK", async () => snapshot,
  );
  const model = block.entries.find((entry) => entry.normalizedCode === "MBF-025");
  assert.equal(model?.status, "AMBIGUOUS");
  assert.deepEqual(
    model?.results.map((result) => [result.displayCode, result.itemType, result.currentStock]),
    [["2", "SERVO", 5], ["2A", "COMPLETE_BOX", 3]],
  );
  assert.equal(model?.resolvedCode, null);
});

test("Tenho 2 do 5G permanece unitário e consultas unitárias não regridem", async () => {
  assert.equal(routeInventoryMultiItemSummaryQuestion("Tenho 2 do 5G?"), null);
  for (const [message, metric] of [["Tenho 2 do 5G?", "STOCK"], ["Qual o mínimo do 5G?", "MINIMUM"]]) {
    const calls = [];
    const response = await answer(message, {
      itemLookupReader: async (code) => { calls.push(["lookup", code]); return { exact_code_match: true }; },
      inventorySummaryReader: async (code, actualMetric) => { calls.push(["summary", code, actualMetric]); return { kind: "inventory_item_summary", queryCode: code, status: "FOUND", metric: actualMetric, results: [commercialTarget(code)], inventoryHref: "/estoque", primaryText: "ok", fallbackText: "ok" }; },
    });
    assert.equal(response.structuredBlock?.kind, "inventory_item_summary");
    assert.deepEqual(calls.at(-1), ["summary", "5G", metric]);
  }
});

test("consulta unitária por modelo de servo preserva breakdown", async () => {
  const response = await answer("Quantos MBF-025 tenho?", {
    itemLookupReader: async () => ({ exact_code_match: false }),
    servoModelInventoryReader: async () => ({ kind: "servo_model_inventory_breakdown", scope: "FULL_MODEL", model: { official: "MBF-025", normalized: "MBF025" }, bareServo: null, looseQuantity: 5, mountedQuantity: 3, totalQuantity: 8, configurations: [], totalConfigurations: 0, remainingConfigurations: 0, inventoryHref: "/estoque", fallbackText: "8 no total" }),
  });
  assert.equal(response.structuredBlock?.kind, "servo_model_inventory_breakdown");
  assert.equal(response.structuredBlock?.totalQuantity, 8);
});

test("falha de banco em consulta múltipla é fail-closed", async () => {
  await assert.rejects(
    answer("Saldo de 2A e 5G", { inventoryMultiSummaryReader: async () => { throw new AssistantDataError(); } }),
    (error) => error instanceof AssistantServiceError && error.code === "TOOL",
  );
});
