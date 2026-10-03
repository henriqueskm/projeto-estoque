"use client";

import { useEffect, useState } from "react";
import { photoPerformanceEvent, type PhotoPerformanceSample } from "@/lib/photo-performance-audit";
import { navigationSample, observeNavigationSample, performanceRoute, startNavigationSample, type NavigationSample } from "@/lib/navigation-performance";

const modeKey = "nk_performance_audit_enabled";

export function PerformanceAuditPanel() {
  const [enabled, setEnabled] = useState(false);
  const [samples, setSamples] = useState<NavigationSample[]>([]);
  const [photoSamples, setPhotoSamples] = useState<PhotoPerformanceSample[]>([]);

  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get("nk_perf");
    let active = mode === "1";
    try {
      if (mode === "0") sessionStorage.removeItem(modeKey);
      if (mode === "1") sessionStorage.setItem(modeKey, "1");
      active = sessionStorage.getItem(modeKey) === "1";
    } catch { /* Diagnostics still work with blocked sessionStorage. */ }
    const frame = requestAnimationFrame(() => setEnabled(active));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    function onPhoto(event: Event) {
      const sample = (event as CustomEvent<PhotoPerformanceSample>).detail;
      setPhotoSamples((current) => [...current, sample].slice(-12));
    }
    window.addEventListener(photoPerformanceEvent, onPhoto);
    return () => window.removeEventListener(photoPerformanceEvent, onPhoto);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const initialRoute = performanceRoute(window.location.pathname);
    let pending = initialRoute ? startNavigationSample(initialRoute, 0, "initial", null) : null;
    let published = false;
    let frame: number | null = null;
    const intended = new Set<string>();

    function sidebarRoute(target: EventTarget | null) {
      if (!(target instanceof Element)) return null;
      const link = target.closest('nav[aria-label="Navegação principal"] a[href]');
      return link instanceof HTMLAnchorElement ? performanceRoute(link.pathname) : null;
    }
    function visibleMarker(phase: "shell" | "ready", route: string) {
      // Activity's retained, hidden routes must never count as visible UI.
      return Array.from(document.querySelectorAll<HTMLElement>(`[data-nk-perf-${phase}="${route}"]`))
        .some((element) => element.getClientRects().length > 0 && (phase === "shell" || element.getAttribute("aria-busy") !== "true"));
    }
    function observe() {
      frame = null;
      if (!pending || performanceRoute(window.location.pathname) !== pending.route) return;
      const before = pending;
      const now = performance.now();
      if (visibleMarker("shell", pending.route)) pending = observeNavigationSample(pending, "shell", now);
      if (visibleMarker("ready", pending.route)) pending = observeNavigationSample(pending, "ready", now);
      if (before !== pending) {
        const sample = navigationSample(pending);
        const replace = published;
        setSamples((current) => replace ? [...current.slice(0, -1), sample] : [...current, sample].slice(-24));
        published = true;
      }
      if (pending.readyMs !== null) pending = null;
    }
    function scheduleObservation() {
      if (frame === null) frame = requestAnimationFrame(observe);
    }
    function onIntent(event: Event) {
      const route = sidebarRoute(event.target);
      if (route) intended.add(route);
    }
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const route = sidebarRoute(event.target);
      if (!route || route === performanceRoute(window.location.pathname)) return;
      pending = startNavigationSample(route, performance.now(), "sidebar", intended.has(route));
      published = false;
      scheduleObservation();
    }
    document.addEventListener("pointerover", onIntent, true);
    document.addEventListener("focusin", onIntent, true);
    document.addEventListener("click", onClick, true);
    const observer = new MutationObserver(scheduleObservation);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-nk-perf-shell", "data-nk-perf-ready", "aria-busy", "style", "hidden"] });
    scheduleObservation();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("pointerover", onIntent, true);
      document.removeEventListener("focusin", onIntent, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <aside className="fixed right-2 bottom-2 z-[300] max-h-64 w-72 max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border border-slate-400 bg-white p-3 text-xs text-slate-900 shadow-xl" aria-label="Diagnóstico de navegação">
      <div className="flex items-center justify-between gap-2"><strong>NK perf · Preview</strong><button type="button" className="underline" onClick={() => { try { sessionStorage.removeItem(modeKey); } catch { /* Best effort. */ } setEnabled(false); }}>Desligar</button></div>
      <p className="mt-1">Clique → marcador visível + próximo frame. Não mede pintura, interação ou download de imagens.</p>
      <ul className="mt-2 space-y-1">{samples.map((sample, index) => <li key={index} data-nk-perf-sample={sample.route} data-shell-ms={sample.shellMs ?? "unobserved"} data-ready-ms={sample.readyMs ?? "pending"}>{sample.kind} {sample.route}: shell {sample.shellMs === null ? "não observado" : `${sample.shellMs} ms`} · ready {sample.readyMs === null ? "aguardando" : `${sample.readyMs} ms`} · intenção {sample.prefetchIntentObserved === null ? "n/a" : sample.prefetchIntentObserved ? "sim" : "não"}</li>)}</ul>
      {photoSamples.length ? <><p className="mt-2">Foto: clique → resposta / evento load. Não mede pintura ou decode separado.</p><ul className="mt-1 space-y-1">{photoSamples.map((sample, index) => <li key={index}>{sample.route} {sample.phase}: {sample.durationMs} ms · URL reutilizada {sample.reused ? "sim" : "não"}</li>)}</ul></> : null}
      <button type="button" className="mt-2 underline" onClick={() => void navigator.clipboard.writeText(JSON.stringify(samples))}>Copiar JSON</button>
      {photoSamples.length ? <button type="button" className="mt-2 ml-3 underline" onClick={() => void navigator.clipboard.writeText(JSON.stringify(photoSamples))}>Copiar fotos</button> : null}
    </aside>
  );
}
