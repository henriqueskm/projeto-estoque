import { isUuid } from "@/lib/history-types";

export const workspaceStoragePrefix = "nk:workspace:v1:";
export const workspaceDebounceMs = 300;
export const maximumWorkspaceBytes = 256_000;
export type WorkspaceData = Record<string, unknown>;
export type WorkspaceEntry = { data: WorkspaceData; scrollTop: number };
export type WorkspaceSnapshot = {
  version: 1;
  workspaces: Record<string, WorkspaceEntry>;
  hrefs: Record<string, string>;
};
export const applicationWorkspaceSlugs = ["mercedes-benz", "ford", "volkswagen", "scania", "volvo", "agrale", "metalfor", "gmc"] as const;

export const inventoryWorkspaceDefaults = {
  query: "", statusFilter: "all", sort: "code", areFiltersOpen: false,
  openPhysicalGroups: [] as string[], openFamilies: [] as string[],
};
export const orderWorkspaceDefaults = {
  search: "", statusFilter: "ALL", closureFilter: "ALL", periodFilter: "ALL",
  sort: "RECENT", filtersOpen: false, selectedOrderId: null as string | null,
};
export type StockDraftLine =
  | { kind: "ITEM"; itemId: string; quantity: string }
  | { kind: "COMMERCIAL_CODE"; commercialCodeId: string; quantity: string }
  | { kind: "BUNDLE_CODE"; bundleCodeId: string; quantity: string }
  | { kind: "NEW_LOOSE_PART"; code: string; description: string; quantity: string };
export type StockFlowDraft = {
  step: "editing" | "review"; search: string; lines: StockDraftLine[];
  description: string; idempotencyKey: string | null;
  isNewLoosePartOpen: boolean; newLoosePartCode: string;
  newLoosePartDescription: string; newLoosePartQuantity: string;
};
export const stockFlowWorkspaceDefaults: StockFlowDraft = {
  step: "editing", search: "", lines: [], description: "", idempotencyKey: null,
  isNewLoosePartOpen: false, newLoosePartCode: "", newLoosePartDescription: "", newLoosePartQuantity: "1",
};

