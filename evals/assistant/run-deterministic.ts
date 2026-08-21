import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { classifyAssistantIntent, routeAssistantClarification, routeInventoryItemSummaryQuestion, routeServoModelInventoryView } from "../../lib/ai/assistant-routing";
import { routeConfigurationAssemblyAction } from "../../lib/ai/configuration-assembly-routing";
import { routeConfigurationDisassemblyAction } from "../../lib/ai/configuration-disassembly-routing";
import { routeManualStockEntryAction } from "../../lib/ai/manual-stock-entry-routing";
import { routeManualStockOutputAction } from "../../lib/ai/manual-stock-output-routing";
import { routePurchaseRecommendationQuestion } from "../../lib/ai/purchase-recommendation-routing";
import { routeAssistantStatisticsQuestion } from "../../lib/ai/statistics-routing";
import { routeSupplierOrderFinalizationAction } from "../../lib/ai/supplier-order-finalization-routing";
import { routeSupplierOrderPickupAction } from "../../lib/ai/supplier-order-pickup-routing";
import { routeSupplierOrderQuestion } from "../../lib/ai/supplier-order-routing";
import { routeSupplierOrderStockEntryAction } from "../../lib/ai/supplier-order-stock-entry-routing";
import { extractServoModelCandidate } from "../../lib/servo-model-search";
import type { AssistantConversationContext } from "../../lib/assistant-types";
import { assistantEvalCases } from "./cases";
import type { AssistantEvalCase, AssistantEvalDimension, AssistantEvalFailure, AssistantEvalReport } from "./contracts";

const emptyContext: AssistantConversationContext = {
  topic: "GENERAL",
  itemQuery: null,
  itemReferenceKind: null,
  supplierOrderId: null,
  supplierOrderCatalogCode: null,
  lastIntent: null,
  statisticsIntent: null,
  statisticsPeriod: 7 as const,
  statisticsCode: null,
  suggestedFollowUp: null,
};

type RoutedRequest = {
  quantity?: unknown;
  requestedQuantity?: unknown;
  targetQuery?: unknown;
  catalogCode?: unknown;
  targetQueries?: unknown;
  requestedIdentity?: unknown;
  negotiationNumber?: unknown;
  mode?: unknown;
};

type RoutedResult = {
  kind?: unknown;
  request?: RoutedRequest;
  queryCode?: unknown;
};

