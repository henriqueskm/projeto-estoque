import {
  calculatePhysicalStockSummary,
  type PhysicalStockItemType,
} from "@/lib/stock-calculations";
import type {
  StatisticsComparison,
  StatisticsConfigurationRanking,
  StatisticsData,
  StatisticsItemRanking,
  StatisticsPeriod,
  StatisticsTimelinePoint,
  StatisticsUnmovedConfiguration,
} from "@/lib/statistics-types";

export type StatisticsBatchRow = {
  id: string;
  movement_type:
    | "INBOUND"
    | "OUTBOUND"
    | "ASSEMBLY"
    | "DISASSEMBLY"
    | "ADJUSTMENT"
    | "REVERSAL";
  occurred_at: string;
};

export type StatisticsInboundLineRow = {
  batch_id: string;
  item_id: string | null;
  commercial_configuration_code_id: string | null;
  quantity: number;
};

export type StatisticsOutboundLineRow = StatisticsInboundLineRow & {
  assembled_quantity_used: number;
  auto_assembled_quantity: number;
};

export type StatisticsStockMovementRow = {
  batch_id: string;
  item_id: string;
};

export type StatisticsConfigurationMovementRow = {
  batch_id: string;
  configuration_id: string;
};

export type StatisticsAssemblyOperationRow = {
  batch_id: string;
  configuration_id: string;
  operation_type: "ASSEMBLY" | "DISASSEMBLY";
  quantity: number;
  commercial_code_snapshot: string | null;
};

export type StatisticsItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: PhysicalStockItemType;
  minimum_stock: number;
  is_active: boolean;
};

export type StatisticsConfigurationRow = {
  id: string;
  description: string | null;
  servo_id: string;
  installation_kit_id: string;
  minimum_stock: number;
  is_active: boolean;
};

export type StatisticsCommercialCodeRow = {
  id: string;
  configuration_id: string;
  code: string;
  is_active: boolean;
};

export type StatisticsStockBalanceRow = {
  item_id: string;
  quantity: number;
};

export type StatisticsConfigurationBalanceRow = {
  configuration_id: string;
  quantity: number;
};

export type StatisticsCalculationInput = {
  period: StatisticsPeriod;
  now: Date;
  batches: StatisticsBatchRow[];
  inboundLines: StatisticsInboundLineRow[];
  outboundLines: StatisticsOutboundLineRow[];
  stockMovements: StatisticsStockMovementRow[];
  configurationMovements: StatisticsConfigurationMovementRow[];
  assemblyOperations: StatisticsAssemblyOperationRow[];
  items: StatisticsItemRow[];
  configurations: StatisticsConfigurationRow[];
  commercialCodes: StatisticsCommercialCodeRow[];
  stockBalances: StatisticsStockBalanceRow[];
  configurationBalances: StatisticsConfigurationBalanceRow[];
};

