import type {
  InboundCatalogOption,
  InboundCommercialCode,
  InboundNewLoosePart,
  InboundPhysicalItem,
} from "@/lib/inbound-types";

const maximumQuantity = 2_147_483_647;

export type InboundPreviewInputLine = {
  option: InboundCatalogOption;
  quantity: number;
};

export type InboundItemLinePreview = {
  option: InboundPhysicalItem | InboundNewLoosePart;
  receivedQuantity: number;
  predictedBalance: number;
  isValid: boolean;
};

export type InboundCommercialLinePreview = {
  option: InboundCommercialCode;
  receivedQuantity: number;
};

export type InboundConfigurationImpact = {
  configurationId: string;
  option: InboundCommercialCode;
  requestedCodes: string[];
  currentBalance: number;
  receivedQuantity: number;
  predictedBalance: number;
  isValid: boolean;
};

export type InboundPreview = {
  itemLines: InboundItemLinePreview[];
  commercialLines: InboundCommercialLinePreview[];
  configurationImpacts: InboundConfigurationImpact[];
  totalQuantity: number;
  commercialQuantity: number;
  isValid: boolean;
  errors: string[];
};

function compareCodes(
  first: { code: string },
  second: { code: string },
) {
  return first.code.localeCompare(second.code, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

export function buildInboundPreview(
  lines: InboundPreviewInputLine[],
): InboundPreview {
  const itemLines = lines
    .filter(
      (
        line,
      ): line is InboundPreviewInputLine & {
        option: InboundPhysicalItem | InboundNewLoosePart;
      } =>
        line.option.kind === "ITEM" ||
        line.option.kind === "NEW_LOOSE_PART",
    )
    .map((line): InboundItemLinePreview => {
      const predictedBalance = line.option.balance + line.quantity;
      const isValid =
        Number.isSafeInteger(predictedBalance) &&
        predictedBalance <= maximumQuantity;

      return {
        option: line.option,
        receivedQuantity: line.quantity,
        predictedBalance,
        isValid,
      };
    });

  const commercialLines = lines
    .filter(
      (
        line,
      ): line is InboundPreviewInputLine & {
        option: InboundCommercialCode;
      } => line.option.kind === "COMMERCIAL_CODE",
    )
    .map(
      (line): InboundCommercialLinePreview => ({
        option: line.option,
        receivedQuantity: line.quantity,
      }),
    )
    .sort((first, second) => {
      const codeComparison = compareCodes(first.option, second.option);

      if (codeComparison !== 0) {
        return codeComparison;
      }

      return first.option.commercialCodeId.localeCompare(
        second.option.commercialCodeId,
      );
    });

  const commercialByConfiguration = new Map<
    string,
    InboundCommercialLinePreview[]
  >();

  commercialLines.forEach((line) => {
    const grouped =
      commercialByConfiguration.get(line.option.configurationId) ?? [];
    grouped.push(line);
    commercialByConfiguration.set(line.option.configurationId, grouped);
  });

  const configurationImpacts = Array.from(
    commercialByConfiguration,
    ([configurationId, configurationLines]): InboundConfigurationImpact => {
      const option = configurationLines[0].option;
      const receivedQuantity = configurationLines.reduce(
        (total, line) => total + line.receivedQuantity,
        0,
      );
      const predictedBalance =
        option.assembledBalance + receivedQuantity;
      const isValid =
        Number.isSafeInteger(receivedQuantity) &&
        receivedQuantity <= maximumQuantity &&
        Number.isSafeInteger(predictedBalance) &&
        predictedBalance <= maximumQuantity;

      return {
        configurationId,
        option,
        requestedCodes: configurationLines.map((line) => line.option.code),
        currentBalance: option.assembledBalance,
        receivedQuantity,
        predictedBalance,
        isValid,
      };
    },
  ).sort((first, second) => compareCodes(first.option, second.option));

  const totalQuantity = lines.reduce(
    (total, line) => total + line.quantity,
    0,
  );
  const commercialQuantity = commercialLines.reduce(
    (total, line) => total + line.receivedQuantity,
    0,
  );
  const errors = itemLines
    .filter((line) => !line.isValid)
    .map(
      (line) =>
        `A entrada prevista de ${line.option.code} excede o limite permitido para o saldo.`,
    );

  configurationImpacts
    .filter((impact) => !impact.isValid)
    .forEach((impact) => {
      errors.push(
        `A entrada das caixas ${impact.requestedCodes.join(", ")} excede o limite permitido para a configuração.`,
      );
    });

  if (!Number.isSafeInteger(totalQuantity)) {
    errors.push("O total de unidades informadas excede o limite permitido.");
  }

  if (!Number.isSafeInteger(commercialQuantity)) {
    errors.push("O total de caixas com kit excede o limite permitido.");
  }

  return {
    itemLines,
    commercialLines,
    configurationImpacts,
    totalQuantity,
    commercialQuantity,
    isValid: errors.length === 0,
    errors,
  };
}
