import type {
  SharedCatalogSnapshot,
  SharedCatalogItemRow,
} from "@/lib/shared-catalog";
import type {
  ConfigurationStockBalanceRow,
  StockBalanceRow,
} from "@/lib/stock-operational-data";

function compareCodes(first: { code: string }, second: { code: string }) {
  return first.code.localeCompare(second.code, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

export type StockCatalogBasePhysicalItem = SharedCatalogItemRow & {
  model: string | null;
  balance: number;
};

export type StockCatalogBaseCommercialCode = {
  id: string;
  code: string;
  configurationId: string;
  description: string;
  imagePath: string | null;
  assembledBalance: number;
  aliases: string[];
  servo: StockCatalogBasePhysicalItem;
  installationKit: StockCatalogBasePhysicalItem;
};

export function buildStockCatalogBase(
  snapshot: SharedCatalogSnapshot,
  stockBalances: StockBalanceRow[],
  configurationBalances: ConfigurationStockBalanceRow[],
) {
  const stockByItem = new Map(
    stockBalances.map((balance) => [balance.item_id, balance.quantity]),
  );
  const modelByItemId = new Map(
    snapshot.servoModels.map((servo) => [servo.item_id, servo.model]),
  );
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  const configurationById = new Map(
    snapshot.configurations.map((configuration) => [
      configuration.id,
      configuration,
    ]),
  );
  const stockByConfiguration = new Map(
    configurationBalances.map((balance) => [
      balance.configuration_id,
      balance.quantity,
    ]),
  );
  const activeCodes = snapshot.commercialCodes.filter((code) => code.is_active);
  const codesByConfiguration = new Map<
    string,
    typeof snapshot.commercialCodes
  >();

  activeCodes.forEach((code) => {
    const grouped = codesByConfiguration.get(code.configuration_id) ?? [];
    grouped.push(code);
    codesByConfiguration.set(code.configuration_id, grouped);
  });
  codesByConfiguration.forEach((codes) => codes.sort(compareCodes));

  const physicalItems: StockCatalogBasePhysicalItem[] = snapshot.items
    .filter((item) => item.is_active)
    .map((item) => ({
      ...item,
      model:
        item.item_type === "SERVO"
          ? (modelByItemId.get(item.id) ?? null)
          : null,
      balance: stockByItem.get(item.id) ?? 0,
    }))
    .sort(compareCodes);
  const commercialCodes: StockCatalogBaseCommercialCode[] = activeCodes
    .flatMap((commercialCode) => {
      const configuration = configurationById.get(
        commercialCode.configuration_id,
      );

      if (!configuration?.is_active) return [];

      const servo = itemById.get(configuration.servo_id);
      const installationKit = itemById.get(configuration.installation_kit_id);

      if (
        !servo?.is_active ||
        servo.item_type !== "SERVO" ||
        !installationKit?.is_active ||
        installationKit.item_type !== "INSTALLATION_KIT"
      ) {
        return [];
      }

      const enrichItem = (
        item: SharedCatalogItemRow,
      ): StockCatalogBasePhysicalItem => ({
        ...item,
        model:
          item.item_type === "SERVO"
            ? (modelByItemId.get(item.id) ?? null)
            : null,
        balance: stockByItem.get(item.id) ?? 0,
      });

      return [
        {
          id: commercialCode.id,
          code: commercialCode.code,
          configurationId: configuration.id,
          description:
            configuration.description ??
            `${servo.description} + ${installationKit.code}`,
          imagePath: configuration.image_path,
          assembledBalance: stockByConfiguration.get(configuration.id) ?? 0,
          aliases: (codesByConfiguration.get(configuration.id) ?? [])
            .filter((code) => code.id !== commercialCode.id)
            .map((code) => code.code),
          servo: enrichItem(servo),
          installationKit: enrichItem(installationKit),
        },
      ];
    })
    .sort(compareCodes);

  return { physicalItems, commercialCodes };
}