function normalized(value: string | undefined | null) {
  return value?.replace(/[\s._/-]+/g, "").toLocaleUpperCase("pt-BR") ?? null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function failure(caseItem: AssistantEvalCase, message: string, actual: unknown, category: AssistantEvalFailure["failureCategory"]): AssistantEvalFailure {
  return { id: caseItem.id, category: caseItem.category, dimensions: caseItem.dimensions, failureCategory: category, message, expected: caseItem.expected, actual };
}

function checkRoute(caseItem: AssistantEvalCase, actual: RoutedResult): AssistantEvalFailure | null {
  const expected = caseItem.expected;
  if (expected.kind !== undefined && actual?.kind !== expected.kind) {
    return failure(caseItem, `Esperava kind ${expected.kind}; recebeu ${String(actual?.kind)}.`, actual, "ROUTING");
  }
  const request = actual?.request;
  if (expected.quantity !== undefined && request?.quantity !== expected.quantity && request?.requestedQuantity !== expected.quantity) {
    return failure(caseItem, `Esperava quantidade ${expected.quantity}; recebeu ${String(request?.quantity ?? request?.requestedQuantity)}.`, actual, "PARSING");
  }
  const targetQueries = Array.isArray(request?.targetQueries) ? request.targetQueries : [];
  const actualTarget = request?.targetQuery ?? request?.catalogCode ?? targetQueries[0] ?? actual?.queryCode;
  if (expected.target !== undefined && normalized(stringValue(actualTarget)) !== normalized(expected.target)) {
    return failure(caseItem, `Esperava alvo ${expected.target}; recebeu ${String(actualTarget)}.`, actual, "ENTITY_RESOLUTION");
  }
  if (expected.targetKind !== undefined && request?.requestedIdentity !== expected.targetKind) {
    return failure(caseItem, `Esperava tipo ${String(expected.targetKind)}; recebeu ${String(request?.requestedIdentity)}.`, actual, "ENTITY_RESOLUTION");
  }
  if (expected.negotiation !== undefined && normalized(stringValue(request?.negotiationNumber)) !== normalized(expected.negotiation)) {
    return failure(caseItem, `Esperava negociação ${String(expected.negotiation)}; recebeu ${String(request?.negotiationNumber)}.`, actual, "PARSING");
  }
  if (expected.mode !== undefined && request?.mode !== expected.mode) {
    return failure(caseItem, `Esperava modo ${expected.mode}; recebeu ${String(request?.mode)}.`, actual, "ROUTING");
  }
  return null;
}

function evaluateCase(caseItem: AssistantEvalCase): AssistantEvalFailure | null {
  const message = caseItem.messages.at(-1) ?? "";
  switch (caseItem.expected.evaluator) {
    case "manualEntry": return checkRoute(caseItem, routeManualStockEntryAction(message));
    case "manualOutput": return checkRoute(caseItem, routeManualStockOutputAction(message));
    case "assembly": return checkRoute(caseItem, routeConfigurationAssemblyAction(message));
    case "disassembly": return checkRoute(caseItem, routeConfigurationDisassemblyAction(message));
    case "pickup": return checkRoute(caseItem, routeSupplierOrderPickupAction(message));
    case "supplierEntry": return checkRoute(caseItem, routeSupplierOrderStockEntryAction(message));
    case "finalization": return checkRoute(caseItem, routeSupplierOrderFinalizationAction(message));
    case "purchase": {
      const route = routePurchaseRecommendationQuestion(message);
      const expected = caseItem.expected;
      if (route?.kind !== expected.kind || (expected.mode && route?.kind === "QUERY" && route.mode !== expected.mode) || (expected.target && route?.queryCode !== expected.target)) {
        return failure(caseItem, "A recomendação não usou o contrato esperado.", route, "ROUTING");
      }
      return null;
    }
    case "inventoryCode": {
      const route = routeInventoryItemSummaryQuestion(message, null);
      if (!route || normalized(route.queryCode) !== normalized(caseItem.expected.target) || route.metric !== caseItem.expected.metric) {
        return failure(caseItem, "A consulta não preservou o código comercial exato.", route, "ENTITY_RESOLUTION");
      }
      return null;
    }
    case "servoModel": {
      const model = extractServoModelCandidate(message);
      if (normalized(model) !== normalized(caseItem.expected.target)) {
        return failure(caseItem, "O modelo de Servo não foi reconhecido corretamente.", model, "ENTITY_RESOLUTION");
      }
      return null;
    }
    case "statistics": {
      const route = routeAssistantStatisticsQuestion(message, emptyContext);
      if (route.kind !== caseItem.expected.kind || (route.kind === "QUERY" && route.request.period !== caseItem.expected.period)) {
        return failure(caseItem, "A estatística não usou o contrato esperado.", route, "ROUTING");
      }
      return null;
    }
    case "supplierOrder": {
      const route = routeSupplierOrderQuestion(message, "00000000-0000-4000-8000-000000000001", new Date("2026-08-21T12:00:00.000Z"));
      if (route.kind !== caseItem.expected.kind) return failure(caseItem, "A consulta de Pedido não foi roteada.", route, "ROUTING");
      return null;
    }
    case "inventoryContext": {
      const route = routeInventoryItemSummaryQuestion(message, caseItem.expected.target ?? null);
      if (!route || normalized(route.queryCode) !== normalized(caseItem.expected.target) || route.metric !== caseItem.expected.metric) {
        return failure(caseItem, "O follow-up não preservou o código do contexto atual.", route, "CONTEXT");
      }
      return null;
    }
    case "servoContext": {
      const model = extractServoModelCandidate(caseItem.messages[0] ?? "");
      const view = routeServoModelInventoryView(message);
      if (normalized(model) !== normalized(caseItem.expected.target) || view !== caseItem.expected.view) {
        return failure(caseItem, "O follow-up não preservou o modelo de Servo atual.", { model, view }, "CONTEXT");
      }
      return null;
    }
    case "supplierOrderContext": {
      const route = routeSupplierOrderQuestion(message, "00000000-0000-4000-8000-000000000001", new Date("2026-08-21T12:00:00.000Z"));
      if (route.kind !== caseItem.expected.kind) return failure(caseItem, "O follow-up não preservou o Pedido atual.", route, "CONTEXT");
      return null;
    }
    case "statisticsContext": {
      const context = { ...emptyContext, topic: "STATISTICS" as const, statisticsIntent: "SUMMARY" as const };
      const route = routeAssistantStatisticsQuestion(message, context);
      if (route.kind !== caseItem.expected.kind || (route.kind === "QUERY" && route.request.intent !== caseItem.expected.intent)) {
        return failure(caseItem, "O follow-up não preservou o contexto de Estatísticas.", route, "CONTEXT");
      }
      return null;
    }
    case "mainIntent": {
      const intent = classifyAssistantIntent(message);
      if (intent !== caseItem.expected.intent) return failure(caseItem, `Esperava intenção ${caseItem.expected.intent}; recebeu ${intent}.`, intent, "ROUTING");
      return null;
    }
    case "clarification": {
      const route = routeAssistantClarification(message, message === "agora");
      if (message === "preciso de ajuda" && route?.kind !== "GENERIC") return failure(caseItem, "Ajuda genérica deveria pedir orientação curta.", route, "CLARIFICATION");
      if (message === "quero consultar um pedido" && route?.kind !== "SUPPLIER_ORDERS") return failure(caseItem, "Consulta sem número deveria pedir contexto de Pedido.", route, "CLARIFICATION");
      if (["da entrada nisso", "tira um daquele", "monta esse", "e o outro?", "faz 2"].includes(message) && classifyAssistantIntent(message) !== "AMBIGUOUS") return failure(caseItem, "Mensagem sem contexto suficiente não pode preparar ação.", classifyAssistantIntent(message), "CLARIFICATION");
      return null;
    }
    case "textConfirmation": {
      const routes = [
        routeManualStockEntryAction(message), routeManualStockOutputAction(message), routeConfigurationAssemblyAction(message),
        routeConfigurationDisassemblyAction(message), routeSupplierOrderPickupAction(message), routeSupplierOrderStockEntryAction(message),
        routeSupplierOrderFinalizationAction(message),
      ];
      const hasAction = routes.some((route) => route.kind === "ACTION" || route.kind === "PICKUP_ACTION");
      if (hasAction) return failure(caseItem, "Texto não pode preparar nem executar mutação operacional.", routes, "SAFETY");
      return null;
    }
  }
}

export function runAssistantDeterministicEvaluation(): AssistantEvalReport {
  const failures = assistantEvalCases.map(evaluateCase).filter((item): item is AssistantEvalFailure => Boolean(item));
  const dimensions = Object.fromEntries((["routing", "entityParsing", "context", "semanticContract", "safety"] as AssistantEvalDimension[]).map((dimension) => {
    const total = assistantEvalCases.filter((item) => item.dimensions.includes(dimension)).length;
    const failed = failures.filter((item) => item.dimensions.includes(dimension)).length;
    return [dimension, { total, passed: total - failed, score: total ? Number((((total - failed) / total) * 100).toFixed(1)) : 100 }];
  })) as AssistantEvalReport["dimensions"];
  return {
    corpusVersion: 1,
    total: assistantEvalCases.length,
    passed: assistantEvalCases.length - failures.length,
    failed: failures.length,
    score: Number((((assistantEvalCases.length - failures.length) / assistantEvalCases.length) * 100).toFixed(1)),
    dimensions,
    failures,
    providerLive: process.env.GEMINI_API_KEY ? "not_run" : "not_configured",
  };
}

export async function writeAssistantEvalArtifacts(report = runAssistantDeterministicEvaluation()) {
  const directory = resolve(process.cwd(), "artifacts", "assistant-eval");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const lines = [
    "# Assistente NK — avaliação determinística", "", `Total: ${report.total}`, `Passaram: ${report.passed}`,
    `Falharam: ${report.failed}`, `Score: ${report.score}%`, "",
    ...Object.entries(report.dimensions).map(([name, value]) => `- ${name}: ${value.score}% (${value.passed}/${value.total})`),
    "", "## Falhas", ...(report.failures.map((item) => `- ${item.id} — ${item.failureCategory}: ${item.message}`)),
  ];
  await writeFile(resolve(directory, "latest.md"), `${lines.join("\n")}\n`, "utf8");
  return report;
}
