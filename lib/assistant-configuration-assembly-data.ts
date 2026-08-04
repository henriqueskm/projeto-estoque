import "server-only";

import type { AssistantConfigurationAssemblyTarget, AssistantStockEntryTarget } from "@/lib/assistant-types";
import { loadManualStockEntryTargetsByIds, resolveManualStockEntryTargets } from "@/lib/assistant-stock-entry-data";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type ConfigurationRow = { id: string; servo_id: string; installation_kit_id: string; is_active: boolean };
type ItemRow = { id: string; code: string; description: string; is_active: boolean };
type BalanceRow = { item_id: string; quantity: number };

function safeQuantity(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
async function enrichTargets(supabase: SupabaseClient, targets: AssistantStockEntryTarget[]) {
  const commercialTargets = targets.filter((target) => target.kind === "COMMERCIAL_CODE" && target.configurationId);
  const configurationIds = Array.from(new Set(commercialTargets.map((target) => target.configurationId!)));
  if (!configurationIds.length) return { targets: [] as AssistantConfigurationAssemblyTarget[], failed: false };
  const configurationsResult = await supabase.from("commercial_configurations")
    .select("id, servo_id, installation_kit_id, is_active").in("id", configurationIds).eq("is_active", true);
  if (configurationsResult.error || (configurationsResult.data?.length ?? 0) !== configurationIds.length) {
    return { targets: [] as AssistantConfigurationAssemblyTarget[], failed: true };
  }
  const configurations = (configurationsResult.data ?? []) as ConfigurationRow[];
  const componentIds = Array.from(new Set(configurations.flatMap((row) => [row.servo_id, row.installation_kit_id])));
  const [itemsResult, balancesResult] = await Promise.all([
    supabase.from("items").select("id, code, description, is_active").in("id", componentIds).eq("is_active", true),
    supabase.from("stock_balances").select("item_id, quantity").in("item_id", componentIds),
  ]);
  if (itemsResult.error || balancesResult.error || (itemsResult.data?.length ?? 0) !== componentIds.length) {
    return { targets: [] as AssistantConfigurationAssemblyTarget[], failed: true };
  }
  const configurationById = new Map(configurations.map((row) => [row.id, row]));
  const itemById = new Map(((itemsResult.data ?? []) as ItemRow[]).map((row) => [row.id, row]));
  const balanceById = new Map(((balancesResult.data ?? []) as BalanceRow[]).map((row) => [row.item_id, safeQuantity(row.quantity)]));
  const enriched: AssistantConfigurationAssemblyTarget[] = [];
  for (const target of commercialTargets) {
    const configuration = configurationById.get(target.configurationId!);
    const servo = configuration ? itemById.get(configuration.servo_id) : null;
    const installationKit = configuration ? itemById.get(configuration.installation_kit_id) : null;
    if (!configuration || !servo || !installationKit) return { targets: [], failed: true };
    const servoStock = balanceById.get(servo.id) ?? 0;
    const installationKitStock = balanceById.get(installationKit.id) ?? 0;
    enriched.push({ commercialCodeId: target.targetId, configurationId: configuration.id,
      displayCode: target.displayCode, aliases: target.aliases, description: target.description,
      currentStock: target.currentStock, capacity: Math.min(servoStock, installationKitStock),
      servo: { id: servo.id, code: servo.code, description: servo.description, currentStock: servoStock },
      installationKit: { id: installationKit.id, code: installationKit.code,
        description: installationKit.description, currentStock: installationKitStock } });
  }
  return { targets: enriched, failed: false };
}

export async function resolveConfigurationAssemblyTargets(supabase: SupabaseClient, query: string) {
  const resolved = await resolveManualStockEntryTargets(supabase, query, "COMMERCIAL_CODE");
  if (resolved.failed) return { targets: [] as AssistantConfigurationAssemblyTarget[], failed: true };
  return enrichTargets(supabase, resolved.targets);
}

export async function loadConfigurationAssemblyTargetByCodeId(
  supabase: SupabaseClient,
  commercialCodeId: string,
) {
  const loaded = await loadManualStockEntryTargetsByIds(supabase,
    [{ kind: "COMMERCIAL_CODE", targetId: commercialCodeId }]);
  const target = loaded.targets.get(`COMMERCIAL_CODE:${commercialCodeId}`);
  if (loaded.failed || !target) return { target: null, failed: true };
  const enriched = await enrichTargets(supabase, [target]);
  return { target: enriched.targets[0] ?? null, failed: enriched.failed || enriched.targets.length !== 1 };
}
