import "server-only";

import type { AssistantStockEntryTarget, AssistantStockOutputTarget } from "@/lib/assistant-types";
import {
  loadManualStockEntryTargetsByIds,
  resolveManualStockEntryTargets,
} from "@/lib/assistant-stock-entry-data";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type ConfigurationRow = { id: string; servo_id: string; installation_kit_id: string };
type ItemRow = { id: string; code: string; description: string; is_active: boolean };
type BalanceRow = { item_id: string; quantity: number };

function safeQuantity(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function enrichOutputTargets(
  supabase: SupabaseClient,
  targets: AssistantStockEntryTarget[],
) {
  const configurationIds = Array.from(new Set(targets.flatMap((target) =>
    target.kind === "COMMERCIAL_CODE" && target.configurationId ? [target.configurationId] : [])));
  if (!configurationIds.length) {
    return { targets: targets.map((target): AssistantStockOutputTarget => ({ ...target,
      availableStock: target.currentStock, autoAssemblyCapacity: 0, servo: null, installationKit: null })), failed: false };
  }
  const configurationsResult = await supabase.from("commercial_configurations")
    .select("id, servo_id, installation_kit_id").in("id", configurationIds).eq("is_active", true);
  if (configurationsResult.error || (configurationsResult.data?.length ?? 0) !== configurationIds.length) {
    return { targets: [] as AssistantStockOutputTarget[], failed: true };
  }
  const configurations = (configurationsResult.data ?? []) as ConfigurationRow[];
  const componentIds = Array.from(new Set(configurations.flatMap((row) => [row.servo_id, row.installation_kit_id])));
  const [itemsResult, balancesResult] = await Promise.all([
    supabase.from("items").select("id, code, description, is_active").in("id", componentIds).eq("is_active", true),
    supabase.from("stock_balances").select("item_id, quantity").in("item_id", componentIds),
  ]);
  if (itemsResult.error || balancesResult.error || (itemsResult.data?.length ?? 0) !== componentIds.length) {
    return { targets: [] as AssistantStockOutputTarget[], failed: true };
  }
  const configurationById = new Map(configurations.map((row) => [row.id, row]));
  const itemById = new Map(((itemsResult.data ?? []) as ItemRow[]).map((row) => [row.id, row]));
  const balanceById = new Map(((balancesResult.data ?? []) as BalanceRow[]).map((row) => [row.item_id, safeQuantity(row.quantity)]));
  const enriched: AssistantStockOutputTarget[] = [];
  for (const target of targets) {
    if (target.kind === "ITEM") {
      enriched.push({ ...target, availableStock: target.currentStock, autoAssemblyCapacity: 0,
        servo: null, installationKit: null });
      continue;
    }
    const configuration = target.configurationId ? configurationById.get(target.configurationId) : null;
    const servo = configuration ? itemById.get(configuration.servo_id) : null;
    const installationKit = configuration ? itemById.get(configuration.installation_kit_id) : null;
    if (!configuration || !servo || !installationKit) return { targets: [] as AssistantStockOutputTarget[], failed: true };
    const servoStock = balanceById.get(servo.id) ?? 0;
    const kitStock = balanceById.get(installationKit.id) ?? 0;
    const autoAssemblyCapacity = Math.min(servoStock, kitStock);
    enriched.push({ ...target, availableStock: target.currentStock + autoAssemblyCapacity, autoAssemblyCapacity,
      servo: { id: servo.id, code: servo.code, description: servo.description, currentStock: servoStock },
      installationKit: { id: installationKit.id, code: installationKit.code,
        description: installationKit.description, currentStock: kitStock } });
  }
  return { targets: enriched, failed: false };
}

export async function resolveManualStockOutputTargets(
  supabase: SupabaseClient,
  query: string,
  requestedIdentity: "ITEM" | "COMMERCIAL_CODE" | null,
) {
  const resolved = await resolveManualStockEntryTargets(supabase, query, requestedIdentity);
  if (resolved.failed) return { targets: [] as AssistantStockOutputTarget[], failed: true };
  return enrichOutputTargets(supabase, resolved.targets);
}

export async function loadManualStockOutputTargetsByIds(
  supabase: SupabaseClient,
  lines: Array<{ kind: "ITEM" | "COMMERCIAL_CODE"; targetId: string }>,
) {
  const loaded = await loadManualStockEntryTargetsByIds(supabase, lines);
  if (loaded.failed) return { targets: new Map<string, AssistantStockOutputTarget>(), failed: true };
  const ordered = lines.map((line) => loaded.targets.get(`${line.kind}:${line.targetId}`)).filter(Boolean) as AssistantStockEntryTarget[];
  const enriched = await enrichOutputTargets(supabase, ordered);
  const targets = new Map<string, AssistantStockOutputTarget>();
  enriched.targets.forEach((target) => targets.set(`${target.kind}:${target.targetId}`, target));
  return { targets, failed: enriched.failed || targets.size !== lines.length };
}
