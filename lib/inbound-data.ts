import { createClient } from "@/lib/supabase/server";
import {
  physicalItemTypes,
  type InboundCatalogItem,
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

export type InboundCatalogResult =
  | {
      data: InboundCatalogItem[];
      error: null;
    }
  | {
      data: null;
      error: string;
    };

export async function getInboundCatalog(): Promise<InboundCatalogResult> {
  const supabase = await createClient();

  const [itemsResult, balancesResult] = await Promise.all([
    supabase
      .from("items")
      .select("id, code, description, item_type")
      .eq("is_active", true)
      .in("item_type", [...physicalItemTypes])
      .order("code", { ascending: true }),
    supabase.from("stock_balances").select("item_id, quantity"),
  ]);

  if (itemsResult.error || balancesResult.error) {
    return {
      data: null,
      error: "Não foi possível carregar os itens disponíveis.",
    };
  }

  const balancesByItem = new Map(
    ((balancesResult.data ?? []) as BalanceRow[]).map((row) => [
      row.item_id,
      row.quantity,
    ]),
  );

  return {
    data: ((itemsResult.data ?? []) as ItemRow[]).map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      itemType: item.item_type,
      balance: balancesByItem.get(item.id) ?? 0,
    })),
    error: null,
  };
}
