import { createHistoryHref, parseHistoryFilters } from "@/lib/history-query";
import { parseStatisticsPeriod } from "@/lib/statistics-types";
import { applicationWorkspaceSlugs } from "@/lib/workspace-state";

export function safeWorkspaceHref(section: string, candidate: string): string | null {
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || candidate.length > 2048) return null;
  let url: URL;
  try { url = new URL(candidate, "https://nk.invalid"); } catch { return null; }
  if (url.origin !== "https://nk.invalid" || url.hash) return null;
  const { pathname, searchParams: params } = url;
  if (["/", "/estoque", "/relatorio-estoque", "/entrada", "/saida", "/minha-conta"].includes(section)) return pathname === section ? section : null;
  if (section === "/pedidos") return pathname === section ? `/pedidos?view=${params.get("view") === "history" ? "history" : "active"}` : null;
  if (section === "/estatisticas") return pathname === section ? `/estatisticas?periodo=${parseStatisticsPeriod({ periodo: params.get("periodo") ?? undefined })}` : null;
  if (section === "/historico") return pathname === section ? createHistoryHref(parseHistoryFilters(Object.fromEntries([...params.keys()].map(key => [key, params.get(key) ?? undefined])))) : null;
  if (section === "/aplicacoes") return pathname === section || applicationWorkspaceSlugs.some(slug => pathname === `/aplicacoes/${slug}`) ? pathname : null;
  return null;
}
