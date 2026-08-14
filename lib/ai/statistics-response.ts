import type {
  AssistantChatSuccess,
  AssistantStatisticsBlock,
  AssistantSuggestedFollowUp,
} from "@/lib/assistant-types";
import type { AssistantStatisticsRequest } from "@/lib/ai/statistics-routing";
import type {
  StatisticsComparison,
  StatisticsConfigurationRanking,
  StatisticsData,
  StatisticsItemRanking,
} from "@/lib/statistics-types";

const quantity = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export type ResolveStatisticsCatalogCode = (
  code: string,
) => Promise<{ exists: boolean; ambiguous: boolean }>;

function baseContext(
  request: AssistantStatisticsRequest,
  suggestedFollowUp: AssistantSuggestedFollowUp | null = null,
) {
  return {
    contextLastIntent: request.intent,
    contextSuggestedFollowUp: suggestedFollowUp,
    contextStatisticsPeriod: request.period,
    contextStatisticsIntent: request.intent,
    contextStatisticsCode: request.code,
    contextItemQuery: null,
    contextItemReferenceKind: null,
    contextSupplierOrderId: null,
    contextSupplierOrderCatalogCode: null,
  } as const;
}

function block(
  mode: AssistantStatisticsBlock["mode"],
  period: 7 | 30 | 90,
  title: string,
  description: string,
  metrics: AssistantStatisticsBlock["metrics"] = [],
  ranking: AssistantStatisticsBlock["ranking"] = [],
): AssistantStatisticsBlock {
  return {
    kind: "assistant_statistics",
    mode,
    period,
    title,
    description,
    metrics,
    ranking,
    statisticsHref: `/estatisticas?periodo=${period}`,
    fallbackText: description,
  };
}

function comparisonText(label: "entradas" | "saídas externas", comparison: StatisticsComparison) {
  const current = quantity.format(comparison.current);
  const previous = quantity.format(comparison.previous);
  if (comparison.direction === "NO_BASE") {
    return `Foram ${current} ${label} no período atual. Não há base no período anterior para calcular uma variação percentual.`;
  }
  if (comparison.direction === "STABLE") return `As ${label} ficaram estáveis: ${current} no período atual e ${previous} no anterior.`;
  return `As ${label} ${comparison.direction === "UP" ? "aumentaram" : "diminuíram"}: ${current} no período atual contra ${previous} no anterior (${percent.format(Math.abs(comparison.percentage ?? 0))}%).`;
}

function rankingRows(items: Array<StatisticsConfigurationRanking | StatisticsItemRanking>) {
  return items.slice(0, 5).map((item, index) => ({
    position: index + 1,
    code: "aliases" in item ? item.aliases.join(" / ") : item.code,
    description: item.description,
    quantity: item.quantity,
  }));
}

function topAnswer(
  request: AssistantStatisticsRequest,
  items: Array<StatisticsConfigurationRanking | StatisticsItemRanking>,
  subject: string,
  assemblyUse = false,
): AssistantChatSuccess {
  const top = items[0];
  if (!top) return { message: `Não houve ${assemblyUse ? "uso em montagens" : "saída externa"} para ${subject} nos últimos ${request.period} dias.`, ...baseContext(request) };
  const code = "aliases" in top ? top.aliases.join(" / ") : top.code;
  const message = assemblyUse
    ? `Nos últimos ${request.period} dias, o Cód. ${code} foi o kit mais utilizado em montagens, com ${quantity.format(top.quantity)} unidades.`
    : `Considerando as saídas externas dos últimos ${request.period} dias, o Cód. ${code} ficou em primeiro entre ${subject}, com ${quantity.format(top.quantity)} unidades.`;
  return {
    message,
    ...baseContext(
      request,
      !assemblyUse && request.intent === "TOP_CONFIGURATION"
        ? "SHOW_STATISTICS_RANKING"
        : null,
    ),
  };
}

