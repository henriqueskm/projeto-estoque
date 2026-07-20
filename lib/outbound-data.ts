import { createClient } from "@/lib/supabase/server";
import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import {
  physicalItemTypes,
  type PhysicalItemType,
} from "@/lib/inbound-types";
import type {
  OutboundCatalog,
  OutboundCommercialCode,
  OutboundPhysicalItem,
} from "@/lib/outbound-types";

type ItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: PhysicalItemType;
};

type StockBalanceRow = {
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

export type OutboundCatalogResult =
  | {
      data: OutboundCatalog;
      error: null;
    }
  | {
      data: null;
      error: string;
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
export async function getOutboundCatalog(): Promise<OutboundCatalogResult> {
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
        error: "Não foi possível carregar as opções disponíveis para saída.",
      };
    }

    const items = (itemsResult.data ?? []) as ItemRow[];
    const stockBalances = (stockBalancesResult.data ??
      []) as StockBalanceRow[];
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
      const configurationCodes =
        codesByConfiguration.get(code.configuration_id) ?? [];
      configurationCodes.push(code);
      codesByConfiguration.set(code.configuration_id, configurationCodes);
    });

    const physicalItems: OutboundPhysicalItem[] = items
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

    const commercialCodes: OutboundCommercialCode[] = codes.flatMap(
      (commercialCode) => {
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

        return [
          {
            kind: "COMMERCIAL_CODE" as const,
            commercialCodeId: commercialCode.id,
            code: commercialCode.code,
            configurationId: configuration.id,
            description:
              configuration.description ??
              `${servo.description} + ${installationKit.code}`,
            imageUrl: configuration.image_path
              ? (imageUrlByPath.get(configuration.image_path) ?? null)
              : null,
            assembledBalance:
              stockByConfiguration.get(configuration.id) ?? 0,
            aliases: (codesByConfiguration.get(configuration.id) ?? [])
              .filter((code) => code.id !== commercialCode.id)
              .sort(compareCodes)
              .map((code) => code.code),
            servo: {
              id: servo.id,
              code: servo.code,
              description: servo.description,
              model: servoModelById.get(servo.id) ?? null,
              balance: stockByItem.get(servo.id) ?? 0,
            },
            installationKit: {
              id: installationKit.id,
              code: installationKit.code,
              description: installationKit.description,
              balance: stockByItem.get(installationKit.id) ?? 0,
            },
          },
        ];
      },
    ).sort(compareCodes);

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
      error: "Não foi possível carregar as opções disponíveis para saída.",
    };
  }
}
