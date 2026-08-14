import type {
  AssistantConversationContext,
  AssistantStatisticsIntent,
} from "@/lib/assistant-types";
import type { StatisticsPeriod } from "@/lib/statistics-types";

export type AssistantStatisticsRequest = {
  intent: AssistantStatisticsIntent;
  period: StatisticsPeriod;
  code: string | null;
};

export type AssistantStatisticsRoute =
  | { kind: "NOT_STATISTICS" }
  | { kind: "ITEM_COMPARISON_UNAVAILABLE" }
  | { kind: "CLARIFY_COMPARISON_TARGET" }
  | { kind: "CLARIFY_PERIOD"; intent: AssistantStatisticsIntent; code: string | null }
  | { kind: "QUERY"; request: AssistantStatisticsRequest };

const entityOrBreakdownIntents = new Set<AssistantStatisticsIntent>([
  "SERVO_KIT_SPLIT",
  "OUTBOUND_BY_CATEGORY",
  "TOP_CONFIGURATION",
  "TOP_LOOSE_SERVO",
  "TOP_LOOSE_KIT",
  "TOP_REPAIR_KIT",
  "TOP_LOOSE_PART",
  "TOP_KIT_USED_IN_ASSEMBLY",
  "CONFIGURATION_RANKING",
  "LOOSE_SERVO_RANKING",
  "CODE_OUTBOUND",
  "WITHOUT_MOVEMENT",
]);

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[?!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
}

function explicitPeriod(message: string): StatisticsPeriod | null {
  const match = message.match(/\b(?:ultimos?\s+)?(7|30|90)\s+dias?\b/);
  return match ? Number(match[1]) as StatisticsPeriod : null;
}

function hasUnsupportedPeriod(message: string) {
  return /\b(?:este mes|mes atual|semana passada|julho|ano|anual|\d+\s+dias?)\b/.test(message) &&
    explicitPeriod(message) === null;
}

function extractCode(message: string) {
  const match = message.match(/\bquanto\s+(?:saiu|vendeu)\s+(?:do|da|de)\s+(?:cod(?:igo)?\s+)?([a-z0-9]+(?:[/-][a-z0-9]+)*)\b/);
  return match?.[1]?.toLocaleUpperCase("pt-BR") ?? null;
}

function explicitIntent(message: string): { intent: AssistantStatisticsIntent; code: string | null } | null {
  const code = extractCode(message);
  if (code) return { intent: "CODE_OUTBOUND", code };
  if (/\b(?:esse|este|o)\s+[a-z0-9/-]+\s+(?:saiu|vendeu)\s+mais\s+que\s+no\s+periodo\s+anterior\b/.test(message)) {
    return null;
  }
  if (/\b(?:sem movimento|nao tiveram movimento|nao teve movimento)\b/.test(message)) return { intent: "WITHOUT_MOVEMENT", code: null };
  if (/\bkit\b.*\b(?:usado|utilizado)\b.*\bmontagens?\b|\bmais\s+(?:usado|utilizado)\s+em\s+montagens?\b/.test(message)) {
    return { intent: "TOP_KIT_USED_IN_ASSEMBLY", code: null };
  }
  if (/\b(?:ranking|cinco|5)\b.*\bservos?\s+(?:com kit|montados? com kit)\b|\branking\s+de\s+servos?\s+com\s+kit\b/.test(message)) {
    return { intent: "CONFIGURATION_RANKING", code: null };
  }
  if (/\b(?:ranking|cinco|5)\b.*\bservos?\s+(?:sem kit|avulsos?)\b/.test(message)) {
    return { intent: "LOOSE_SERVO_RANKING", code: null };
  }
  if (/\b(?:qual|servo|configuracao|codigo).*(?:com kit).*(?:mais\s+(?:saiu|vend)|mais vendido)|\bqual.*mais vendido com kit\b|\bqual\s+configuracao\s+mais\s+(?:saiu|vendeu)\b/.test(message)) {
    return { intent: "TOP_CONFIGURATION", code: null };
  }
  if (/\b(?:qual|servo).*(?:sem kit|avulso).*(?:mais\s+(?:saiu|vend)|mais vendido)\b/.test(message)) {
    return { intent: "TOP_LOOSE_SERVO", code: null };
  }
  if (/\bqual\s+kit\s+avulso\s+mais\s+(?:saiu|vendeu)\b/.test(message)) return { intent: "TOP_LOOSE_KIT", code: null };
  if (/\bqual\s+(?:jogo|kit)\s+de\s+reparo\s+mais\s+(?:saiu|vendeu)\b/.test(message)) return { intent: "TOP_REPAIR_KIT", code: null };
  if (/\bqual\s+peca\s+avulsa\s+mais\s+(?:saiu|vendeu)\b/.test(message)) return { intent: "TOP_LOOSE_PART", code: null };
  if (/\b(?:saidas?\s+por\s+categoria|qual\s+categoria\s+mais\s+(?:saiu|vendeu)|quantos?\s+kits?\s+avulsos?\s+sairam)\b/.test(message)) {
    return { intent: "OUTBOUND_BY_CATEGORY", code: null };
  }
  if (/\b(?:com kit e sem kit|com kit ou sem kit|quantos? servos? sairam no total|quantos? servos? (?:com|sem) kit sairam)\b/.test(message)) return { intent: "SERVO_KIT_SPLIT", code: null };
  if (/\b(?:saidas? aumentaram|mais saidas? que|saidas?.*periodo anterior|vendemos mais)\b/.test(message)) return { intent: "OUTBOUND_COMPARISON", code: null };
  if (/\b(?:entradas? aumentaram|mais entradas? que|entradas?.*periodo anterior)\b/.test(message)) return { intent: "INBOUND_COMPARISON", code: null };
  if (/\b(?:quantas? entradas?|quanto entrou)\b/.test(message)) return { intent: "INBOUND_TOTAL", code: null };
  if (/\b(?:quantas? saidas?|quanto saiu)\b/.test(message)) return { intent: "OUTBOUND_TOTAL", code: null };
  if (/\b(?:estatisticas|resumo|como foi a movimentacao|como foram as movimentacoes)\b/.test(message)) return { intent: "SUMMARY", code: null };
  return null;
}

