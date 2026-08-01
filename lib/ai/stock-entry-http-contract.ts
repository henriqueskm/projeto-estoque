export const assistantStockEntryBodyLimitBytes = 8 * 1024;

export function parseStockEntryActionBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    !Object.hasOwn(record, "proposalToken") ||
    typeof record.proposalToken !== "string" ||
    !record.proposalToken ||
    record.proposalToken.length > 4096 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(record.proposalToken)
  ) return null;
  return record.proposalToken;
}

export function stockEntryRequestIsSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    return new URL(origin).origin === origin && new URL(request.url).origin === origin;
  } catch {
    return false;
  }
}

function noStoreJson(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function handleStockEntryActionRequest<T>(
  request: Request,
  dependencies: {
    confirm: (token: string) => Promise<T>;
    revalidate: () => void | Promise<void>;
    isSuccess: (result: T) => boolean;
    addRefreshWarning: (result: T) => T;
    fallback: () => T;
  },
) {
  if (!stockEntryRequestIsSameOrigin(request)) return noStoreJson({ error: "Origem da solicitação não permitida." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return noStoreJson({ error: "O conteúdo da solicitação deve ser JSON." }, 415);
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > assistantStockEntryBodyLimitBytes)) {
    return noStoreJson({ error: "Solicitação muito grande." }, 413);
  }
  let raw: string;
  try { raw = await request.text(); } catch { return noStoreJson({ error: "Não foi possível ler a solicitação." }, 400); }
  if (new TextEncoder().encode(raw).byteLength > assistantStockEntryBodyLimitBytes) return noStoreJson({ error: "Solicitação muito grande." }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return noStoreJson({ error: "JSON inválido." }, 400); }
  const token = parseStockEntryActionBody(body);
  if (!token) return noStoreJson({ error: "Solicitação de confirmação inválida." }, 400);
  let result: T;
  try { result = await dependencies.confirm(token); }
  catch { return noStoreJson(dependencies.fallback(), 503); }
  if (dependencies.isSuccess(result)) {
    try { await dependencies.revalidate(); }
    catch { result = dependencies.addRefreshWarning(result); }
  }
  return noStoreJson(result, 200);
}
