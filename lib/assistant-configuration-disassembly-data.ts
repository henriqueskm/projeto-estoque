import "server-only";

import type { AssistantConfigurationDisassemblyTarget } from "@/lib/assistant-types";
import { matchesExactManualStockEntryModel } from "@/lib/ai/manual-stock-entry-routing";
import { normalizeCatalogSearchText } from "@/lib/servo-model-search";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type CodeRow = { id: string; code: string; configuration_id: string };
type ConfigurationRow = { id: string; description: string | null; servo_id: string; installation_kit_id: string };
type ItemRow = { id: string; code: string; description: string };
type BalanceRow = { item_id: string; quantity: number };
type ConfigurationBalanceRow = { configuration_id: string; quantity: number };
type ModelRow = { item_id: string; model: string | null };

function safeQuantity(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function modelLikePattern(value: string) {
  const parts = normalizeCatalogSearchText(value).match(/[a-z]+|\d+/g) ?? [];
  return `%${parts.join("%")}%`;
}

async function buildTargets(supabase: SupabaseClient, codeRows: CodeRow[]) {
  const codeIds = Array.from(new Set(codeRows.map((row) => row.id)));
  const configurationIds = Array.from(new Set(codeRows.map((row) => row.configuration_id)));
  if (!codeIds.length || !configurationIds.length) return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: false };
  const [configurationsResult, configurationBalancesResult, aliasesResult] = await Promise.all([
    supabase.from("commercial_configurations").select("id, description, servo_id, installation_kit_id").in("id", configurationIds),
    supabase.from("configuration_stock_balances").select("configuration_id, quantity").in("configuration_id", configurationIds),
    supabase.from("commercial_configuration_codes").select("id, code, configuration_id").in("configuration_id", configurationIds),
  ]);
  if (configurationsResult.error || configurationBalancesResult.error || aliasesResult.error ||
    (configurationsResult.data?.length ?? 0) !== configurationIds.length) return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: true };
  const configurations = (configurationsResult.data ?? []) as ConfigurationRow[];
  const componentIds = Array.from(new Set(configurations.flatMap((row) => [row.servo_id, row.installation_kit_id])));
  const [itemsResult, balancesResult] = await Promise.all([
    supabase.from("items").select("id, code, description").in("id", componentIds),
    supabase.from("stock_balances").select("item_id, quantity").in("item_id", componentIds),
  ]);
  if (itemsResult.error || balancesResult.error || (itemsResult.data?.length ?? 0) !== componentIds.length) {
    return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: true };
  }
  const configurationById = new Map(configurations.map((row) => [row.id, row]));
  const itemById = new Map(((itemsResult.data ?? []) as ItemRow[]).map((row) => [row.id, row]));
  const stockByItem = new Map(((balancesResult.data ?? []) as BalanceRow[]).map((row) => [row.item_id, safeQuantity(row.quantity)]));
  const mountedByConfiguration = new Map(((configurationBalancesResult.data ?? []) as ConfigurationBalanceRow[])
    .map((row) => [row.configuration_id, safeQuantity(row.quantity)]));
  const aliasesByConfiguration = new Map<string, CodeRow[]>();
  for (const alias of (aliasesResult.data ?? []) as CodeRow[]) {
    aliasesByConfiguration.set(alias.configuration_id, [...(aliasesByConfiguration.get(alias.configuration_id) ?? []), alias]);
  }
  const unique = new Map<string, AssistantConfigurationDisassemblyTarget>();
  for (const selected of codeRows) {
    const configuration = configurationById.get(selected.configuration_id);
    const servo = configuration ? itemById.get(configuration.servo_id) : null;
    const installationKit = configuration ? itemById.get(configuration.installation_kit_id) : null;
    if (!configuration || !servo || !installationKit) return { targets: [], failed: true };
    const aliases = (aliasesByConfiguration.get(configuration.id) ?? []).map((alias) => alias.code)
      .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
    const servoStock = stockByItem.get(servo.id) ?? 0;
    const kitStock = stockByItem.get(installationKit.id) ?? 0;
    const target: AssistantConfigurationDisassemblyTarget = {
      commercialCodeId: selected.id,
      configurationId: configuration.id,
      displayCode: selected.code,
      aliases,
      description: configuration.description ?? `Servo com kit Cód. ${selected.code}`,
      currentStock: mountedByConfiguration.get(configuration.id) ?? 0,
      capacity: Math.min(servoStock, kitStock),
      servo: { id: servo.id, code: servo.code, description: servo.description, currentStock: servoStock },
      installationKit: { id: installationKit.id, code: installationKit.code, description: installationKit.description, currentStock: kitStock },
    };
    if (!unique.has(configuration.id)) unique.set(configuration.id, target);
  }
  return { targets: Array.from(unique.values()), failed: false };
}

export async function resolveConfigurationDisassemblyTargets(supabase: SupabaseClient, query: string) {
  const normalized = query.trim().replace(/^c[oó]d(?:igo)?\.?\s*/iu, "");
  const exactCodes = await supabase.from("commercial_configuration_codes")
    .select("id, code, configuration_id").ilike("code", normalized).limit(10);
  if (exactCodes.error) return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: true };
  if ((exactCodes.data?.length ?? 0) > 0) return buildTargets(supabase, exactCodes.data as CodeRow[]);

  const modelsResult = await supabase.from("servo_models").select("item_id, model")
    .ilike("model", modelLikePattern(normalized)).limit(20);
  if (modelsResult.error) return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: true };
  const matchingModelIds = ((modelsResult.data ?? []) as ModelRow[])
    .filter((model) => matchesExactManualStockEntryModel(normalized, model.model)).map((model) => model.item_id);
  let configurationIds: string[] = [];
  if (matchingModelIds.length) {
    const configurations = await supabase.from("commercial_configurations").select("id").in("servo_id", matchingModelIds).limit(20);
    if (configurations.error) return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: true };
    configurationIds = (configurations.data ?? []).map((row) => row.id as string);
  }
  if (!configurationIds.length) {
    const descriptions = await supabase.from("commercial_configurations").select("id, description")
      .ilike("description", `%${normalized.replace(/[%_]/g, "")}%`).limit(20);
    if (descriptions.error) return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: true };
    configurationIds = (descriptions.data ?? [])
      .filter((row) => normalizeCatalogSearchText(row.description ?? "") === normalizeCatalogSearchText(normalized))
      .map((row) => row.id as string);
  }
  if (!configurationIds.length) return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: false };
  const codes = await supabase.from("commercial_configuration_codes").select("id, code, configuration_id")
    .in("configuration_id", configurationIds).limit(100);
  if (codes.error) return { targets: [] as AssistantConfigurationDisassemblyTarget[], failed: true };
  return buildTargets(supabase, codes.data as CodeRow[]);
}

export async function loadConfigurationDisassemblyTargetByCodeId(supabase: SupabaseClient, commercialCodeId: string) {
  const result = await supabase.from("commercial_configuration_codes").select("id, code, configuration_id")
    .eq("id", commercialCodeId).maybeSingle();
  if (result.error || !result.data) return { target: null, failed: true };
  const enriched = await buildTargets(supabase, [result.data as CodeRow]);
  return { target: enriched.targets[0] ?? null, failed: enriched.failed || enriched.targets.length !== 1 };
}
