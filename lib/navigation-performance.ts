export type NavigationSample = {
  route: string;
  kind: "initial" | "sidebar";
  shellMs: number | null;
  readyMs: number | null;
  prefetchIntentObserved: boolean | null;
};

export type PendingNavigation = NavigationSample & { startedAt: number };

const routes = new Set(["/", "/estoque", "/relatorio-estoque", "/entrada", "/saida", "/pedidos", "/aplicacoes", "/estatisticas", "/historico"]);

// Store only an allowlisted section, never URL parameters or business identities.
export function performanceRoute(pathname: string): string | null {
  if (routes.has(pathname)) return pathname;
  return pathname.startsWith("/aplicacoes/") ? "/aplicacoes" : null;
}

export function startNavigationSample(route: string, startedAt: number, kind: NavigationSample["kind"], intent: boolean | null): PendingNavigation {
  return { route, startedAt, kind, shellMs: null, readyMs: null, prefetchIntentObserved: intent };
}

export function observeNavigationSample(pending: PendingNavigation, phase: "shell" | "ready", now: number): PendingNavigation {
  const field = phase === "shell" ? "shellMs" : "readyMs";
  if (pending[field] !== null) return pending;
  return { ...pending, [field]: Math.max(0, Math.round(now - pending.startedAt)) };
}

export function navigationSample(pending: PendingNavigation): NavigationSample {
  return { route: pending.route, kind: pending.kind, shellMs: pending.shellMs, readyMs: pending.readyMs, prefetchIntentObserved: pending.prefetchIntentObserved };
}
