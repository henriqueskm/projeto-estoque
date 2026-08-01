import "server-only";

import type { AssistantStockEntryTarget } from "@/lib/assistant-types";
import type { SupplierOrderItem } from "@/lib/supplier-orders-types";
import { normalizeCatalogSearchText, matchesCatalogDescription, matchesServoModel } from "@/lib/servo-model-search";
import { matchesExactManualStockEntryModel } from "@/lib/ai/manual-stock-entry-routing";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type ItemRow = { id: string; code: string; description: string; item_type: "SERVO" | "INSTALLATION_KIT" | "REPAIR_KIT" | "LOOSE_PART"; is_active: boolean };
type CodeRow = { id: string; code: string; configuration_id: string; is_active: boolean };
type ConfigurationRow = { id: string; description: string | null; servo_id: string; installation_kit_id: string; is_active: boolean };
type ModelRow = { item_id: string; model: string | null };
type BalanceRow = { item_id: string; quantity: number };
type ConfigurationBalanceRow = { configuration_id: string; quantity: number };

const typeLabels: Record<ItemRow["item_type"], string> = {
  SERVO: "Servo sem kit",
  INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Kit de reparo",
  LOOSE_PART: "Peça avulsa",
};

function safeQuantity(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function supplierOrderItemDisplayCode(item: SupplierOrderItem) {
  return item.commercialCodeSnapshot ?? item.codeSnapshot;
}

function itemMatchPriority(item: SupplierOrderItem, query: string) {
  const normalized = normalizeCatalogSearchText(query);
  if (normalizeCatalogSearchText(supplierOrderItemDisplayCode(item)) === normalized ||
      normalizeCatalogSearchText(item.codeSnapshot) === normalized) return 1;
  if (matchesServoModel(query, item.modelSnapshot)) return 2;
  if (matchesCatalogDescription(query, item.descriptionSnapshot)) return 3;
  return null;
}

export function resolveSupplierOrderLines(items: SupplierOrderItem[], query: string) {
  const candidates = items.map((item) => ({ item, priority: itemMatchPriority(item, query) }))
    .filter((candidate): candidate is { item: SupplierOrderItem; priority: number } => candidate.priority !== null);
  if (!candidates.length) return [];
  const priority = Math.min(...candidates.map((candidate) => candidate.priority));
  return candidates.filter((candidate) => candidate.priority === priority).map((candidate) => candidate.item);
}

export async function loadTargetsForSupplierOrderItems(
  supabase: SupabaseClient,
  items: SupplierOrderItem[],
) {
  const itemIds = Array.from(new Set(items.flatMap((item) => item.itemId ? [item.itemId] : [])));
  const configurationIds = Array.from(new Set(items.flatMap((item) => item.commercialConfigurationId ? [item.commercialConfigurationId] : [])));
  const [itemsResult, itemBalancesResult, configurationsResult, configurationBalancesResult, codesResult, modelsResult] = await Promise.all([
    itemIds.length ? supabase.from("items").select("id, code, description, item_type, is_active").in("id", itemIds) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? supabase.from("stock_balances").select("item_id, quantity").in("item_id", itemIds) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? supabase.from("commercial_configurations").select("id, description, servo_id, installation_kit_id, is_active").in("id", configurationIds) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? supabase.from("configuration_stock_balances").select("configuration_id, quantity").in("configuration_id", configurationIds) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? supabase.from("commercial_configuration_codes").select("id, code, configuration_id, is_active").in("configuration_id", configurationIds).eq("is_active", true) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? supabase.from("servo_models").select("item_id, model").in("item_id", itemIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([itemsResult.error, itemBalancesResult.error, configurationsResult.error, configurationBalancesResult.error, codesResult.error, modelsResult.error].some(Boolean)) {
    return { targets: new Map<string, AssistantStockEntryTarget>(), failed: true };
  }
  const itemById = new Map(((itemsResult.data ?? []) as ItemRow[]).map((item) => [item.id, item]));
  const itemBalance = new Map(((itemBalancesResult.data ?? []) as BalanceRow[]).map((row) => [row.item_id, safeQuantity(row.quantity)]));
  const configurationById = new Map(((configurationsResult.data ?? []) as ConfigurationRow[]).map((row) => [row.id, row]));
  const configurationBalance = new Map(((configurationBalancesResult.data ?? []) as ConfigurationBalanceRow[]).map((row) => [row.configuration_id, safeQuantity(row.quantity)]));
  const modelByItem = new Map(((modelsResult.data ?? []) as ModelRow[]).map((row) => [row.item_id, row.model]));
  const codesByConfiguration = new Map<string, CodeRow[]>();
  ((codesResult.data ?? []) as CodeRow[]).forEach((code) => codesByConfiguration.set(code.configuration_id, [...(codesByConfiguration.get(code.configuration_id) ?? []), code]));
  const targets = new Map<string, AssistantStockEntryTarget>();
  for (const orderItem of items) {
    if (orderItem.itemId) {
      const item = itemById.get(orderItem.itemId);
      if (!item?.is_active) continue;
      targets.set(orderItem.id, { kind: "ITEM", targetId: item.id, configurationId: null,
        displayCode: orderItem.codeSnapshot, aliases: [], typeLabel: typeLabels[item.item_type],
        description: orderItem.descriptionSnapshot, detail: modelByItem.get(item.id) ?? null,
        currentStock: itemBalance.get(item.id) ?? 0 });
      continue;
    }
    const configurationId = orderItem.commercialConfigurationId;
    if (!configurationId) continue;
    const configuration = configurationById.get(configurationId);
    const codes = (codesByConfiguration.get(configurationId) ?? []).sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
    const selected = codes.find((code) => code.id === orderItem.commercialConfigurationCodeId) ?? codes[0];
    if (!configuration?.is_active || !selected) continue;
    targets.set(orderItem.id, { kind: "COMMERCIAL_CODE", targetId: selected.id, configurationId,
      displayCode: orderItem.commercialCodeSnapshot ?? selected.code, aliases: codes.map((code) => code.code),
      typeLabel: "Servo com kit", description: orderItem.descriptionSnapshot,
      detail: orderItem.modelSnapshot, currentStock: configurationBalance.get(configurationId) ?? 0 });
  }
  return { targets, failed: false };
}

function modelLikePattern(value: string) {
  const parts = normalizeCatalogSearchText(value).match(/[a-z]+|\d+/g) ?? [];
  return `%${parts.join("%")}%`;
}

export async function resolveManualStockEntryTargets(
  supabase: SupabaseClient,
  query: string,
  requestedIdentity: "ITEM" | "COMMERCIAL_CODE" | null,
) {
  const normalized = query.trim().replace(/^c[oó]d(?:igo)?\.?\s*/iu, "");
  const commercialPromise = requestedIdentity === "ITEM"
    ? Promise.resolve({ data: [], error: null })
    : supabase.from("commercial_configuration_codes").select("id, code, configuration_id, is_active").ilike("code", normalized).eq("is_active", true).limit(10);
  const itemPromise = requestedIdentity === "COMMERCIAL_CODE"
    ? Promise.resolve({ data: [], error: null })
    : supabase.from("items").select("id, code, description, item_type, is_active").ilike("code", normalized).eq("is_active", true).limit(10);
  const modelPromise = supabase.from("servo_models").select("item_id, model")
    .ilike("model", modelLikePattern(normalized)).limit(20);
  const [codesResult, exactItemsResult, modelsResult] = await Promise.all([commercialPromise, itemPromise, modelPromise]);
  if (codesResult.error || exactItemsResult.error || modelsResult.error) return { targets: [], failed: true };
  let items = (exactItemsResult.data ?? []) as ItemRow[];
  const models = ((modelsResult.data ?? []) as ModelRow[])
    .filter((model) => matchesExactManualStockEntryModel(normalized, model.model));
  if (requestedIdentity !== "COMMERCIAL_CODE" && !items.length && models.length) {
    const result = await supabase.from("items").select("id, code, description, item_type, is_active").in("id", models.map((model) => model.item_id)).eq("is_active", true);
    if (result.error) return { targets: [], failed: true };
    items = (result.data ?? []) as ItemRow[];
  }
  let codes = (codesResult.data ?? []) as CodeRow[];
  if (requestedIdentity === "COMMERCIAL_CODE" && !codes.length && models.length) {
    const configurationResult = await supabase.from("commercial_configurations")
      .select("id").in("servo_id", models.map((model) => model.item_id)).eq("is_active", true).limit(50);
    if (configurationResult.error) return { targets: [], failed: true };
    const matchingConfigurationIds = (configurationResult.data ?? []).map((row) => row.id as string);
    if (matchingConfigurationIds.length) {
      const matchingCodesResult = await supabase.from("commercial_configuration_codes")
        .select("id, code, configuration_id, is_active").in("configuration_id", matchingConfigurationIds)
        .eq("is_active", true).limit(100);
      if (matchingCodesResult.error) return { targets: [], failed: true };
      codes = (matchingCodesResult.data ?? []) as CodeRow[];
    }
  }
  const configurationIds = Array.from(new Set(codes.map((code) => code.configuration_id)));
  const allItemIds = Array.from(new Set(items.map((item) => item.id)));
  const [itemBalances, configurations, configurationBalances, aliases] = await Promise.all([
    allItemIds.length ? supabase.from("stock_balances").select("item_id, quantity").in("item_id", allItemIds) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? supabase.from("commercial_configurations").select("id, description, servo_id, installation_kit_id, is_active").in("id", configurationIds).eq("is_active", true) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? supabase.from("configuration_stock_balances").select("configuration_id, quantity").in("configuration_id", configurationIds) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? supabase.from("commercial_configuration_codes").select("id, code, configuration_id, is_active").in("configuration_id", configurationIds).eq("is_active", true) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([itemBalances.error, configurations.error, configurationBalances.error, aliases.error].some(Boolean)) return { targets: [], failed: true };
  const balances = new Map(((itemBalances.data ?? []) as BalanceRow[]).map((row) => [row.item_id, safeQuantity(row.quantity)]));
  const configurationById = new Map(((configurations.data ?? []) as ConfigurationRow[]).map((row) => [row.id, row]));
  const configurationStock = new Map(((configurationBalances.data ?? []) as ConfigurationBalanceRow[]).map((row) => [row.configuration_id, safeQuantity(row.quantity)]));
  const aliasesByConfiguration = new Map<string, CodeRow[]>();
  ((aliases.data ?? []) as CodeRow[]).forEach((code) => aliasesByConfiguration.set(code.configuration_id, [...(aliasesByConfiguration.get(code.configuration_id) ?? []), code]));
  const modelById = new Map(models.map((model) => [model.item_id, model.model]));
  const targets: AssistantStockEntryTarget[] = items.map((item) => ({ kind: "ITEM" as const, targetId: item.id,
    configurationId: null, displayCode: item.code, aliases: [], typeLabel: typeLabels[item.item_type],
    description: item.description, detail: modelById.get(item.id) ?? null, currentStock: balances.get(item.id) ?? 0 }));
  for (const code of codes) {
    const configuration = configurationById.get(code.configuration_id);
    if (!configuration) continue;
    const grouped = (aliasesByConfiguration.get(configuration.id) ?? []).sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
    targets.push({ kind: "COMMERCIAL_CODE", targetId: code.id, configurationId: configuration.id,
      displayCode: code.code, aliases: grouped.map((alias) => alias.code), typeLabel: "Servo com kit",
      description: configuration.description ?? `Servo com kit Cód. ${code.code}`, detail: null,
      currentStock: configurationStock.get(configuration.id) ?? 0 });
  }
  if (requestedIdentity === null && codes.length > 0) {
    return {
      targets: targets.filter((target) => target.kind === "COMMERCIAL_CODE"),
      failed: false,
    };
  }
  const unique = new Map<string, AssistantStockEntryTarget>();
  targets.forEach((target) => {
    const key = target.kind === "COMMERCIAL_CODE" ? `CONFIG:${target.configurationId}` : `ITEM:${target.targetId}`;
    if (!unique.has(key)) unique.set(key, target);
  });
  return { targets: Array.from(unique.values()), failed: false };
}

export async function loadManualStockEntryTargetsByIds(
  supabase: SupabaseClient,
  lines: Array<{ kind: "ITEM" | "COMMERCIAL_CODE"; targetId: string }>,
) {
  const itemIds = lines.flatMap((line) => line.kind === "ITEM" ? [line.targetId] : []);
  const codeIds = lines.flatMap((line) => line.kind === "COMMERCIAL_CODE" ? [line.targetId] : []);
  const [itemsResult, codesResult, itemBalancesResult, modelsResult] = await Promise.all([
    itemIds.length ? supabase.from("items").select("id, code, description, item_type, is_active").in("id", itemIds).eq("is_active", true) : Promise.resolve({ data: [], error: null }),
    codeIds.length ? supabase.from("commercial_configuration_codes").select("id, code, configuration_id, is_active").in("id", codeIds).eq("is_active", true) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? supabase.from("stock_balances").select("item_id, quantity").in("item_id", itemIds) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? supabase.from("servo_models").select("item_id, model").in("item_id", itemIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([itemsResult.error, codesResult.error, itemBalancesResult.error, modelsResult.error].some(Boolean)) return { targets: new Map<string, AssistantStockEntryTarget>(), failed: true };
  const items = (itemsResult.data ?? []) as ItemRow[];
  const codes = (codesResult.data ?? []) as CodeRow[];
  if (items.length !== new Set(itemIds).size || codes.length !== new Set(codeIds).size) return { targets: new Map<string, AssistantStockEntryTarget>(), failed: true };
  const configurationIds = Array.from(new Set(codes.map((code) => code.configuration_id)));
  const [configurationsResult, configurationBalancesResult, aliasesResult] = await Promise.all([
    configurationIds.length ? supabase.from("commercial_configurations").select("id, description, servo_id, installation_kit_id, is_active").in("id", configurationIds).eq("is_active", true) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? supabase.from("configuration_stock_balances").select("configuration_id, quantity").in("configuration_id", configurationIds) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? supabase.from("commercial_configuration_codes").select("id, code, configuration_id, is_active").in("configuration_id", configurationIds).eq("is_active", true) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([configurationsResult.error, configurationBalancesResult.error, aliasesResult.error].some(Boolean) || (configurationsResult.data?.length ?? 0) !== configurationIds.length) return { targets: new Map<string, AssistantStockEntryTarget>(), failed: true };
  const itemBalance = new Map(((itemBalancesResult.data ?? []) as BalanceRow[]).map((row) => [row.item_id, safeQuantity(row.quantity)]));
  const models = new Map(((modelsResult.data ?? []) as ModelRow[]).map((row) => [row.item_id, row.model]));
  const configurationById = new Map(((configurationsResult.data ?? []) as ConfigurationRow[]).map((row) => [row.id, row]));
  const configurationBalance = new Map(((configurationBalancesResult.data ?? []) as ConfigurationBalanceRow[]).map((row) => [row.configuration_id, safeQuantity(row.quantity)]));
  const aliasesByConfiguration = new Map<string, CodeRow[]>();
  ((aliasesResult.data ?? []) as CodeRow[]).forEach((code) => aliasesByConfiguration.set(code.configuration_id, [...(aliasesByConfiguration.get(code.configuration_id) ?? []), code]));
  const targets = new Map<string, AssistantStockEntryTarget>();
  items.forEach((item) => targets.set(`ITEM:${item.id}`, { kind: "ITEM", targetId: item.id, configurationId: null,
    displayCode: item.code, aliases: [], typeLabel: typeLabels[item.item_type], description: item.description,
    detail: models.get(item.id) ?? null, currentStock: itemBalance.get(item.id) ?? 0 }));
  codes.forEach((code) => { const configuration = configurationById.get(code.configuration_id); if (!configuration) return;
    const aliases = (aliasesByConfiguration.get(configuration.id) ?? []).sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true })).map((alias) => alias.code);
    targets.set(`COMMERCIAL_CODE:${code.id}`, { kind: "COMMERCIAL_CODE", targetId: code.id, configurationId: configuration.id,
      displayCode: code.code, aliases, typeLabel: "Servo com kit", description: configuration.description ?? `Servo com kit Cód. ${code.code}`,
      detail: null, currentStock: configurationBalance.get(configuration.id) ?? 0 }); });
  return { targets, failed: targets.size !== lines.length };
}
