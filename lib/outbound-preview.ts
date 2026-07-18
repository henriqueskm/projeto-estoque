import type {
  OutboundCatalogOption,
  OutboundCommercialCode,
  OutboundPhysicalItem,
} from "@/lib/outbound-types";

const maximumQuantity = 2_147_483_647;

export type OutboundPreviewInputLine = {
  option: OutboundCatalogOption;
  quantity: number;
};

export type OutboundItemLinePreview = {
  option: OutboundPhysicalItem;
  requestedQuantity: number;
  totalPhysicalConsumption: number;
  predictedBalance: number;
  isSufficient: boolean;
};

export type OutboundCommercialLinePreview = {
  option: OutboundCommercialCode;
  requestedQuantity: number;
  assembledQuantityUsed: number;
  autoAssembledQuantity: number;
};

export type OutboundPhysicalRequirement = {
  item: {
    id: string;
    code: string;
    description: string;
    balance: number;
  };
  directQuantity: number;
  autoAssemblyQuantity: number;
  totalQuantity: number;
  predictedBalance: number;
  isSufficient: boolean;
};

export type OutboundPreview = {
  itemLines: OutboundItemLinePreview[];
  commercialLines: OutboundCommercialLinePreview[];
  physicalRequirements: OutboundPhysicalRequirement[];
  totalQuantity: number;
  autoAssembledQuantity: number;
  isValid: boolean;
  errors: string[];
};

type MutablePhysicalRequirement = {
  item: OutboundPhysicalRequirement["item"];
  directQuantity: number;
  autoAssemblyQuantity: number;
};

function compareCommercialLines(
  first: OutboundPreviewInputLine & { option: OutboundCommercialCode },
  second: OutboundPreviewInputLine & { option: OutboundCommercialCode },
) {
  if (first.option.code !== second.option.code) {
    return first.option.code < second.option.code ? -1 : 1;
  }

  if (
    first.option.commercialCodeId === second.option.commercialCodeId
  ) {
    return 0;
  }

  return first.option.commercialCodeId <
    second.option.commercialCodeId
    ? -1
    : 1;
}

function addPhysicalRequirement(
  requirements: Map<string, MutablePhysicalRequirement>,
  item: OutboundPhysicalRequirement["item"],
  quantity: number,
  source: "direct" | "automatic",
) {
  const current = requirements.get(item.id) ?? {
    item,
    directQuantity: 0,
    autoAssemblyQuantity: 0,
  };

  if (source === "direct") {
    current.directQuantity += quantity;
  } else {
    current.autoAssemblyQuantity += quantity;
  }

  requirements.set(item.id, current);
}

