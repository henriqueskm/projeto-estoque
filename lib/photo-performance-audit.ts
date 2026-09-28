export const photoPerformanceEvent = "nk-photo-performance";
export type PhotoPerformanceSample = {
  route: "/estoque" | "/entrada" | "/saida";
  phase: "resolver_response" | "image_load";
  durationMs: number;
  reused: boolean;
};

export function recordPhotoPerformance(phase: PhotoPerformanceSample["phase"], startedAt: number, reused: boolean) {
  // The panel exists only in development/Preview. Storage restrictions must
  // never turn optional diagnostics into a failed image interaction.
  if (!document.querySelector('[aria-label="Diagnóstico de navegação"]')) return;
  try { if (sessionStorage.getItem("nk_performance_audit_enabled") !== "1") return; } catch { return; }
  const route = window.location.pathname;
  if (route !== "/estoque" && route !== "/entrada" && route !== "/saida") return;
  window.dispatchEvent(new CustomEvent<PhotoPerformanceSample>(photoPerformanceEvent, {
    detail: { route, phase, durationMs: Math.round(performance.now() - startedAt), reused },
  }));
}
