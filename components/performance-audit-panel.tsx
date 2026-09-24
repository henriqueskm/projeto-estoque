"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type NavigationSample = {
  route: string;
  kind: "initial" | "sidebar";
  durationMs: number;
  prefetchIntentObserved: boolean | null;
};

const modeKey = "nk_performance_audit_enabled";
const routes = new Set(["/", "/estoque", "/entrada", "/saida", "/pedidos", "/aplicacoes", "/estatisticas", "/historico"]);
let pendingNavigation: { route: string; startedAt: number; intent: boolean } | null = null;
let initialRecorded = false;

export function PerformanceAuditPanel() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [samples, setSamples] = useState<NavigationSample[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("nk_perf") === "0") sessionStorage.removeItem(modeKey);
    if (params.get("nk_perf") === "1") sessionStorage.setItem(modeKey, "1");
    const frame = requestAnimationFrame(() => setEnabled(sessionStorage.getItem(modeKey) === "1"));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const intended = new Set<string>();

    function sidebarLink(target: EventTarget | null) {
      if (!(target instanceof Element)) return null;
      const link = target.closest('nav[aria-label="Navegação principal"] a[href]');
      if (!(link instanceof HTMLAnchorElement)) return null;
      const route = link.pathname;
      return routes.has(route) ? route : null;
    }
    function onIntent(event: Event) {
      const route = sidebarLink(event.target);
      if (route) intended.add(route);
    }
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const route = sidebarLink(event.target);
      if (!route || route === window.location.pathname) return;
      pendingNavigation = { route, startedAt: performance.now(), intent: intended.has(route) };
    }
    document.addEventListener("pointerover", onIntent, true);
    document.addEventListener("focusin", onIntent, true);
    document.addEventListener("click", onClick, true);

    const observer = new MutationObserver(() => {
      const marker = document.querySelector<HTMLElement>(`[data-nk-perf-ready="${pathname}"]`);
      if (!marker || marker.getAttribute("aria-busy") === "true") return;
      const navigation = pendingNavigation;
      if (navigation && navigation.route !== pathname) return;
      if (!navigation && initialRecorded) return;
      observer.disconnect();
      requestAnimationFrame(() => {
        const durationMs = navigation
          ? performance.now() - navigation.startedAt
          : performance.now();
        setSamples((current) => [...current, {
          route: pathname,
          kind: navigation ? "sidebar" as const : "initial" as const,
          durationMs: Math.round(durationMs),
          prefetchIntentObserved: navigation ? navigation.intent : null,
        }].slice(-12));
        pendingNavigation = null;
        initialRecorded = true;
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-nk-perf-ready", "aria-busy"] });
    observer.takeRecords();
    // The marker may have committed before this effect ran.
    const marker = document.querySelector(`[data-nk-perf-ready="${pathname}"]`);
    if (marker) marker.setAttribute("data-nk-perf-ready", pathname);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerover", onIntent, true);
      document.removeEventListener("focusin", onIntent, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [enabled, pathname]);

  if (!enabled) return null;
  return (
    <aside className="fixed right-2 bottom-2 z-[300] max-h-64 w-72 overflow-auto rounded-lg border border-slate-400 bg-white p-3 text-xs text-slate-900 shadow-xl" aria-label="Diagnóstico de navegação">
      <div className="flex items-center justify-between gap-2"><strong>NK perf · Preview</strong><button type="button" className="underline" onClick={() => { sessionStorage.removeItem(modeKey); setEnabled(false); }}>Desligar</button></div>
      <p className="mt-1">Clique → commit + próximo frame. Não mede interação.</p>
      <ul className="mt-2 space-y-1">{samples.map((sample, index) => <li key={index}>{sample.kind} {sample.route}: {sample.durationMs} ms · intenção prefetch {sample.prefetchIntentObserved === null ? "n/a" : sample.prefetchIntentObserved ? "sim" : "não"}</li>)}</ul>
      <button type="button" className="mt-2 underline" onClick={() => void navigator.clipboard.writeText(JSON.stringify(samples))}>Copiar JSON</button>
    </aside>
  );
}
