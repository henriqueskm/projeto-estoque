import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { routeAssistantStatisticsQuestion } from "../lib/ai/statistics-routing.ts";
import { buildAssistantStatisticsAnswer } from "../lib/ai/statistics-response.ts";
import { parseAssistantConversationContext } from "../lib/assistant-conversation.ts";

const emptyContext = {
  topic: "GENERAL", itemQuery: null, itemReferenceKind: null,
  supplierOrderId: null, supplierOrderCatalogCode: null, lastIntent: null,
  suggestedFollowUp: null, statisticsPeriod: null, statisticsIntent: null,
  statisticsCode: null,
};
const statisticsContext = (intent, period = 30, code = null, suggestedFollowUp = null) => ({
  ...emptyContext, topic: "STATISTICS", statisticsPeriod: period,
  statisticsIntent: intent, statisticsCode: code, lastIntent: intent,
  suggestedFollowUp,
});

const item = (code, description, quantity) => ({ id: `id-${code}`, code, description, quantity });
const data = {
  period: 30,
  periodStart: "2026-07-15T03:00:00.000Z",
  periodEndExclusive: "2026-08-14T03:00:00.000Z",
  previousPeriodStart: "2026-06-15T03:00:00.000Z",
  previousPeriodEndExclusive: "2026-07-15T03:00:00.000Z",
  totals: { inbound: 12, outbound: 21, assembled: 4, disassembled: 2 },
  comparisons: {
    inbound: { current: 12, previous: 0, direction: "NO_BASE", percentage: null },
    outbound: { current: 21, previous: 14, direction: "UP", percentage: 50 },
  },
  servoSales: { withKit: 13, withoutKit: 5, total: 18, withKitPercentage: 72.2, withoutKitPercentage: 27.8 },
  outboundByCategory: { completeBoxes: 13, looseServos: 5, looseInstallationKits: 1, repairKits: 1, looseParts: 1 },
  highlights: { configuration: null, looseServo: null, looseInstallationKit: null, repairKit: null, loosePart: null, withoutMovementTotal: 2 },
  timeline: [],
  rankings: {
    configurations: [{ id: "config-1", aliases: ["1B", "1D"], description: "SERVO MBF-015 + KT-29", servoCode: "1", installationKitCode: "KT-29", quantity: 8 }],
    looseServos: [item("6", "SERVO VF-040 SEM KIT", 5)],
    kitsUsedInAssemblies: [item("KT-29", "KIT DE INSTALAÇÃO", 4)],
    looseKits: [item("KT-22", "KIT AVULSO", 1)],
    repairKits: [item("R066", "JOGO DE REPARO", 1)],
    looseParts: [item("091", "TAMPA INTERMEDIÁRIA", 1)],
  },
  withoutMovement: {
    items: [{ id: "i0", code: "11", description: "SERVO AL-10", itemType: "SERVO" }],
    configurations: [{ id: "c0", aliases: ["2A"], description: "SERVO MBF-025 + KT-18", servoCode: "2", installationKitCode: "KT-18" }],
  },
  currentStock: { completeBoxesTotal: 0, looseServoTotal: 0, looseKitTotal: 0, repairKitTotal: 0, loosePartTotal: 0, lowStockItems: 0, outOfStockItems: 0 },
};

test("routes the required explicit and contextual statistics intents", () => {
  assert.deepEqual(routeAssistantStatisticsQuestion("Qual Servo com kit mais saiu nos últimos 30 dias?", emptyContext),
    { kind: "QUERY", request: { intent: "TOP_CONFIGURATION", period: 30, code: null } });
  assert.equal(routeAssistantStatisticsQuestion("E sem kit?", statisticsContext("TOP_CONFIGURATION")).request.intent, "TOP_LOOSE_SERVO");
  assert.deepEqual(routeAssistantStatisticsQuestion("E nos 7 dias?", statisticsContext("TOP_LOOSE_SERVO")),
    { kind: "QUERY", request: { intent: "TOP_LOOSE_SERVO", period: 7, code: null } });
  assert.deepEqual(routeAssistantStatisticsQuestion("Quanto saiu do 2A?", statisticsContext("TOP_LOOSE_SERVO")),
    { kind: "QUERY", request: { intent: "CODE_OUTBOUND", period: 30, code: "2A" } });
  assert.equal(routeAssistantStatisticsQuestion("Quantas saídas tivemos nos últimos 30 dias?", emptyContext).request.intent, "OUTBOUND_TOTAL");
  assert.equal(routeAssistantStatisticsQuestion("Foi mais que no período anterior?", statisticsContext("OUTBOUND_TOTAL")).request.intent, "OUTBOUND_COMPARISON");
  assert.equal(routeAssistantStatisticsQuestion("Quantas entradas nos últimos 7 dias?", emptyContext).request.intent, "INBOUND_TOTAL");
  assert.equal(routeAssistantStatisticsQuestion("Com kit e sem kit?", statisticsContext("OUTBOUND_TOTAL")).request.intent, "SERVO_KIT_SPLIT");
  assert.equal(routeAssistantStatisticsQuestion("Qual kit foi mais usado em montagens?", statisticsContext("SUMMARY")).request.intent, "TOP_KIT_USED_IN_ASSEMBLY");
  assert.equal(routeAssistantStatisticsQuestion("Qual categoria mais saiu?", statisticsContext("SUMMARY")).request.intent, "OUTBOUND_BY_CATEGORY");
  assert.equal(routeAssistantStatisticsQuestion("Quais itens não tiveram movimento?", statisticsContext("SUMMARY")).request.intent, "WITHOUT_MOVEMENT");
  assert.equal(routeAssistantStatisticsQuestion("Quantos Servos com kit saíram nos últimos 30 dias?", emptyContext).request.intent, "SERVO_KIT_SPLIT");
  assert.equal(routeAssistantStatisticsQuestion("Qual foi o mais vendido com kit nos últimos 30 dias?", emptyContext).request.intent, "TOP_CONFIGURATION");
  assert.equal(routeAssistantStatisticsQuestion("Como ficou comparado ao período anterior?", statisticsContext("SUMMARY")).request.intent, "OUTBOUND_COMPARISON");
  assert.equal(routeAssistantStatisticsQuestion("O 2A saiu mais que no período anterior?", statisticsContext("CODE_OUTBOUND", 30, "2A")).kind, "ITEM_COMPARISON_UNAVAILABLE");
});

