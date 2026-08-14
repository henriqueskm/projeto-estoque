export type AssistantDemoFixture = {
  inventory: {
    model: string;
    totalQuantity: number;
    mountedQuantity: number;
    officialConfigurationCodes: readonly string[];
  };
  statistics: {
    periodDays: number;
    leadingCode: string;
    leadingDescription: string;
    leadingQuantity: number;
  };
};

/**
 * Static presentation-only data transcribed from the approved screenshots.
 * It must never be replaced with an operational data source.
 */
export const assistantDemoFixture = {
  inventory: {
    model: "MBF-025",
    totalQuantity: 11,
    mountedQuantity: 4,
    officialConfigurationCodes: ["2A", "2B", "2C", "2D", "2E", "2F", "2H"],
  },
  statistics: {
    periodDays: 30,
    leadingCode: "1B / 1D",
    leadingDescription: "SERVO MBF-015 + KT-02",
    leadingQuantity: 2,
  },
} as const satisfies AssistantDemoFixture;