function findRankedCode(data: StatisticsData, rawCode: string) {
  const code = rawCode.toLocaleUpperCase("pt-BR");
  const configuration = data.rankings.configurations.find((item) =>
    item.aliases.some((alias) => alias.toLocaleUpperCase("pt-BR") === code));
  if (configuration) return { code: configuration.aliases.join(" / "), description: configuration.description, quantity: configuration.quantity, alias: code };
  const item = [data.rankings.looseServos, data.rankings.looseKits, data.rankings.repairKits, data.rankings.looseParts]
    .flat().find((row) => row.code.toLocaleUpperCase("pt-BR") === code);
  return item ? { code: item.code, description: item.description, quantity: item.quantity, alias: code } : null;
}

async function answerCodeOutbound(
  request: AssistantStatisticsRequest,
  data: StatisticsData,
  resolveCatalogCode: ResolveStatisticsCatalogCode,
) {
  const rawCode = request.code!;
  const ranked = findRankedCode(data, rawCode);
  if (ranked) {
    const aliasText = ranked.code !== ranked.alias ? ` pertence à configuração ${ranked.code}, que` : "";
    return { message: `O Cód. ${ranked.alias}${aliasText} teve ${quantity.format(ranked.quantity)} saídas externas nos últimos ${request.period} dias.`, ...baseContext(request) };
  }
  const catalog = await resolveCatalogCode(rawCode);
  if (!catalog.exists || catalog.ambiguous) {
    return { message: catalog.ambiguous ? `O Cód. ${rawCode} corresponde a mais de um cadastro. Informe qual deles deseja consultar.` : `Não encontrei o Cód. ${rawCode} no catálogo atual.`, ...baseContext(request) };
  }
  return { message: `O Cód. ${rawCode} existe no catálogo e teve 0 saídas externas nos últimos ${request.period} dias.`, ...baseContext(request) };
}

