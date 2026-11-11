"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ReactNode, type SetStateAction } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { createSemanticBackHistory, type SemanticBackHistory, type SemanticValue } from "@/lib/semantic-back-history";
import { isStandaloneMode } from "@/lib/pwa-capabilities";
import { useWorkspaceState } from "@/components/workspace-state-provider";
import type { WorkspaceData } from "@/lib/workspace-state";

const SemanticContext = createContext<SemanticBackHistory | null>(null);
const locationHref = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
export function useSemanticBackHistory() { return useContext(SemanticContext); }

function HistoryRouteTracker() {
  const coordinator = useContext(SemanticContext);
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();
  useEffect(() => { coordinator?.ensure(); }, [coordinator, pathname, query]);
  return null;
}

const exitHintDurationMs = 3000;

function ExitHint() {
  return createPortal(<div className="pointer-events-none fixed inset-x-0 bottom-0 z-[150] flex justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
    <p role="status" className="max-w-sm rounded-2xl bg-brand-charcoal px-5 py-4 text-center text-base font-bold text-white shadow-xl">
      Toque em voltar de novo para sair
    </p>
  </div>, document.body);
}

export function SemanticBackProvider({ children }: { children: ReactNode }) {
  const [exitHintVisible, setExitHintVisible] = useState(false);
  const [coordinator] = useState(() => createSemanticBackHistory({
    history: {
      get state() { return window.history.state; },
      pushState: (state, unused, url) => window.history.pushState(state, unused, url),
      replaceState: (state, unused, url) => window.history.replaceState(state, unused, url),
      go: delta => window.history.go(delta),
    }, href: locationHref, standalone: isStandaloneMode, id: () => crypto.randomUUID(),
    internalDocumentNavigation: () => {
      if (!document.referrer || window.history.length <= 1) return false;
      const previous = new URL(document.referrer);
      return previous.origin === window.location.origin && ["/", "/estoque", "/relatorio-estoque", "/entrada", "/saida", "/pedidos", "/historico", "/estatisticas", "/aplicacoes", "/minha-conta"].some(route => previous.pathname === route || (route !== "/" && previous.pathname.startsWith(`${route}/`)));
    },
    // Installed Chrome apps ignore scripted closing; the next native Back closes the app.
    exitBoundaryReached: () => setExitHintVisible(true),
    beforePop: () => window.dispatchEvent(new Event("nk:semantic:before-pop")),
  }));
  useEffect(() => {
    if (!exitHintVisible) return;
    const timer = window.setTimeout(() => setExitHintVisible(false), exitHintDurationMs);
    return () => window.clearTimeout(timer);
  }, [exitHintVisible]);
  useEffect(() => {
    coordinator.ensure();
    const pop = (event: PopStateEvent) => coordinator.pop(event.state);
    const navigate = () => coordinator.beforeNavigation();
    window.addEventListener("popstate", pop);
    window.addEventListener("nk:workspace:before-navigation", navigate);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("nk:workspace:before-navigation", navigate);
    };
  }, [coordinator]);
  return <SemanticContext.Provider value={coordinator}>
    <Suspense fallback={null}><HistoryRouteTracker /></Suspense>
    {children}
    {exitHintVisible ? <ExitHint /> : null}
  </SemanticContext.Provider>;
}

// Restorable projections deliberately exclude draft payloads, quantities and keys.
export function useSemanticCheckpoint(key: string, value: SemanticValue, restore: (value: SemanticValue) => void, enabled = true) {
  const coordinator = useContext(SemanticContext);
  const readValue = useEffectEvent(() => value);
  const restoreValue = useEffectEvent(restore);
  useLayoutEffect(() => {
    if (!enabled || !coordinator) return;
    return coordinator.register(key, { route: window.location.pathname, read: () => readValue(), restore: next => restoreValue(next) });
  }, [coordinator, key, enabled]); // Activity hides unregister; reactivation reattaches.
  const commit = useCallback((before: SemanticValue, after: SemanticValue, replace = false, route?: string) => coordinator?.commit(key, before, after, replace, route), [coordinator, key]);
  const invalidate = useCallback(() => coordinator?.invalidate(key), [coordinator, key]);
  return { commit, invalidate };
}

export function useSemanticTransient(enabled: boolean, close: () => void, blocked = false) {
  const coordinator = useContext(SemanticContext);
  const key = useId();
  const entry = useRef<string | null>(null);
  const closeCurrent = useEffectEvent(close);
  const isBlocked = useEffectEvent(() => blocked);
  useLayoutEffect(() => {
    if (!coordinator) return;
    if (enabled) {
      const entryId = coordinator.openTransient(key, () => closeCurrent(), () => isBlocked());
      entry.current = entryId;
      return () => {
        coordinator.retireTransient(entryId);
        // A manual close can unmount the dialog instead of toggling enabled.
        // StrictMode can reattach; route intent also protects a pending URL commit.
        window.requestAnimationFrame(() => coordinator.consumeRetiredTransient(entryId));
      };
    }
    if (entry.current) { coordinator.retireTransient(entry.current, true); entry.current = null; }
  }, [coordinator, enabled, key]);
}

const fields = ["query", "search", "statusFilter", "periodFilter", "closureFilter", "sort", "areFiltersOpen", "filtersOpen", "openPhysicalGroups", "openFamilies", "selectedOrderId", "category"];
function projection(data: WorkspaceData): SemanticValue {
  return Object.fromEntries(fields.filter(field => field in data).map(field => [field, data[field]])) as SemanticValue;
}
export function useSemanticWorkspaceState<T extends WorkspaceData>(key: string, defaults: T, explicit?: Partial<T>) {
  const workspace = useWorkspaceState(key, defaults, explicit);
  const coordinator = useContext(SemanticContext);
  const seed = useEffectEvent(() => {
    const order = explicit?.selectedOrderId;
    if (typeof order === "string") coordinator?.seedOrder(key, order, projection(workspace.state));
  });
  useLayoutEffect(() => { if (workspace.hydrated) seed(); }, [workspace.hydrated]);
  const checkpoint = useSemanticCheckpoint(key, projection(workspace.state), next => workspace.setState(current => ({ ...current, ...next })), workspace.hydrated);
  const writeWorkspace = workspace.setState;
  const commitCheckpoint = checkpoint.commit;
  const setState = useCallback((update: SetStateAction<T>) => {
    // The existing Workspace store remains the source of truth.
    writeWorkspace(previous => {
      const next = typeof update === "function" ? update(previous) : update;
      const before = projection(previous);
      const after = projection(next);
      const significant = fields.filter(field => field !== "query" && field !== "search").some(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
      commitCheckpoint(before, after, !significant);
      return next;
    });
  }, [writeWorkspace, commitCheckpoint]);
  return { ...workspace, setState };
}
