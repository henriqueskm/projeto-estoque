import { createCommercialImageUrlMap } from "@/lib/commercial-configuration-images";
import type {
  OutboundCatalog,
  OutboundCommercialCode,
  OutboundPhysicalItem,
} from "@/lib/outbound-types";
import { loadSharedCatalogSnapshot } from "@/lib/shared-catalog";
import { buildStockCatalogBase } from "@/lib/stock-catalog-base";
import { loadFreshStockBalances } from "@/lib/stock-operational-data";
import { createClient } from "@/lib/supabase/server";

export type OutboundCatalogResult =
  | { data: OutboundCatalog; error: null }
  | { data: null; error: string };

export async function getOutboundCatalog(): Promise<OutboundCatalogResult> {
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
        error: "Não foi possível carregar as opções disponíveis para saída.",
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
    const physicalItems: OutboundPhysicalItem[] = base.physicalItems.map(
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
    const commercialCodes: OutboundCommercialCode[] = base.commercialCodes.map(
      (commercialCode) => ({
        kind: "COMMERCIAL_CODE",
        commercialCodeId: commercialCode.id,
        code: commercialCode.code,
        configurationId: commercialCode.configurationId,
        description: commercialCode.description,
        imageUrl: commercialCode.imagePath
          ? (imageUrlByPath.get(commercialCode.imagePath) ?? null)
          : null,
        assembledBalance: commercialCode.assembledBalance,
        aliases: commercialCode.aliases,
        servo: {
          id: commercialCode.servo.id,
          code: commercialCode.servo.code,
          description: commercialCode.servo.description,
          model: commercialCode.servo.model,
          balance: commercialCode.servo.balance,
        },
        installationKit: {
          id: commercialCode.installationKit.id,
          code: commercialCode.installationKit.code,
          description: commercialCode.installationKit.description,
          balance: commercialCode.installationKit.balance,
        },
      }),
    );

    return { data: { physicalItems, commercialCodes }, error: null };
  } catch {
    return {
      data: null,
      error: "Não foi possível carregar as opções disponíveis para saída.",
    };
  }
}
