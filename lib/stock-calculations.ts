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