export function buildOutboundPreview(
  lines: OutboundPreviewInputLine[],
): OutboundPreview {
  const itemLines = lines.filter(
    (
      line,
    ): line is OutboundPreviewInputLine & {
      option: OutboundPhysicalItem;
    } => line.option.kind === "ITEM",
  );
  const commercialLines = lines
    .filter(
      (
        line,
      ): line is OutboundPreviewInputLine & {
        option: OutboundCommercialCode;
      } => line.option.kind === "COMMERCIAL_CODE",
    )
    .sort(compareCommercialLines);
  const requirements = new Map<string, MutablePhysicalRequirement>();

  itemLines.forEach((line) => {
    addPhysicalRequirement(
      requirements,
      line.option,
      line.quantity,
      "direct",
    );
  });

  const commercialByConfiguration = new Map<
    string,
    Array<
      OutboundPreviewInputLine & {
        option: OutboundCommercialCode;
      }
    >
  >();

  commercialLines.forEach((line) => {
    const grouped =
      commercialByConfiguration.get(line.option.configurationId) ?? [];
    grouped.push(line);
    commercialByConfiguration.set(line.option.configurationId, grouped);
  });

  const commercialPreviewById = new Map<
    string,
    OutboundCommercialLinePreview
  >();
  const configurationOverflowCodes: string[] = [];
  let autoAssembledQuantity = 0;

  commercialByConfiguration.forEach((configurationLines) => {
    const firstLine = configurationLines[0];
    const requestedForConfiguration = configurationLines.reduce(
      (total, line) => total + line.quantity,
      0,
    );
    let availableMounted = firstLine.option.assembledBalance;

    if (
      !Number.isSafeInteger(requestedForConfiguration) ||
      requestedForConfiguration > maximumQuantity
    ) {
      configurationOverflowCodes.push(
        configurationLines.map((line) => line.option.code).join(", "),
      );
    }

    configurationLines.sort(compareCommercialLines).forEach((line) => {
      const assembledQuantityUsed = Math.min(
        line.quantity,
        availableMounted,
      );
      const autoAssembledForLine =
        line.quantity - assembledQuantityUsed;

      availableMounted -= assembledQuantityUsed;
      autoAssembledQuantity += autoAssembledForLine;

      if (autoAssembledForLine > 0) {
        addPhysicalRequirement(
          requirements,
          line.option.servo,
          autoAssembledForLine,
          "automatic",
        );
        addPhysicalRequirement(
          requirements,
          line.option.installationKit,
          autoAssembledForLine,
          "automatic",
        );
      }

      commercialPreviewById.set(line.option.commercialCodeId, {
        option: line.option,
        requestedQuantity: line.quantity,
        assembledQuantityUsed,
        autoAssembledQuantity: autoAssembledForLine,
      });
    });
  });

  const physicalRequirements = Array.from(requirements.values())
    .map((requirement): OutboundPhysicalRequirement => {
      const totalQuantity =
        requirement.directQuantity + requirement.autoAssemblyQuantity;
      const predictedBalance = requirement.item.balance - totalQuantity;

      return {
        ...requirement,
        totalQuantity,
        predictedBalance,
        isSufficient:
          Number.isSafeInteger(totalQuantity) &&
          totalQuantity <= maximumQuantity &&
          predictedBalance >= 0,
      };
    })
    .sort((first, second) =>
      first.item.code.localeCompare(second.item.code, "pt-BR", {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const requirementByItem = new Map(
    physicalRequirements.map((requirement) => [
      requirement.item.id,
      requirement,
    ]),
  );
  const errors = physicalRequirements
    .filter((requirement) => !requirement.isSufficient)
    .map((requirement) =>
      requirement.totalQuantity > maximumQuantity
        ? `A necessidade total de ${requirement.item.code} excede o limite permitido.`
        : `Saldo insuficiente de ${requirement.item.code}: são necessárias ${requirement.totalQuantity} unidades e há ${requirement.item.balance}.`,
    );
  configurationOverflowCodes.forEach((codes) => {
    errors.push(
      `A quantidade total da configuração compartilhada por ${codes} excede o limite permitido.`,
    );
  });
  const totalQuantity = lines.reduce(
    (total, line) => total + line.quantity,
    0,
  );

  if (!Number.isSafeInteger(totalQuantity)) {
    errors.push("O total de unidades excede o limite permitido.");
  }

  if (!Number.isSafeInteger(autoAssembledQuantity)) {
    errors.push("O total de montagens automáticas excede o limite permitido.");
  }

  return {
    itemLines: itemLines.map((line) => {
      const requirement = requirementByItem.get(line.option.id);

      return {
        option: line.option,
        requestedQuantity: line.quantity,
        totalPhysicalConsumption:
          requirement?.totalQuantity ?? line.quantity,
        predictedBalance:
          requirement?.predictedBalance ??
          line.option.balance - line.quantity,
        isSufficient: requirement?.isSufficient ?? false,
      };
    }),
    commercialLines: commercialLines.map(
      (line) =>
        commercialPreviewById.get(line.option.commercialCodeId) ?? {
          option: line.option,
          requestedQuantity: line.quantity,
          assembledQuantityUsed: 0,
          autoAssembledQuantity: line.quantity,
        },
    ),
    physicalRequirements,
    totalQuantity,
    autoAssembledQuantity,
    isValid: errors.length === 0,
    errors,
  };
}
