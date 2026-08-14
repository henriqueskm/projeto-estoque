import "server-only";

import { consultAssistantItem } from "@/lib/assistant-data";
import type { AssistantStatisticsRequest } from "@/lib/ai/statistics-routing";
import { buildAssistantStatisticsAnswer } from "@/lib/ai/statistics-response";
import { loadStatisticsData } from "@/lib/statistics-data";

export async function answerAssistantStatistics(request: AssistantStatisticsRequest) {
  const result = await loadStatisticsData(request.period);
  if (result.error || !result.data) {
    return {
      message: "Não consegui carregar as Estatísticas agora.",
      contextStatisticsPeriod: request.period,
      contextStatisticsIntent: request.intent,
      contextStatisticsCode: request.code,
    };
  }

  return buildAssistantStatisticsAnswer(
    request,
    result.data,
    async (code) => {
      const catalog = await consultAssistantItem(code);
      const exact = catalog.exact_code_match ? catalog.results : [];
      return { exists: exact.length > 0, ambiguous: exact.length > 1 };
    },
  );
}
