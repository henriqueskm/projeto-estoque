import type {
  PhysicalStockItemType,
  PhysicalStockSummary,
} from "@/lib/stock-calculations";

export const statisticsPeriods = [7, 30, 90] as const;

export type StatisticsPeriod = (typeof statisticsPeriods)[number];

export type StatisticsSearchParams = {
  periodo?: string | string[];
};

export type StatisticsComparison = {
  current: number;
  previous: number;
  direction: "UP" | "DOWN" | "STABLE" | "NO_BASE";
  percentage: number | null;
};

export type StatisticsTimelinePoint = {
  key: string;
  label: string;
  fullLabel: string;
  inbound: number;
  outbound: number;
};

export type StatisticsItemRanking = {
  id: string;
  code: string;
  description: string;
  quantity: number;
};

export type StatisticsConfigurationRanking = {
  id: string;
  aliases: string[];
  description: string;
  servoCode: string;
  installationKitCode: string;
  quantity: number;
};

export type StatisticsUnmovedItem = {
  id: string;
  code: string;
  description: string;
  itemType: PhysicalStockItemType;
};

export type StatisticsUnmovedConfiguration = {
  id: string;
  aliases: string[];
  description: string;
  servoCode: string;
  installationKitCode: string;
};

export type StatisticsData = {
  period: StatisticsPeriod;
  periodStart: string;
  periodEndExclusive: string;
  previousPeriodStart: string;
  previousPeriodEndExclusive: string;
  totals: {
    inbound: number;
    outbound: number;
    assembled: number;
    disassembled: number;
  };
  comparisons: {
    inbound: StatisticsComparison;
    outbound: StatisticsComparison;
  };
  servoSales: {
    withKit: number;
    withoutKit: number;
    total: number;
    withKitPercentage: number;
    withoutKitPercentage: number;
  };
  outboundByCategory: {
    completeBoxes: number;
    looseServos: number;
    looseInstallationKits: number;
    repairKits: number;
    looseParts: number;
  };
  highlights: {
    configuration: StatisticsConfigurationRanking | null;
    looseServo: StatisticsItemRanking | null;
    looseInstallationKit: StatisticsItemRanking | null;
    repairKit: StatisticsItemRanking | null;
    loosePart: StatisticsItemRanking | null;
    withoutMovementTotal: number;
  };
  timeline: StatisticsTimelinePoint[];
  rankings: {
    configurations: StatisticsConfigurationRanking[];
    looseServos: StatisticsItemRanking[];
    kitsUsedInAssemblies: StatisticsItemRanking[];
    looseKits: StatisticsItemRanking[];
    repairKits: StatisticsItemRanking[];
    looseParts: StatisticsItemRanking[];
  };
  withoutMovement: {
    items: StatisticsUnmovedItem[];
    configurations: StatisticsUnmovedConfiguration[];
  };
  currentStock: PhysicalStockSummary;
};

export type StatisticsDataResult =
  | { data: StatisticsData; error: null }
  | { data: null; error: string };
