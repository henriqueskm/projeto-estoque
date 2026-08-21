type MountedConfiguration = {
  code: string;
  description: string;
  quantity: number;
};

type MountedConfigurationBreakdown =
  | {
      kind: "complete";
      configurations: readonly MountedConfiguration[];
    }
  | {
      /** A verified example only; it must not be read as the full mounted balance. */
      kind: "partial_reference";
      configurations: readonly MountedConfiguration[];
    };

export type AssistantDemoFixture = {
  inventory: {
    model: string;
    totalQuantity: number;
    mountedQuantity: number;
    mountedConfigurationBreakdown: MountedConfigurationBreakdown;
  };
  statistics: {
    periodDays: number;
    leadingCode: string;
    leadingDescription: string;
    leadingQuantity: number;
  };
};

function assertCompleteBreakdownMatchesMountedQuantity(
  inventory: AssistantDemoFixture["inventory"],
) {
  const breakdown = inventory.mountedConfigurationBreakdown;

  if (breakdown.kind !== "complete") {
    return;
  }

  const configurationsTotal = breakdown.configurations.reduce(
    (total, configuration) => total + configuration.quantity,
    0,
  );

  if (configurationsTotal !== inventory.mountedQuantity) {
    throw new Error("A complete mounted configuration breakdown must match mountedQuantity.");
  }
}

/**
 * Static presentation-only data transcribed from the approved screenshots.
 * It must never be replaced with an operational data source.
 */
export const assistantDemoFixture: AssistantDemoFixture = {
  inventory: {
    model: "MBF-025",
    totalQuantity: 11,
    mountedQuantity: 4,
    // The approved screenshot confirms this one positive balance, but not the
    // complete distribution of all four mounted units.
    mountedConfigurationBreakdown: {
      kind: "partial_reference",
      configurations: [
        {
          code: "2A",
          description: "MBF-025 + KT-18",
          quantity: 3,
        },
      ],
    },
  },
  statistics: {
    periodDays: 30,
    leadingCode: "1B / 1D",
    leadingDescription: "SERVO MBF-015 + KT-02",
    leadingQuantity: 2,
  },
};

assertCompleteBreakdownMatchesMountedQuantity(assistantDemoFixture.inventory);
