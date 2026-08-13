import { physicalItemTypes } from "@/lib/inbound-types";
import type { createClient } from "@/lib/supabase/server";
import type { SupplierOrderPhotoCatalogTarget } from "@/lib/assistant-supplier-order-photo";
export {
  normalizeSupplierOrderPhotoCode,
  resolveSupplierOrderPhotoCatalogCode,
} from "@/lib/assistant-supplier-order-photo-catalog-resolution";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export class SupplierOrderPhotoCatalogError extends Error {}

export async function loadSupplierOrderPhotoCatalog(
  supabase: SupabaseClient,
): Promise<SupplierOrderPhotoCatalogTarget[]> {
  const [itemsResult, configurationsResult, codesResult] = await Promise.all([
    supabase.from("items").select("id, code, description, item_type, is_active")
      .in("item_type", [...physicalItemTypes]).eq("is_active", true),
    supabase.from("commercial_configurations")
      .select("id, description, servo_id, installation_kit_id, is_active").eq("is_active", true),
    supabase.from("commercial_configuration_codes")
      .select("id, code, configuration_id, is_active").eq("is_active", true),
  ]);
  if (itemsResult.error || configurationsResult.error || codesResult.error) {
    throw new SupplierOrderPhotoCatalogError("Catalog read failed");
  }
  const items = (itemsResult.data ?? []) as Array<{
    id: string; code: string; description: string; item_type: string; is_active: boolean;
  }>;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const physicalTargets: SupplierOrderPhotoCatalogTarget[] = items.map((item) => ({
    identity: `ITEM:${item.id}`, codeIdentity: item.id, kind: "ITEM", targetId: item.id,
    commercialConfigurationCodeId: null, code: item.code, description: item.description,
  }));
  const configurationById = new Map(
    ((configurationsResult.data ?? []) as Array<{
      id: string; description: string | null; servo_id: string; installation_kit_id: string; is_active: boolean;
    }>).map((configuration) => [configuration.id, configuration]),
  );
  const configurationTargets = ((codesResult.data ?? []) as Array<{
    id: string; code: string; configuration_id: string; is_active: boolean;
  }>).flatMap((code) => {
    const configuration = configurationById.get(code.configuration_id);
    const servo = configuration ? itemById.get(configuration.servo_id) : null;
    const kit = configuration ? itemById.get(configuration.installation_kit_id) : null;
    if (!configuration || !servo || !kit) return [];
    return [{
      identity: `CONFIGURATION:${configuration.id}`,
      codeIdentity: code.id,
      kind: "COMMERCIAL_CONFIGURATION" as const,
      targetId: configuration.id,
      commercialConfigurationCodeId: code.id,
      code: code.code,
      description: configuration.description?.trim() || `${servo.description} + ${kit.code}`,
    } satisfies SupplierOrderPhotoCatalogTarget];
  });
  return [...physicalTargets, ...configurationTargets];
}