function contextualIntent(message: string, context: AssistantConversationContext) {
  if (context.topic !== "STATISTICS" || !context.statisticsIntent) return null;
  if (context.statisticsIntent === "SUMMARY" && /^(?:as )?entradas$/.test(message)) {
    return { intent: "INBOUND_COMPARISON" as const, code: null };
  }
  if (context.statisticsIntent === "SUMMARY" && /^(?:as )?saidas(?: externas)?$/.test(message)) {
    return { intent: "OUTBOUND_COMPARISON" as const, code: null };
  }
  if (/^(?:e\s+)?sem kit$/.test(message) && context.statisticsIntent === "TOP_CONFIGURATION") return { intent: "TOP_LOOSE_SERVO" as const, code: null };
  if (/^(?:e\s+)?(?:com|sem) kit$/.test(message) && context.statisticsIntent === "SERVO_KIT_SPLIT") return { intent: "SERVO_KIT_SPLIT" as const, code: null };
  if (/^(?:e\s+)?com kit$/.test(message) && context.statisticsIntent === "TOP_LOOSE_SERVO") return { intent: "TOP_CONFIGURATION" as const, code: null };
  if (/^(?:e\s+)?(?:nos\s+)?(?:ultimos?\s+)?(?:7|30|90)\s+dias?$/.test(message)) return { intent: context.statisticsIntent, code: context.statisticsCode };
  if (
    /^(?:(?:foi|foram) mais que no periodo anterior|e?\s*comparad[oa]s? ao periodo anterior|e antes|e nos (?:7|30|90) dias anteriores|como (?:ficou|ficaram) comparad[oa]s? ao periodo anterior)$/.test(message)
  ) {
    if (["OUTBOUND_TOTAL", "OUTBOUND_COMPARISON"].includes(context.statisticsIntent)) {
      return { intent: "OUTBOUND_COMPARISON" as const, code: null };
    }
    if (["INBOUND_TOTAL", "INBOUND_COMPARISON"].includes(context.statisticsIntent)) {
      return { intent: "INBOUND_COMPARISON" as const, code: null };
    }
    if (context.statisticsIntent === "SUMMARY") {
      return { clarifyComparisonTarget: true as const };
    }
    if (entityOrBreakdownIntents.has(context.statisticsIntent)) {
      return { unsupportedItemComparison: true as const };
    }
  }
  if (/\b(?:esse|este|o)\s+codigo\b.*\bperiodo anterior\b/.test(message)) return { unsupportedItemComparison: true as const };
  return null;
}

function suggestedIntent(context: AssistantConversationContext) {
  if (context.topic !== "STATISTICS") return null;
  if (context.suggestedFollowUp === "SHOW_STATISTICS_RANKING") return "CONFIGURATION_RANKING" as const;
  if (context.suggestedFollowUp === "SHOW_STATISTICS_CATEGORIES") return "OUTBOUND_BY_CATEGORY" as const;
  if (context.suggestedFollowUp === "SHOW_STATISTICS_TOP_CONFIGURATION") return "TOP_CONFIGURATION" as const;
  return null;
}

export function routeAssistantStatisticsQuestion(
  rawMessage: string,
  context: AssistantConversationContext,
): AssistantStatisticsRoute {
  const message = normalize(rawMessage);
  if (/\b(?:quanto tem|qual o estoque|no estoque)\b/.test(message) && !/\b(?:saiu|saidas?|estatisticas)\b/.test(message)) {
    return { kind: "NOT_STATISTICS" };
  }
  const contextual = contextualIntent(message, context);
  if (contextual && "unsupportedItemComparison" in contextual) return { kind: "ITEM_COMPARISON_UNAVAILABLE" };
  if (contextual && "clarifyComparisonTarget" in contextual) return { kind: "CLARIFY_COMPARISON_TARGET" };
  if (context.topic === "STATISTICS" && /\b[a-z0-9/-]+\b.*\bsaiu mais que no periodo anterior\b/.test(message)) {
    return { kind: "ITEM_COMPARISON_UNAVAILABLE" };
  }
  const suggested = /^(?:sim|pode|quero|mostra|me mostra|pode mostrar|quais|quais sao)$/.test(message)
    ? suggestedIntent(context)
    : null;
  const resolved = contextual ?? (suggested ? { intent: suggested, code: null } : explicitIntent(message));
  if (!resolved) return { kind: "NOT_STATISTICS" };

  const period = explicitPeriod(message) ?? context.statisticsPeriod;
  if (!period || hasUnsupportedPeriod(message)) {
    return { kind: "CLARIFY_PERIOD", intent: resolved.intent, code: resolved.code };
  }
  return { kind: "QUERY", request: { intent: resolved.intent, period, code: resolved.code } };
}
