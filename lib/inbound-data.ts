import { createClient } from "@/lib/supabase/server";
import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import {
  physicalItemTypes,
  type InboundCatalog,
  type InboundCommercialCode,
  type InboundPhysicalItem,
  type PhysicalItemType,
} from "@/lib/inbound-types";

type ItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: PhysicalItemType;
};

type BalanceRow = {
  item_id: string;
  quantity: number;
};

type CommercialCodeRow = {
  id: string;
  code: string;
  configuration_id: string;
};

type CommercialConfigurationRow = {
  id: string;
  description: string | null;
  image_path: string | null;
  servo_id: string;
  installation_kit_id: string;
};

type ServoModelRow = {
  item_id: string;
  model: string | null;
};

type ConfigurationBalanceRow = {
  configuration_id: string;
  quantity: number;
};

export type InboundCatalogResult =
  | {
      data: InboundCatalog;
      error: null;
    }
  | {
      data: null;
      error: string;
    };

function compareCodes(first: { code: string }, second: { code: string }) {
  return first.code.localeCompare(second.code, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

export async function getInboundCatalog(): Promise<InboundCatalogResult> {
  try {
    const supabase = await createClient();
    const [
      itemsResult,
      stockBalancesResult,
      codesResult,
      configurationsResult,
      servoModelsResult,
      configurationBalancesResult,
    ] = await Promise.all([
      supabase
        .from("items")
        .select("id, code, description, item_type")
        .eq("is_active", true)
        .in("item_type", [...physicalItemTypes]),
      supabase.from("stock_balances").select("item_id, quantity"),
      supabase
        .from("commercial_configuration_codes")
        .select("id, code, configuration_id")
        .eq("is_active", true),
      supabase
        .from("commercial_configurations")
        .select("id, description, image_path, servo_id, installation_kit_id")
        .eq("is_active", true),
      supabase.from("servo_models").select("item_id, model"),
      supabase
        .from("configuration_stock_balances")
        .select("configuration_id, quantity"),
    ]);

    const readError = [
      itemsResult.error,
      stockBalancesResult.error,
      codesResult.error,
      configurationsResult.error,
      servoModelsResult.error,
      configurationBalancesResult.error,
    ].find(Boolean);

    if (readError) {
      return {
        data: null,
        error: "Não foi possível carregar as opções disponíveis.",
      };
    }

    const items = (itemsResult.data ?? []) as ItemRow[];
    const stockBalances = (stockBalancesResult.data ?? []) as BalanceRow[];
    const codes = (codesResult.data ?? []) as CommercialCodeRow[];
    const configurations = (configurationsResult.data ??
      []) as CommercialConfigurationRow[];
    const servoModels = (servoModelsResult.data ?? []) as ServoModelRow[];
    const configurationBalances = (configurationBalancesResult.data ??
      []) as ConfigurationBalanceRow[];
    const imageUrlByPath = await createCommercialImageUrlMap(
      supabase,
      configurations.map((configuration) => configuration.image_path),
    );

    const stockByItem = new Map(
      stockBalances.map((balance) => [balance.item_id, balance.quantity]),
    );
    const itemById = new Map(items.map((item) => [item.id, item]));
    const configurationById = new Map(
      configurations.map((configuration) => [
        configuration.id,
        configuration,
      ]),
    );
    const servoModelById = new Map(
      servoModels.map((servo) => [servo.item_id, servo.model]),
    );
    const stockByConfiguration = new Map(
      configurationBalances.map((balance) => [
        balance.configuration_id,
        balance.quantity,
      ]),
    );
    const codesByConfiguration = new Map<string, CommercialCodeRow[]>();

    codes.forEach((code) => {
      const grouped = codesByConfiguration.get(code.configuration_id) ?? [];
      grouped.push(code);
      codesByConfiguration.set(code.configuration_id, grouped);
    });

    codesByConfiguration.forEach((groupedCodes) => {
      groupedCodes.sort(compareCodes);
    });

    const physicalItems: InboundPhysicalItem[] = items
      .map((item) => ({
        kind: "ITEM" as const,
        id: item.id,
        code: item.code,
        description: item.description,
        itemType: item.item_type,
        model:
          item.item_type === "SERVO"
            ? (servoModelById.get(item.id) ?? null)
            : null,
        balance: stockByItem.get(item.id) ?? 0,
      }))
      .sort(compareCodes);

    const commercialCodes: InboundCommercialCode[] = codes
      .flatMap((commercialCode) => {
        const configuration = configurationById.get(
          commercialCode.configuration_id,
        );

        if (!configuration) {
          return [];
        }

        const servo = itemById.get(configuration.servo_id);
        const installationKit = itemById.get(
          configuration.installation_kit_id,
        );

        if (
          !servo ||
          servo.item_type !== "SERVO" ||
          !installationKit ||
          installationKit.item_type !== "INSTALLATION_KIT"
        ) {
          return [];
        }

        const aliases = (
          codesByConfiguration.get(configuration.id) ?? []
        )
          .filter((code) => code.id !== commercialCode.id)
          .map((code) => code.code);

        return [
          {
            kind: "COMMERCIAL_CODE" as const,
            commercialCodeId: commercialCode.id,
            configurationId: configuration.id,
            code: commercialCode.code,
            description:
              configuration.description ??
              `${servo.description} + ${installationKit.code}`,
            imageUrl: configuration.image_path
              ? (imageUrlByPath.get(configuration.image_path) ?? null)
              : null,
            assembledBalance:
              stockByConfiguration.get(configuration.id) ?? 0,
            aliases,
            servo: {
              code: servo.code,
              description: servo.description,
              model: servoModelById.get(servo.id) ?? null,
            },
            installationKit: {
              code: installationKit.code,
              description: installationKit.description,
            },
          },
        ];
      })
      .sort(compareCodes);

    return {
      data: {
        physicalItems,
        commercialCodes,
      },
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar as opções disponíveis.",
    };
  }
}
