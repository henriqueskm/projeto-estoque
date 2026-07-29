import { NextResponse } from "next/server";
import {
  AssistantDataError,
  consultAssistantCatalogMedia,
} from "@/lib/assistant-data";
import {
  assistantQueryMaxLength,
  type AssistantCatalogMediaBlock,
  type AssistantChatError,
} from "@/lib/assistant-types";
import { createClient } from "@/lib/supabase/server";

type AssistantMediaSuccess = {
  structuredBlock: AssistantCatalogMediaBlock;
};

function errorResponse(error: string, status: number) {
  return NextResponse.json<AssistantChatError>({ error }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return errorResponse("Sua sessão expirou. Entre novamente.", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError) {
    return errorResponse(
      "Não foi possível validar seu acesso agora. Tente novamente.",
      503,
    );
  }

  if (!profile) {
    return errorResponse("Seu perfil não está ativo.", 403);
  }

  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return errorResponse("Solicitação inválida.", 400);
  }

  let body: unknown;

  try {
    const rawBody = await request.text();

    if (rawBody.length > 512) {
      return errorResponse("Solicitação inválida.", 400);
    }

    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("Solicitação inválida.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Solicitação inválida.", 400);
  }

  const bodyRecord = body as Record<string, unknown>;
  const code =
    typeof bodyRecord.code === "string"
      ? bodyRecord.code
          .trim()
          .replace(/\s+/g, " ")
          .toLocaleUpperCase("pt-BR")
      : "";

  if (
    Object.keys(bodyRecord).some((key) => key !== "code") ||
    !code ||
    code.length > assistantQueryMaxLength ||
    !/^(?=.*\d)[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/.test(code)
  ) {
    return errorResponse("Informe um código válido.", 400);
  }

  try {
    const structuredBlock = await consultAssistantCatalogMedia(code);

    return NextResponse.json<AssistantMediaSuccess>(
      { structuredBlock },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AssistantDataError) {
      return errorResponse(
        "Não foi possível atualizar a foto agora. Tente novamente.",
        502,
      );
    }

    return errorResponse(
      "Não foi possível atualizar a foto agora. Tente novamente.",
      502,
    );
  }
}