export function buildAssistantStatisticsAnswer(
  request: AssistantStatisticsRequest,
  data: StatisticsData,
  resolveCatalogCode: ResolveStatisticsCatalogCode = async () => ({ exists: false, ambiguous: false }),
): AssistantChatSuccess | Promise<AssistantChatSuccess> {
  const period = request.period;
  switch (request.intent) {
    case "SUMMARY": {
      const message = `Nos últimos ${period} dias, foram registradas ${quantity.format(data.totals.inbound)} entradas e ${quantity.format(data.totals.outbound)} saídas externas.`;
      return { message, structuredBlock: block("SUMMARY", period, `Resumo · ${period} dias`, message, [
        { label: "Entradas", value: data.totals.inbound }, { label: "Saídas externas", value: data.totals.outbound },
        { label: "Montagens", value: data.totals.assembled }, { label: "Desmontagens", value: data.totals.disassembled },
      ]), ...baseContext(request, "SHOW_STATISTICS_CATEGORIES") };
    }
    case "INBOUND_TOTAL": return { message: `Foram registradas ${quantity.format(data.totals.inbound)} entradas nos últimos ${period} dias.`, ...baseContext(request) };
    case "OUTBOUND_TOTAL": return { message: `Foram registradas ${quantity.format(data.totals.outbound)} saídas externas nos últimos ${period} dias.`, ...baseContext(request) };
    case "INBOUND_COMPARISON": return { message: comparisonText("entradas", data.comparisons.inbound), ...baseContext(request) };
    case "OUTBOUND_COMPARISON": return { message: comparisonText("saídas externas", data.comparisons.outbound), ...baseContext(request) };
    case "SERVO_KIT_SPLIT": {
      const message = `Nos últimos ${period} dias, saíram ${quantity.format(data.servoSales.withKit)} Servos montados com kit e ${quantity.format(data.servoSales.withoutKit)} Servos sem kit, totalizando ${quantity.format(data.servoSales.total)} saídas externas de Servos.`;
      return { message, structuredBlock: block("BREAKDOWN", period, "Servos com kit e sem kit", message, [
        { label: "Servos com kit", value: data.servoSales.withKit, detail: `${percent.format(data.servoSales.withKitPercentage)}%` },
        { label: "Servos sem kit", value: data.servoSales.withoutKit, detail: `${percent.format(data.servoSales.withoutKitPercentage)}%` },
        { label: "Total de Servos", value: data.servoSales.total },
      ]), ...baseContext(request, "SHOW_STATISTICS_TOP_CONFIGURATION") };
    }
    case "OUTBOUND_BY_CATEGORY": {
      const categories = [
        ["Servos com kit", data.outboundByCategory.completeBoxes], ["Servos sem kit", data.outboundByCategory.looseServos],
        ["Kits avulsos", data.outboundByCategory.looseInstallationKits], ["Jogos de reparo", data.outboundByCategory.repairKits],
        ["Peças avulsas", data.outboundByCategory.looseParts],
      ] as const;
      const top = [...categories].sort((a, b) => b[1] - a[1])[0];
      const message = top[1] > 0
        ? `Nos últimos ${period} dias, ${top[0]} foi a categoria com mais saídas externas, com ${quantity.format(top[1])} unidades.`
        : `Não houve saídas externas nas categorias acompanhadas nos últimos ${period} dias.`;
      return { message, structuredBlock: block("BREAKDOWN", period, "Saídas externas por categoria", message,
        categories.map(([label, value]) => ({ label, value }))), ...baseContext(request) };
    }
    case "TOP_CONFIGURATION": return topAnswer(request, data.rankings.configurations, "Servos com kit");
    case "TOP_LOOSE_SERVO": return topAnswer(request, data.rankings.looseServos, "Servos sem kit");
    case "TOP_LOOSE_KIT": return topAnswer(request, data.rankings.looseKits, "Kits avulsos");
    case "TOP_REPAIR_KIT": return topAnswer(request, data.rankings.repairKits, "Jogos de reparo");
    case "TOP_LOOSE_PART": return topAnswer(request, data.rankings.looseParts, "Peças avulsas");
    case "TOP_KIT_USED_IN_ASSEMBLY": return topAnswer(request, data.rankings.kitsUsedInAssemblies, "Kits", true);
    case "CONFIGURATION_RANKING": {
      const rows = rankingRows(data.rankings.configurations);
      const message = rows.length ? `Aqui estão as cinco configurações com mais saídas externas nos últimos ${period} dias.` : `Não houve saída externa de Servos com kit nos últimos ${period} dias.`;
      return { message, structuredBlock: block("RANKING", period, "Ranking · Servos com kit", message, [], rows), ...baseContext(request) };
    }
    case "LOOSE_SERVO_RANKING": {
      const rows = rankingRows(data.rankings.looseServos);
      const message = rows.length ? `Aqui estão os cinco Servos sem kit com mais saídas externas nos últimos ${period} dias.` : `Não houve saída externa de Servos sem kit nos últimos ${period} dias.`;
      return { message, structuredBlock: block("RANKING", period, "Ranking · Servos sem kit", message, [], rows), ...baseContext(request) };
    }
    case "CODE_OUTBOUND": return answerCodeOutbound(request, data, resolveCatalogCode);
    case "WITHOUT_MOVEMENT": {
      const entries = [
        ...data.withoutMovement.configurations.map((item) => ({ code: item.aliases.join(" / "), description: item.description })),
        ...data.withoutMovement.items.map((item) => ({ code: item.code, description: item.description })),
      ].slice(0, 5).map((item, index) => ({ position: index + 1, ...item, quantity: 0 }));
      const message = `${quantity.format(data.highlights.withoutMovementTotal)} cadastros não tiveram movimentação nos últimos ${period} dias. Isso não significa que estejam sem estoque.`;
      return { message, structuredBlock: block("RANKING", period, "Sem movimento no período", message, [], entries), ...baseContext(request) };
    }
  }
}