export function isWorkspaceKey(key: string) {
  return ["estoque", "relatorio-estoque", "entrada", "saida", "pedidos:active", "pedidos:history", "estatisticas", "historico", "minha-conta", "aplicacoes"].includes(key)
    || applicationWorkspaceSlugs.some(slug => key === `aplicacoes:${slug}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 120): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}
function choice(value: unknown, options: readonly string[]) {
  return typeof value === "string" && options.includes(value) ? value : undefined;
}
function stringArray(value: unknown, max: number) {
  return Array.isArray(value) && value.length <= max && value.every(x => text(x, 160) !== undefined)
    ? [...new Set(value)] as string[] : undefined;
}
function nullableUuid(value: unknown) {
  return value === null || (typeof value === "string" && isUuid(value)) ? value : undefined;
}
export function parseStockDraftLine(value: unknown, inbound: boolean): StockDraftLine | null {
  if (!record(value) || text(value.quantity, 20) === undefined) return null;
  const quantity = value.quantity as string;
  if (value.kind === "ITEM" && typeof value.itemId === "string" && isUuid(value.itemId)) return { kind: "ITEM", itemId: value.itemId, quantity };
  if (value.kind === "COMMERCIAL_CODE" && typeof value.commercialCodeId === "string" && isUuid(value.commercialCodeId)) return { kind: "COMMERCIAL_CODE", commercialCodeId: value.commercialCodeId, quantity };
  if (value.kind === "BUNDLE_CODE" && typeof value.bundleCodeId === "string" && isUuid(value.bundleCodeId)) return { kind: "BUNDLE_CODE", bundleCodeId: value.bundleCodeId, quantity };
  if (inbound && value.kind === "NEW_LOOSE_PART" && text(value.code) !== undefined && text(value.description, 500) !== undefined)
    return { kind: "NEW_LOOSE_PART", code: value.code as string, description: value.description as string, quantity };
  return null;
}
// Explicit allowlists also strip accidental balances, receipts, tokens and datasets.
export function normalizeWorkspaceData(key: string, value: unknown): WorkspaceData | null {
  if (!isWorkspaceKey(key) || !record(value)) return null;
  let clean: WorkspaceData;
  if (key === "estoque") clean = {
    query: text(value.query), statusFilter: choice(value.statusFilter, ["all", "attention", "low", "zero", "with-stock", "with-minimum"]),
    sort: choice(value.sort, ["code", "description", "quantity"]), areFiltersOpen: typeof value.areFiltersOpen === "boolean" ? value.areFiltersOpen : undefined,
    openPhysicalGroups: stringArray(value.openPhysicalGroups, 4)?.filter(x => ["SERVO", "INSTALLATION_KIT", "REPAIR_KIT", "LOOSE_PART"].includes(x)),
    openFamilies: stringArray(value.openFamilies, 200),
  };
  else if (key === "entrada" || key === "saida") {
    const lines = Array.isArray(value.lines) && value.lines.length <= 500 ? value.lines.map(line => parseStockDraftLine(line, key === "entrada")) : null;
    clean = {
      step: choice(value.step, ["editing", "review"]), search: text(value.search),
      lines: lines && lines.every(Boolean) ? lines : undefined,
      description: text(value.description, 500), idempotencyKey: nullableUuid(value.idempotencyKey),
      isNewLoosePartOpen: typeof value.isNewLoosePartOpen === "boolean" ? value.isNewLoosePartOpen : undefined,
      newLoosePartCode: text(value.newLoosePartCode), newLoosePartDescription: text(value.newLoosePartDescription, 500), newLoosePartQuantity: text(value.newLoosePartQuantity, 20),
    };
  } else if (key.startsWith("pedidos:")) clean = {
    search: text(value.search, 200), statusFilter: choice(value.statusFilter, ["ALL", "PENDING", "PARTIAL", "COMPLETED"]),
    closureFilter: choice(value.closureFilter, ["ALL", "FINALIZED", "CANCELLED", "WAITING_STOCK"]),
    periodFilter: choice(value.periodFilter, ["ALL", "7", "30", "90", "MONTH"]),
    sort: choice(value.sort, key === "pedidos:history" ? ["CLOSED_RECENT", "CLOSED_OLDEST", "ORDER_RECENT", "NUMBER"] : ["RECENT", "OLDEST", "NUMBER"]),
    filtersOpen: typeof value.filtersOpen === "boolean" ? value.filtersOpen : undefined, selectedOrderId: nullableUuid(value.selectedOrderId),
  };
  else if (key === "relatorio-estoque") clean = { query: text(value.query) };
  else if (key.startsWith("aplicacoes:")) clean = { query: text(value.query, 200), category: choice(value.category, ["ALL", "TRUCK", "BUS", "MICROBUS"]) };
  else clean = {};
  return Object.values(clean).some(x => x === undefined) ? null : clean;
}
export function emptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return { version: 1, workspaces: {}, hrefs: {} };
}

export function parseWorkspaceSnapshot(raw: string, validateHref: (section: string, href: string) => string | null): WorkspaceSnapshot | null {
  if (new TextEncoder().encode(raw).byteLength > maximumWorkspaceBytes) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || !record(value.workspaces) || !record(value.hrefs)) return null;
    const snapshot = emptyWorkspaceSnapshot();
    for (const [key, entry] of Object.entries(value.workspaces)) {
      if (!record(entry)) continue;
      const data = normalizeWorkspaceData(key, entry.data);
      if (data && typeof entry.scrollTop === "number" && Number.isFinite(entry.scrollTop) && entry.scrollTop >= 0 && entry.scrollTop <= 10_000_000)
        snapshot.workspaces[key] = { data, scrollTop: entry.scrollTop };
    }
    for (const [section, href] of Object.entries(value.hrefs)) {
      const safe = typeof href === "string" ? validateHref(section, href) : null;
      if (safe) snapshot.hrefs[section] = safe;
    }
    return snapshot;
  } catch { return null; }
}

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function createWorkspaceStore(userId: string, validateHref: (section: string, href: string) => string | null) {
  const storageKey = `${workspaceStoragePrefix}${userId}`;
  let snapshot = emptyWorkspaceSnapshot();
  let storage: WorkspaceStorage | null = null;
  let hydrated = false;
  let signedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearedKeys = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(fn => fn());
  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!hydrated || signedOut) return;
    try {
      const serialized = JSON.stringify(snapshot);
      if (new TextEncoder().encode(serialized).byteLength <= maximumWorkspaceBytes) storage?.setItem(storageKey, serialized);
    } catch { /* Memory remains usable when storage is blocked/full. */ }
  }
  function changed() {
    emit();
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, workspaceDebounceMs);
  }
  return {
    storageKey,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    read(key: string) { return snapshot.workspaces[key]; },
    href(section: string) { return snapshot.hrefs[section]; },
    isHydrated() { return hydrated; },
    hydrate(nextStorage: WorkspaceStorage | null) {
      if (hydrated || signedOut) return;
      storage = nextStorage;
      try {
        const raw = storage?.getItem(storageKey);
        snapshot = raw ? parseWorkspaceSnapshot(raw, validateHref) ?? emptyWorkspaceSnapshot() : snapshot;
      } catch { /* Do not block the UI. */ }
      hydrated = true; emit();
    },
    set(key: string, value: WorkspaceData) {
      if (signedOut) return;
      const data = normalizeWorkspaceData(key, value);
      if (!data) return;
      clearedKeys.delete(key);
      snapshot = { ...snapshot, workspaces: { ...snapshot.workspaces, [key]: { data, scrollTop: snapshot.workspaces[key]?.scrollTop ?? 0 } } }; changed();
    },
    scroll(key: string, top: number, defaults: WorkspaceData) {
      if (signedOut || clearedKeys.has(key) || !Number.isFinite(top) || top < 0 || top > 10_000_000) return;
      const data = snapshot.workspaces[key]?.data ?? normalizeWorkspaceData(key, defaults);
      if (!data) return;
      snapshot = { ...snapshot, workspaces: { ...snapshot.workspaces, [key]: { data, scrollTop: top } } }; changed();
    },
    remember(section: string, href: string) {
      const safe = validateHref(section, href);
      if (signedOut || !safe || snapshot.hrefs[section] === safe) return;
      snapshot = { ...snapshot, hrefs: { ...snapshot.hrefs, [section]: safe } }; changed();
    },
    clear(key: string) {
      clearedKeys.add(key);
      const workspaces = { ...snapshot.workspaces }; delete workspaces[key];
      snapshot = { ...snapshot, workspaces }; changed(); flush();
    },
    logout() {
      signedOut = true;
      if (timer) clearTimeout(timer);
      timer = null; snapshot = emptyWorkspaceSnapshot();
      try { storage?.removeItem(storageKey); } catch { /* Memory is also cleared. */ }
      emit();
    },
    flush,
  };
}
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
