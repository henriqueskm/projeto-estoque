import type {
  AssistantClarificationBlock,
  AssistantClarificationOption,
  AssistantConfigurationDisassemblyTarget,
  AssistantStockOutputTarget,
} from "@/lib/assistant-types";
import { planLooseServoOutputSuggestion } from "@/lib/ai/manual-stock-output-suggestions.mjs";
import type { OutboundPreview } from "@/lib/outbound-preview";

export type ManualStockOutputBatchPreparationLine = {
  target: AssistantStockOutputTarget;
  quantity: number;
};

export type ManualStockOutputDisassemblySource = {
  servoId: string;
  failed: boolean;
  targets: AssistantConfigurationDisassemblyTarget[];
};

type PreparationCandidate = {
  configurationId: string;
  displayCode: string;
  option: Omit<AssistantClarificationOption, "id">;
  operationRank: number;
};

function compareCandidates(
  first: PreparationCandidate,
  second: PreparationCandidate,
) {
  return (
    first.operationRank - second.operationRank ||
    first.displayCode.localeCompare(second.displayCode, "pt-BR", {
      numeric: true,
      sensitivity: "base",
    }) ||
    first.configurationId.localeCompare(second.configurationId)
  );
}

export function buildManualStockOutputBatchPreparationBlock(input: {
  lines: ManualStockOutputBatchPreparationLine[];
  projection: OutboundPreview;
  disassemblySources: ManualStockOutputDisassemblySource[];
}): AssistantClarificationBlock | null {
  if (input.disassemblySources.some((source) => source.failed)) return null;
  const candidates = new Map<string, PreparationCandidate>();
  const targetsByCommercialCodeId = new Map(
    input.lines
      .filter((line) => line.target.kind === "COMMERCIAL_CODE")
      .map((line) => [line.target.targetId, line.target]),
  );

  if (input.projection.isValid) {
    const assemblyByConfiguration = new Map<
      string,
      { target: AssistantStockOutputTarget; quantity: number }
    >();
    for (const previewLine of input.projection.commercialLines) {
      if (previewLine.autoAssembledQuantity < 1) continue;
      const target = targetsByCommercialCodeId.get(
        previewLine.option.commercialCodeId,
      );
      if (!target?.configurationId || !target.servo || !target.installationKit) {
        continue;
      }
      const current = assemblyByConfiguration.get(target.configurationId);
      const representative = !current ||
        target.displayCode.localeCompare(current.target.displayCode, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        }) < 0
        ? target
        : current.target;
      assemblyByConfiguration.set(target.configurationId, {
        target: representative,
        quantity: (current?.quantity ?? 0) + previewLine.autoAssembledQuantity,
      });
    }

    for (const [configurationId, assembly] of assemblyByConfiguration) {
      const { target, quantity } = assembly;
      if (
        !target.servo ||
        !target.installationKit ||
        quantity > target.autoAssemblyCapacity ||
        quantity > target.servo.currentStock ||
        quantity > target.installationKit.currentStock
      ) {
        continue;
      }
      candidates.set(configurationId, {
        configurationId,
        displayCode: target.displayCode,
        operationRank: 0,
        option: {
          label: `Montar ${quantity} · Cód. ${target.aliases.join(" / ") || target.displayCode}`.slice(0, 60),
          prompt: `Preparar montagem de ${quantity} unidade${quantity === 1 ? "" : "s"} do Cód. ${target.displayCode}.`,
          description: `Servo ${target.servo.code}: ${target.servo.currentStock} avulso(s) · Kit ${target.installationKit.code}: ${target.installationKit.currentStock} avulso(s).`.slice(0, 180),
          category: "inventory",
          configurationAssemblySelection: {
            action: "configuration_assembly_target",
            commercialCodeId: target.targetId,
            quantity,
          },
        },
      });
    }
  }

  const componentsUsedByCommercialLines = new Set(
    input.lines.flatMap((line) =>
      line.target.kind === "COMMERCIAL_CODE"
        ? [line.target.servo?.id, line.target.installationKit?.id].filter(
            (id): id is string => Boolean(id),
          )
        : [],
    ),
  );
  const sourceByServoId = new Map(
    input.disassemblySources.map((source) => [source.servoId, source]),
  );
  for (const line of input.lines) {
    const { target, quantity } = line;
    if (
      target.kind !== "ITEM" ||
      target.typeLabel !== "Servo sem kit" ||
      quantity <= target.currentStock ||
      componentsUsedByCommercialLines.has(target.targetId)
    ) {
      continue;
    }
    const source = sourceByServoId.get(target.targetId);
    if (!source) return null;
    const mountedTargets = source.targets
      .filter((candidate) => candidate.currentStock > 0)
      .sort((first, second) =>
        second.currentStock - first.currentStock ||
        first.displayCode.localeCompare(second.displayCode, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        }) ||
        first.configurationId.localeCompare(second.configurationId),
      );
    const suggestion = planLooseServoOutputSuggestion(
      target.currentStock,
      quantity,
      mountedTargets,
    );
    if (
      suggestion.kind !== "DISASSEMBLY_OPTIONS" &&
      suggestion.kind !== "MULTIPLE_DISASSEMBLIES_REQUIRED"
    ) {
      continue;
    }
    for (const candidate of suggestion.options) {
      if (candidates.has(candidate.configurationId)) continue;
      const disassemblyQuantity = candidate.suggestedQuantity;
      candidates.set(candidate.configurationId, {
        configurationId: candidate.configurationId,
        displayCode: candidate.displayCode,
        operationRank: 1,
        option: {
          label: `Desmontar ${disassemblyQuantity} · Cód. ${candidate.aliases.join(" / ") || candidate.displayCode}`.slice(0, 60),
          prompt: `Preparar desmontagem de ${disassemblyQuantity} unidade${disassemblyQuantity === 1 ? "" : "s"} do Cód. ${candidate.displayCode}.`,
          description: `Servo ${candidate.servo.code} · Kit ${candidate.installationKit.code} · Montado ${candidate.currentStock} · Necessário para a lista ${suggestion.shortage}.`.slice(0, 180),
          category: "inventory",
          configurationDisassemblySelection: {
            action: "configuration_disassembly_target",
            commercialCodeId: candidate.commercialCodeId,
            quantity: disassemblyQuantity,
          },
        },
      });
    }
  }

  const visibleCandidates = Array.from(candidates.values())
    .sort(compareCandidates)
    .slice(0, 5);
  if (!visibleCandidates.length) return null;

  return {
    kind: "assistant_clarification",
    title: "Operações separadas necessárias",
    message: "A lista depende de montagem ou desmontagem. Cada opção prepara somente uma operação oficial; confirme uma por vez e depois solicite a saída inteira novamente para revalidar todos os saldos.",
    options: [
      ...visibleCandidates.map((candidate, index) => ({
        id: candidate.operationRank === 0
          ? `output-batch-assemble-${index + 1}`
          : `output-batch-disassemble-${index + 1}`,
        ...candidate.option,
      })),
      {
        id: "output-cancel",
        label: "Cancelar",
        prompt: "Cancelar esta saída.",
        category: "inventory",
      },
    ],
    fallbackText: "Nenhuma saída foi preparada. Escolha uma operação separada e, depois de confirmá-la, solicite a saída inteira novamente.",
  };
}
