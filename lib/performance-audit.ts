import "server-only";

export type PerformanceAuditMetric = {
  loader: string;
  phase: string;
  durationMs: number;
  queryCount?: number;
  streamCount?: number;
  waveCount?: number;
  rowCount?: number;
  payloadBytes?: number;
  catalogReadFromSource?: boolean;
  imagePathCount?: number;
};

export function isPerformanceAuditEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview";
}

export function performancePayloadBytes(value: unknown) {
  if (!isPerformanceAuditEnabled()) return undefined;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return undefined;
  }
}

export function logPerformanceAudit(metric: PerformanceAuditMetric) {
  if (!isPerformanceAuditEnabled()) return;
  console.info(JSON.stringify({ event: "nk_performance_audit", ...metric }));
}

export async function measurePerformanceAudit<T>(
  loader: string,
  phase: string,
  operation: () => PromiseLike<T>,
  details?: (value: T) => Pick<PerformanceAuditMetric, "queryCount" | "streamCount" | "waveCount" | "rowCount" | "payloadBytes" | "imagePathCount">,
): Promise<T> {
  if (!isPerformanceAuditEnabled()) return operation();
  const startedAt = performance.now();
  try {
    const value = await operation();
    logPerformanceAudit({
      loader,
      phase,
      durationMs: Math.round(performance.now() - startedAt),
      ...details?.(value),
    });
    return value;
  } catch (error) {
    logPerformanceAudit({
      loader,
      phase: `${phase}_error`,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}
