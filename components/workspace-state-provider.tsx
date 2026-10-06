"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createWorkspaceStore, type WorkspaceData, type WorkspaceStore } from "@/lib/workspace-state";
import { safeWorkspaceHref } from "@/lib/workspace-href";

const WorkspaceContext = createContext<WorkspaceStore | null>(null);
const subscribeNothing = () => () => {};
const notHydrated = () => false;

function WorkspaceNavigationTracker() {
  const store = useContext(WorkspaceContext);
  const pathname = usePathname();
  const params = useSearchParams();
  const hydrated = useSyncExternalStore(store?.subscribe ?? subscribeNothing, store?.isHydrated ?? notHydrated, notHydrated);
  const section = `/${pathname.split("/")[1] ?? ""}`;
  const query = params.toString();
  useEffect(() => {
    if (hydrated) store?.remember(section, `${pathname}${query ? `?${query}` : ""}`);
  }, [store, section, pathname, query, hydrated]);
  return null;
}

export function WorkspaceStateProvider({ userId, children }: { userId: string; children: ReactNode }) {
  // Layout also keys this provider by profile.id; no shared/global user store.
  const [store] = useState(() => createWorkspaceStore(userId, safeWorkspaceHref));
  useEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Memory-only mode. */ }
    store.hydrate(storage);
    const flush = () => store.flush();
    function submit(event: SubmitEvent) {
      if (event.target instanceof HTMLFormElement && event.target.hasAttribute("data-assistant-session-logout")) store.logout();
    }
    // Capture a final scroll/state before Next changes the route. No href mutation.
    const beforeNavigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      // The current sidebar tab only dismisses the drawer, not the workspace.
      if (link?.hasAttribute("data-nk-navigation") && link.getAttribute("aria-current") === "page") return;
      if (link && link.origin === window.location.origin && link.target !== "_blank" && !link.hasAttribute("download")
        && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        window.dispatchEvent(new Event("nk:workspace:before-navigation"));
        store.flush();
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("click", beforeNavigate, true);
    document.addEventListener("submit", submit, true);
    return () => {
      store.flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("click", beforeNavigate, true);
      document.removeEventListener("submit", submit, true);
    };
  }, [store]);
  return <WorkspaceContext.Provider value={store}>
    <Suspense fallback={null}><WorkspaceNavigationTracker /></Suspense>
    {children}
  </WorkspaceContext.Provider>;
}

export function useWorkspaceState<T extends WorkspaceData>(key: string, defaults: T, explicit?: Partial<T>) {
  const store = useContext(WorkspaceContext);
  const defaultsRef = useRef(defaults);
  const [fallback, setFallback] = useState(defaults);
  const explicitRef = useRef<T | null>(explicit ? { ...defaults, ...store?.read(key)?.data, ...explicit } as T : null);
  const hydrated = useSyncExternalStore(store?.subscribe ?? subscribeNothing, store?.isHydrated ?? notHydrated, notHydrated);
  const read = useCallback(() => explicitRef.current ?? (store?.read(key)?.data as T | undefined) ?? fallback, [store, key, fallback]);
  const serverRead = useCallback(() => explicitRef.current ?? defaultsRef.current, []);
  const state = useSyncExternalStore(store?.subscribe ?? subscribeNothing, read, serverRead);
  useEffect(() => {
    if (!hydrated || !explicitRef.current || !store) return;
    const next = explicitRef.current;
    explicitRef.current = null;
    store.set(key, next);
  }, [store, key, hydrated]);
  const setState = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    const previous = read();
    const next = typeof update === "function" ? update(previous) : update;
    explicitRef.current = null;
    if (store) store.set(key, next); else setFallback(next);
  }, [store, key, read]);
  const clear = useCallback(() => { store?.clear(key); setFallback(defaultsRef.current); }, [store, key]);
  const persistNow = useCallback(() => store?.flush(), [store]);
  return { state, setState, clear, persistNow, hydrated: store ? hydrated : true };
}

export function useWorkspaceResumeHref(baseHref: string) {
  const store = useContext(WorkspaceContext);
  const read = useCallback(() => store?.href(baseHref) ?? baseHref, [store, baseHref]);
  const serverRead = useCallback(() => baseHref, [baseHref]);
  return useSyncExternalStore(store?.subscribe ?? subscribeNothing, read, serverRead);
}

export function useWorkspaceResumeResolver() {
  const store = useContext(WorkspaceContext);
  return useCallback((baseHref: string) => store?.href(baseHref) ?? baseHref, [store]);
}

export function useWorkspaceScroll(key: string, defaults: WorkspaceData, enabled = true) {
  const store = useContext(WorkspaceContext);
  const hydrated = useSyncExternalStore(store?.subscribe ?? subscribeNothing, store?.isHydrated ?? notHydrated, notHydrated);
  const defaultsRef = useRef(defaults);
  const cancelled = useRef(false);
  const lastPosition = useRef(0);
  const cancelRestore = useCallback(() => { cancelled.current = true; }, []);
  useEffect(() => {
    if (!store || !hydrated) return;
    let frame = 0;
    let attempts = 0;
    let restoring = enabled;
    let departing = false;
    const initialDefaults = defaultsRef.current;
    const saved = store.read(key)?.scrollTop ?? 0;
    lastPosition.current = saved;
    const save = () => {
      if (!restoring && !departing) { lastPosition.current = window.scrollY; store.scroll(key, window.scrollY, initialDefaults); }
    };
    const cancel = () => { cancelled.current = true; restoring = false; };
    const navigate = () => { cancel(); save(); departing = true; store.flush(); };
    function restore() {
      if (cancelled.current || !enabled) { restoring = false; return; }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= saved || attempts >= 60) {
        window.scrollTo({ top: Math.min(saved, Math.max(0, max)), behavior: "instant" });
        lastPosition.current = window.scrollY;
        restoring = false;
      } else { attempts += 1; frame = window.requestAnimationFrame(restore); }
    }
    frame = window.requestAnimationFrame(restore);
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    window.addEventListener("nk:workspace:before-navigation", navigate);
    window.addEventListener("pagehide", navigate);
    window.addEventListener("popstate", navigate);
    return () => {
      window.cancelAnimationFrame(frame);
      // Next may reset window scroll before unmount: retain last observed position.
      store.scroll(key, lastPosition.current, initialDefaults); store.flush();
      window.removeEventListener("scroll", save);
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("nk:workspace:before-navigation", navigate);
      window.removeEventListener("pagehide", navigate);
      window.removeEventListener("popstate", navigate);
      // Next may deactivate/reactivate a retained route without recreating refs.
      // Cancellation applies to this visit, not the next workspace activation.
      cancelled.current = false;
    };
  }, [store, key, hydrated, enabled]);
  return cancelRestore;
}

// Small marker for URL-driven Server pages; never loads or caches their datasets.
export function WorkspaceScroll({ workspace }: { workspace: string }) {
  useWorkspaceScroll(workspace, {});
  return null;
}
