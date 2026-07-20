export type PhysicalStockItemType =
  | "SERVO"
  | "INSTALLATION_KIT"
  | "REPAIR_KIT"
  | "LOOSE_PART";

export type PhysicalStockCalculation = {
  looseQuantity: number;
  mountedQuantity: number;
  totalQuantity: number;
};

type PhysicalStockItem = {
  id: string;
  itemType: PhysicalStockItemType;
};

type LooseStockBalance = {
  itemId: string;
  quantity: number;
};

type PhysicalConfiguration = {
  id: string;
  servoId: string;
  installationKitId: string;
};

type MountedConfigurationBalance = {
  configurationId: string;
  quantity: number;
};

type PhysicalStockSummaryItem = PhysicalStockItem & {
  minimumStock: number;
  isActive: boolean;
};

export type PhysicalStockSummary = {
  completeBoxesTotal: number;
  looseServoTotal: number;
  looseKitTotal: number;
  repairKitTotal: number;
  loosePartTotal: number;
  lowStockItems: number;
  outOfStockItems: number;
};

function addQuantity(map: Map<string, number>, id: string, quantity: number) {
  map.set(id, (map.get(id) ?? 0) + quantity);
}

export function calculatePhysicalStockByItem(
  items: PhysicalStockItem[],
  looseBalances: LooseStockBalance[],
  configurations: PhysicalConfiguration[],
  mountedBalances: MountedConfigurationBalance[],
) {
  const looseByItem = new Map(
    looseBalances.map((balance) => [balance.itemId, balance.quantity]),
  );
  const mountedByConfiguration = new Map(
    mountedBalances.map((balance) => [
      balance.configurationId,
      balance.quantity,
    ]),
  );
  const mountedByServo = new Map<string, number>();
  const mountedByInstallationKit = new Map<string, number>();

  configurations.forEach((configuration) => {
    const quantity = mountedByConfiguration.get(configuration.id) ?? 0;

    addQuantity(mountedByServo, configuration.servoId, quantity);
    addQuantity(
      mountedByInstallationKit,
      configuration.installationKitId,
      quantity,
    );
  });

  return new Map<string, PhysicalStockCalculation>(
    items.map((item) => {
      const looseQuantity = looseByItem.get(item.id) ?? 0;
      const mountedQuantity =
        item.itemType === "SERVO"
          ? (mountedByServo.get(item.id) ?? 0)
          : item.itemType === "INSTALLATION_KIT"
            ? (mountedByInstallationKit.get(item.id) ?? 0)
            : 0;

      return [
        item.id,
        {
          looseQuantity,
          mountedQuantity,
          totalQuantity: looseQuantity + mountedQuantity,
        },
      ];
    }),
  );
}

export function calculatePhysicalStockSummary(
  items: PhysicalStockSummaryItem[],
  looseBalances: LooseStockBalance[],
  configurations: PhysicalConfiguration[],
  mountedBalances: MountedConfigurationBalance[],
): PhysicalStockSummary {
  const physicalStockByItem = calculatePhysicalStockByItem(
    items,
    looseBalances,
    configurations,
    mountedBalances,
  );
  const physicalQuantity = (item: PhysicalStockSummaryItem) =>
    physicalStockByItem.get(item.id)?.totalQuantity ?? 0;
  const looseQuantity = (item: PhysicalStockSummaryItem) =>
    physicalStockByItem.get(item.id)?.looseQuantity ?? 0;

  return {
    completeBoxesTotal: mountedBalances.reduce(
      (total, balance) => total + balance.quantity,
      0,
    ),
    looseServoTotal: items
      .filter((item) => item.itemType === "SERVO")
      .reduce((total, item) => total + looseQuantity(item), 0),
    looseKitTotal: items
      .filter((item) => item.itemType === "INSTALLATION_KIT")
      .reduce((total, item) => total + looseQuantity(item), 0),
    repairKitTotal: items
      .filter((item) => item.itemType === "REPAIR_KIT")
      .reduce((total, item) => total + looseQuantity(item), 0),
    loosePartTotal: items
      .filter((item) => item.itemType === "LOOSE_PART")
      .reduce((total, item) => total + looseQuantity(item), 0),
    lowStockItems: items.filter(
      (item) =>
        item.isActive &&
        item.minimumStock > 0 &&
        physicalQuantity(item) > 0 &&
        physicalQuantity(item) <= item.minimumStock,
    ).length,
    outOfStockItems: items.filter(
      (item) => item.isActive && physicalQuantity(item) === 0,
    ).length,
  };
}