const dayInMilliseconds = 24 * 60 * 60 * 1_000;
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Sao_Paulo",
});
const longDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});
const saoPauloPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function compareCodes(first: string, second: string) {
  return first.localeCompare(second, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function getSaoPauloParts(date: Date) {
  const parts = Object.fromEntries(
    saoPauloPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function saoPauloCalendarStart(year: number, month: number, day: number) {
  const targetUtc = Date.UTC(year, month - 1, day);
  let estimate = targetUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = getSaoPauloParts(new Date(estimate));
    const representedUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    estimate += targetUtc - representedUtc;
  }

  return new Date(estimate);
}

function addSaoPauloCalendarDays(date: Date, days: number) {
  const parts = getSaoPauloParts(date);
  const target = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );

  return saoPauloCalendarStart(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
  );
}

export function createStatisticsRange(period: StatisticsPeriod, now: Date) {
  const todayParts = getSaoPauloParts(now);
  const today = saoPauloCalendarStart(
    todayParts.year,
    todayParts.month,
    todayParts.day,
  );
  const currentStart = addSaoPauloCalendarDays(today, -(period - 1));
  const currentEndExclusive = addSaoPauloCalendarDays(today, 1);
  const previousStart = addSaoPauloCalendarDays(currentStart, -period);

  return {
    currentStart,
    currentEndExclusive,
    previousStart,
    previousEndExclusive: currentStart,
  };
}

function sumQuantities<T extends { quantity: number }>(rows: T[]) {
  return rows.reduce((total, row) => total + row.quantity, 0);
}

function createComparison(
  current: number,
  previous: number,
): StatisticsComparison {
  if (previous === 0) {
    return {
      current,
      previous,
      direction: current === 0 ? "STABLE" : "NO_BASE",
      percentage: null,
    };
  }

  const percentage = ((current - previous) / previous) * 100;

  return {
    current,
    previous,
    direction:
      current > previous ? "UP" : current < previous ? "DOWN" : "STABLE",
    percentage,
  };
}

function aliasesByConfiguration(
  commercialCodes: StatisticsCommercialCodeRow[],
) {
  const aliases = new Map<string, string[]>();

  commercialCodes.forEach((commercialCode) => {
    const configurationAliases =
      aliases.get(commercialCode.configuration_id) ?? [];
    configurationAliases.push(commercialCode.code);
    aliases.set(commercialCode.configuration_id, configurationAliases);
  });

  aliases.forEach((codes) => codes.sort(compareCodes));
  return aliases;
}

function rankItems(
  quantities: Map<string, number>,
  itemById: Map<string, StatisticsItemRow>,
): StatisticsItemRanking[] {
  return [...quantities]
    .flatMap(([itemId, quantity]) => {
      const item = itemById.get(itemId);

      return item && quantity > 0
        ? [
            {
              id: item.id,
              code: item.code,
              description: item.description,
              quantity,
            },
          ]
        : [];
    })
    .sort(
      (first, second) =>
        second.quantity - first.quantity ||
        compareCodes(first.code, second.code) ||
        first.id.localeCompare(second.id),
    );
}

function buildTimeline(
  period: StatisticsPeriod,
  currentStart: Date,
  currentEndExclusive: Date,
  batchesById: Map<string, StatisticsBatchRow>,
  inboundLines: StatisticsInboundLineRow[],
  outboundLines: StatisticsOutboundLineRow[],
): StatisticsTimelinePoint[] {
  const bucketDays = period <= 30 ? 1 : 7;
  const bucketCount = Math.ceil(period / bucketDays);
  const points = Array.from({ length: bucketCount }, (_, index) => {
    const start = addSaoPauloCalendarDays(
      currentStart,
      index * bucketDays,
    );
    const endExclusive = new Date(
      Math.min(
        addSaoPauloCalendarDays(start, bucketDays).getTime(),
        currentEndExclusive.getTime(),
      ),
    );
    const lastDay = addSaoPauloCalendarDays(endExclusive, -1);
    const label =
      bucketDays === 1
        ? shortDateFormatter.format(start).replace(".", "")
        : `${shortDateFormatter.format(start).replace(".", "")}–${shortDateFormatter
            .format(lastDay)
            .replace(".", "")}`;

    return {
      key: start.toISOString(),
      label,
      fullLabel:
        bucketDays === 1
          ? longDateFormatter.format(start)
          : `${longDateFormatter.format(start)} a ${longDateFormatter.format(
              lastDay,
            )}`,
      inbound: 0,
      outbound: 0,
    };
  });

  function bucketIndex(batchId: string) {
    const batch = batchesById.get(batchId);

    if (!batch) {
      return -1;
    }

    return Math.floor(
      (new Date(batch.occurred_at).getTime() - currentStart.getTime()) /
        dayInMilliseconds /
        bucketDays,
    );
  }

  inboundLines.forEach((line) => {
    const index = bucketIndex(line.batch_id);

    if (index >= 0 && index < points.length) {
      points[index].inbound += line.quantity;
    }
  });

  outboundLines.forEach((line) => {
    const index = bucketIndex(line.batch_id);

    if (index >= 0 && index < points.length) {
      points[index].outbound += line.quantity;
    }
  });

  return points;
}

function addQuantity(
  quantities: Map<string, number>,
  id: string,
  quantity: number,
) {
  quantities.set(id, (quantities.get(id) ?? 0) + quantity);
}

function sumMapQuantities(quantities: Map<string, number>) {
  return [...quantities.values()].reduce(
    (total, quantity) => total + quantity,
    0,
  );
}

export function calculateStatistics(
  input: StatisticsCalculationInput,
): StatisticsData {
  const range = createStatisticsRange(input.period, input.now);
  const batchById = new Map(input.batches.map((batch) => [batch.id, batch]));
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const configurationById = new Map(
    input.configurations.map((configuration) => [
      configuration.id,
      configuration,
    ]),
  );
  const commercialCodeById = new Map(
    input.commercialCodes.map((commercialCode) => [
      commercialCode.id,
      commercialCode,
    ]),
  );
  const aliases = aliasesByConfiguration(input.commercialCodes);

  function belongsToRange(
    batchId: string,
    start: Date,
    endExclusive: Date,
    movementType?: StatisticsBatchRow["movement_type"],
  ) {
    const batch = batchById.get(batchId);

    if (!batch || (movementType && batch.movement_type !== movementType)) {
      return false;
    }

    const timestamp = new Date(batch.occurred_at).getTime();
    return timestamp >= start.getTime() && timestamp < endExclusive.getTime();
  }

  const currentInboundLines = input.inboundLines.filter((line) =>
    belongsToRange(
      line.batch_id,
      range.currentStart,
      range.currentEndExclusive,
      "INBOUND",
    ),
  );
  const previousInboundLines = input.inboundLines.filter((line) =>
    belongsToRange(
      line.batch_id,
      range.previousStart,
      range.previousEndExclusive,
      "INBOUND",
    ),
  );
  const currentOutboundLines = input.outboundLines.filter((line) =>
    belongsToRange(
      line.batch_id,
      range.currentStart,
      range.currentEndExclusive,
      "OUTBOUND",
    ),
  );
  const previousOutboundLines = input.outboundLines.filter((line) =>
    belongsToRange(
      line.batch_id,
      range.previousStart,
      range.previousEndExclusive,
      "OUTBOUND",
    ),
  );
  const currentAssemblyOperations = input.assemblyOperations.filter(
    (operation) =>
      belongsToRange(
        operation.batch_id,
        range.currentStart,
        range.currentEndExclusive,
      ),
  );
  const currentBatchIds = new Set(
    input.batches
      .filter((batch) =>
        belongsToRange(
          batch.id,
          range.currentStart,
          range.currentEndExclusive,
        ),
      )
      .map((batch) => batch.id),
  );
  const inbound = sumQuantities(currentInboundLines);
  const outbound = sumQuantities(currentOutboundLines);
  const previousInbound = sumQuantities(previousInboundLines);
  const previousOutbound = sumQuantities(previousOutboundLines);
  const assembled = sumQuantities(
    currentAssemblyOperations.filter(
      (operation) => operation.operation_type === "ASSEMBLY",
    ),
  );
  const disassembled = sumQuantities(
    currentAssemblyOperations.filter(
      (operation) => operation.operation_type === "DISASSEMBLY",
    ),
  );

  // A unidade comercial é a quantidade solicitada nas linhas externas:
  // código comercial = com kit; item SERVO direto = sem kit.
  const withKit = currentOutboundLines
    .filter((line) => line.commercial_configuration_code_id)
    .reduce((total, line) => total + line.quantity, 0);
  const withoutKit = currentOutboundLines
    .filter(
      (line) =>
        line.item_id && itemById.get(line.item_id)?.item_type === "SERVO",
    )
    .reduce((total, line) => total + line.quantity, 0);
  const totalServoSales = withKit + withoutKit;

  const configurationOutbound = new Map<string, number>();
  const looseServoOutbound = new Map<string, number>();
  const looseKitOutbound = new Map<string, number>();
  const repairKitOutbound = new Map<string, number>();
  const loosePartOutbound = new Map<string, number>();

  currentOutboundLines.forEach((line) => {
    if (line.commercial_configuration_code_id) {
      const commercialCode = commercialCodeById.get(
        line.commercial_configuration_code_id,
      );

      if (commercialCode) {
        addQuantity(
          configurationOutbound,
          commercialCode.configuration_id,
          line.quantity,
        );
      }

      return;
    }

    if (!line.item_id) {
      return;
    }

    const itemType = itemById.get(line.item_id)?.item_type;
    const target =
      itemType === "SERVO"
        ? looseServoOutbound
        : itemType === "INSTALLATION_KIT"
          ? looseKitOutbound
          : itemType === "REPAIR_KIT"
            ? repairKitOutbound
            : itemType === "LOOSE_PART"
              ? loosePartOutbound
              : null;

    if (target) {
      addQuantity(target, line.item_id, line.quantity);
    }
  });

  const kitAssemblyUse = new Map<string, number>();

  currentAssemblyOperations
    .filter((operation) => operation.operation_type === "ASSEMBLY")
    .forEach((operation) => {
      const installationKitId = configurationById.get(
        operation.configuration_id,
      )?.installation_kit_id;

      if (installationKitId) {
        addQuantity(kitAssemblyUse, installationKitId, operation.quantity);
      }
    });

  const configurationRankings: StatisticsConfigurationRanking[] = [
    ...configurationOutbound,
  ]
    .flatMap(([configurationId, quantity]) => {
      const configuration = configurationById.get(configurationId);
      const servo = configuration
        ? itemById.get(configuration.servo_id)
        : null;
      const installationKit = configuration
        ? itemById.get(configuration.installation_kit_id)
        : null;

      if (!configuration || !servo || !installationKit || quantity <= 0) {
        return [];
      }

      return [
        {
          id: configuration.id,
          aliases: aliases.get(configuration.id) ?? [],
          description:
            configuration.description?.trim() ||
            `${servo.description} + ${installationKit.code}`,
          servoCode: servo.code,
          installationKitCode: installationKit.code,
          quantity,
        },
      ];
    })
    .sort(
      (first, second) =>
        second.quantity - first.quantity ||
        compareCodes(
          first.aliases[0] ?? first.description,
          second.aliases[0] ?? second.description,
        ) ||
        first.id.localeCompare(second.id),
      );

  const looseServoRankings = rankItems(looseServoOutbound, itemById);
  const kitsUsedInAssembliesRankings = rankItems(kitAssemblyUse, itemById);
  const looseKitRankings = rankItems(looseKitOutbound, itemById);
  const repairKitRankings = rankItems(repairKitOutbound, itemById);
  const loosePartRankings = rankItems(loosePartOutbound, itemById);
  const movedItemIds = new Set(
    input.stockMovements
      .filter((movement) => currentBatchIds.has(movement.batch_id))
      .map((movement) => movement.item_id),
  );
  const movedConfigurationIds = new Set(
    input.configurationMovements
      .filter((movement) => currentBatchIds.has(movement.batch_id))
      .map((movement) => movement.configuration_id),
  );
  const configurationIdsWithActiveAliases = new Set(
    input.commercialCodes
      .filter((commercialCode) => commercialCode.is_active)
      .map((commercialCode) => commercialCode.configuration_id),
  );
  const unmovedConfigurations: StatisticsUnmovedConfiguration[] =
    input.configurations
      .filter((configuration) => {
        const servo = itemById.get(configuration.servo_id);
        const installationKit = itemById.get(
          configuration.installation_kit_id,
        );

        return (
          configuration.is_active &&
          configurationIdsWithActiveAliases.has(configuration.id) &&
          servo?.is_active === true &&
          installationKit?.is_active === true &&
          !movedConfigurationIds.has(configuration.id)
        );
      })
      .flatMap((configuration) => {
        const servo = itemById.get(configuration.servo_id);
        const installationKit = itemById.get(
          configuration.installation_kit_id,
        );

        if (!servo || !installationKit) {
          return [];
        }

        return [
          {
            id: configuration.id,
            aliases: aliases.get(configuration.id) ?? [],
            description:
              configuration.description?.trim() ||
              `${servo.description} + ${installationKit.code}`,
            servoCode: servo.code,
            installationKitCode: installationKit.code,
          },
        ];
      })
      .sort(
        (first, second) =>
          compareCodes(
            first.aliases[0] ?? first.description,
            second.aliases[0] ?? second.description,
          ) || first.id.localeCompare(second.id),
      );
  const unmovedItems = input.items
    .filter((item) => item.is_active && !movedItemIds.has(item.id))
    .map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      itemType: item.item_type,
    }))
    .sort(
      (first, second) =>
        compareCodes(first.code, second.code) ||
        first.id.localeCompare(second.id),
    );

  const currentStock = calculatePhysicalStockSummary(
    input.items.map((item) => ({
      id: item.id,
      itemType: item.item_type,
      minimumStock: item.minimum_stock,
      isActive: item.is_active,
    })),
    input.stockBalances.map((balance) => ({
      itemId: balance.item_id,
      quantity: balance.quantity,
    })),
    input.configurations.map((configuration) => ({
      id: configuration.id,
      servoId: configuration.servo_id,
      installationKitId: configuration.installation_kit_id,
      minimumStock: configuration.minimum_stock,
      isActive:
        configuration.is_active &&
        configurationIdsWithActiveAliases.has(configuration.id) &&
        itemById.get(configuration.servo_id)?.is_active === true &&
        itemById.get(configuration.installation_kit_id)?.is_active === true,
    })),
    input.configurationBalances.map((balance) => ({
      configurationId: balance.configuration_id,
      quantity: balance.quantity,
    })),
  );

  return {
    period: input.period,
    periodStart: range.currentStart.toISOString(),
    periodEndExclusive: range.currentEndExclusive.toISOString(),
    previousPeriodStart: range.previousStart.toISOString(),
    previousPeriodEndExclusive: range.previousEndExclusive.toISOString(),
    totals: { inbound, outbound, assembled, disassembled },
    comparisons: {
      inbound: createComparison(inbound, previousInbound),
      outbound: createComparison(outbound, previousOutbound),
    },
    servoSales: {
      withKit,
      withoutKit,
      total: totalServoSales,
      withKitPercentage:
        totalServoSales > 0 ? (withKit / totalServoSales) * 100 : 0,
      withoutKitPercentage:
        totalServoSales > 0 ? (withoutKit / totalServoSales) * 100 : 0,
    },
    outboundByCategory: {
      completeBoxes: sumMapQuantities(configurationOutbound),
      looseServos: sumMapQuantities(looseServoOutbound),
      looseInstallationKits: sumMapQuantities(looseKitOutbound),
      repairKits: sumMapQuantities(repairKitOutbound),
      looseParts: sumMapQuantities(loosePartOutbound),
    },
    highlights: {
      configuration: configurationRankings[0] ?? null,
      looseServo: looseServoRankings[0] ?? null,
      looseInstallationKit: looseKitRankings[0] ?? null,
      repairKit: repairKitRankings[0] ?? null,
      loosePart: loosePartRankings[0] ?? null,
      withoutMovementTotal:
        unmovedItems.length + unmovedConfigurations.length,
    },
    timeline: buildTimeline(
      input.period,
      range.currentStart,
      range.currentEndExclusive,
      batchById,
      currentInboundLines,
      currentOutboundLines,
    ),
    rankings: {
      configurations: configurationRankings,
      looseServos: looseServoRankings,
      kitsUsedInAssemblies: kitsUsedInAssembliesRankings,
      looseKits: looseKitRankings,
      repairKits: repairKitRankings,
      looseParts: loosePartRankings,
    },
    withoutMovement: {
      items: unmovedItems,
      configurations: unmovedConfigurations,
    },
    currentStock,
  };
}
