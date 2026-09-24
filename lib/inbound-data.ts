import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import {
  type InboundCatalog,
  type InboundCommercialCode,
  type InboundPhysicalItem,
} from "@/lib/inbound-types";
import { loadSharedCatalogSnapshot } from "@/lib/shared-catalog";
import { buildStockCatalogBase } from "@/lib/stock-catalog-base";
import { loadFreshStockBalances } from "@/lib/stock-operational-data";
import { createClient } from "@/lib/supabase/server";

export type InboundCatalogResult =
  | { data: InboundCatalog; error: null }
  | { data: null; error: string };

export async function getInboundCatalog(): Promise<InboundCatalogResult> {
  try {
    const supabase = await createClient();
    const [snapshot, operationalState] = await Promise.all([
      loadSharedCatalogSnapshot(),
      loadFreshStockBalances(supabase),
    ]);
    const { stockBalancesResult, configurationBalancesResult } =
      operationalState;

    if (stockBalancesResult.error || configurationBalancesResult.error) {
      return {
        data: null,
        error: "Não foi possível carregar as opções disponíveis.",
      };
    }

    const base = buildStockCatalogBase(
      snapshot,
      stockBalancesResult.data ?? [],
      configurationBalancesResult.data ?? [],
    );
    const imageUrlByPath = await createCommercialImageUrlMap(
      supabase,
      base.commercialCodes.map((configuration) => configuration.imagePath),
    );
    const physicalItems: InboundPhysicalItem[] = base.physicalItems.map(
      (item) => ({
        kind: "ITEM",
        id: item.id,
        code: item.code,
        description: item.description,
        itemType: item.item_type,
        model: item.model,
        balance: item.balance,
      }),
    );
    const commercialCodes: InboundCommercialCode[] = base.commercialCodes.map(
      (commercialCode) => ({
        kind: "COMMERCIAL_CODE",
        commercialCodeId: commercialCode.id,
        configurationId: commercialCode.configurationId,
        code: commercialCode.code,
        description: commercialCode.description,
        imageUrl: commercialCode.imagePath
          ? (imageUrlByPath.get(commercialCode.imagePath) ?? null)
          : null,
        assembledBalance: commercialCode.assembledBalance,
        aliases: commercialCode.aliases,
        servo: {
          code: commercialCode.servo.code,
          description: commercialCode.servo.description,
          model: commercialCode.servo.model,
        },
        installationKit: {
          code: commercialCode.installationKit.code,
          description: commercialCode.installationKit.description,
        },
      }),
    );

    return { data: { physicalItems, commercialCodes }, error: null };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar as opções disponíveis.",
    };
  }
}
