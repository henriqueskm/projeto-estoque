import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export function assistantOrderPhotoJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export function isAssistantOrderPhotoSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  try { return new URL(origin).origin === origin && new URL(request.url).origin === origin; }
  catch { return false; }
}

export async function authenticateAssistantOrderPhotoRequest(request: Request) {
  if (!isAssistantOrderPhotoSameOrigin(request)) {
    return { error: assistantOrderPhotoJson({ error: "Origem da solicitação não permitida." }, 403) };
  }
  if (request.headers.get("content-type")?.toLowerCase() !== "application/json") {
    return { error: assistantOrderPhotoJson({ error: "Envie os dados em JSON." }, 415) };
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 8_192)) {
    return { error: assistantOrderPhotoJson({ error: "A solicitação é inválida." }, 413) };
  }
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) {
    return { error: assistantOrderPhotoJson({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  }
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("id").eq("id", userId).eq("is_active", true).maybeSingle();
  if (profileError) return { error: assistantOrderPhotoJson({ error: "Não foi possível validar seu acesso agora." }, 503) };
  if (!profile) return { error: assistantOrderPhotoJson({ error: "Seu perfil não está ativo." }, 403) };
  return { supabase };
}

export async function readExactJson(request: Request, keys: readonly string[]) {
  let value: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 8_192) return null;
    value = JSON.parse(text);
  } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? record : null;
}