test("period is mandatory, unsupported calendar periods never map silently", () => {
  assert.equal(routeAssistantStatisticsQuestion("Qual Servo com kit mais saiu?", emptyContext).kind, "CLARIFY_PERIOD");
  const month = routeAssistantStatisticsQuestion("Qual Servo com kit mais saiu este mês?", emptyContext);
  assert.equal(month.kind, "CLARIFY_PERIOD");
  assert.equal(month.intent, "TOP_CONFIGURATION");
});

test("statistics context switches cleanly and typed sim stays read-only", () => {
  assert.equal(routeAssistantStatisticsQuestion("Quanto tem do 2A no estoque?", statisticsContext("TOP_CONFIGURATION")).kind, "NOT_STATISTICS");
  assert.equal(routeAssistantStatisticsQuestion("Qual Servo sem kit mais saiu nos últimos 30 dias?", { ...emptyContext, topic: "INVENTORY", itemQuery: "MBF-025", itemReferenceKind: "SERVO_MODEL" }).kind, "QUERY");
  assert.deepEqual(routeAssistantStatisticsQuestion("sim", statisticsContext("SUMMARY", 30, null, "SHOW_STATISTICS_CATEGORIES")),
    { kind: "QUERY", request: { intent: "OUTBOUND_BY_CATEGORY", period: 30, code: null } });
  assert.equal(routeAssistantStatisticsQuestion("sim", emptyContext).kind, "NOT_STATISTICS");
  assert.deepEqual(parseAssistantConversationContext(statisticsContext("SUMMARY")), statisticsContext("SUMMARY"));
  assert.equal(parseAssistantConversationContext(statisticsContext("CODE_OUTBOUND", 30, null)), null);
  assert.equal(parseAssistantConversationContext(statisticsContext("SUMMARY", 30, "2A")), null);
  assert.equal(parseAssistantConversationContext(statisticsContext("SUMMARY", 30, null, "SHOW_STATISTICS_RANKING")), null);
});

test("official data produces summary, comparison and semantic-safe answers", async () => {
  const summary = await buildAssistantStatisticsAnswer({ intent: "SUMMARY", period: 30, code: null }, data);
  assert.match(summary.message, /12 entradas e 21 saídas externas/);
  assert.equal(summary.structuredBlock.metrics.length, 4);
  assert.equal(summary.structuredBlock.statisticsHref, "/estatisticas?periodo=30");
  const noBase = await buildAssistantStatisticsAnswer({ intent: "INBOUND_COMPARISON", period: 30, code: null }, data);
  assert.match(noBase.message, /Não há base/);
  assert.doesNotMatch(noBase.message, /%/);
  const sold = await buildAssistantStatisticsAnswer({ intent: "TOP_CONFIGURATION", period: 30, code: null }, data);
  assert.match(sold.message, /saídas externas/);
  assert.doesNotMatch(sold.message, /vendidas/);
  assert.match(sold.message, /1B \/ 1D/);
  const assembly = await buildAssistantStatisticsAnswer({ intent: "TOP_KIT_USED_IN_ASSEMBLY", period: 30, code: null }, data);
  assert.match(assembly.message, /utilizado em montagens/);
  assert.doesNotMatch(assembly.message, /saída externa/);
  const unmoved = await buildAssistantStatisticsAnswer({ intent: "WITHOUT_MOVEMENT", period: 30, code: null }, data);
  assert.match(unmoved.message, /não significa que estejam sem estoque/);
});

test("aliases stay grouped and existing zero differs from unknown code", async () => {
  const alias = await buildAssistantStatisticsAnswer({ intent: "CODE_OUTBOUND", period: 30, code: "1D" }, data);
  assert.match(alias.message, /configuração 1B \/ 1D/);
  assert.match(alias.message, /8 saídas externas/);
  const zero = await buildAssistantStatisticsAnswer(
    { intent: "CODE_OUTBOUND", period: 30, code: "XYZ1" }, data,
    async () => ({ exists: true, ambiguous: false }),
  );
  assert.match(zero.message, /teve 0 saídas externas/);
  const unknown = await buildAssistantStatisticsAnswer(
    { intent: "CODE_OUTBOUND", period: 30, code: "ZZZ9" }, data,
    async () => ({ exists: false, ambiguous: false }),
  );
  assert.match(unknown.message, /Não encontrei/);
});

test("assistant integration reuses the official loader without mutable contracts", async () => {
  const source = await readFile(new URL("../lib/assistant-statistics.ts", import.meta.url), "utf8");
  assert.match(source, /loadStatisticsData\(request\.period\)/);
  assert.match(source, /buildAssistantStatisticsAnswer/);
  assert.doesNotMatch(source, /\.rpc\(|proposalToken|idempotency|insert\(|update\(|delete\(/i);

  const assistant = await readFile(new URL("../lib/ai/assistant.ts", import.meta.url), "utf8");
  const operationalGuard = assistant.indexOf("operationalConfirmationGuard");
  const statisticsRoute = assistant.indexOf('statisticsRoute.kind === "QUERY"');
  assert.ok(operationalGuard >= 0 && statisticsRoute > operationalGuard);
});
