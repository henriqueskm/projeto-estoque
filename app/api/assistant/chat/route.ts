import { NextResponse } from "next/server";
import {
  assistantHistoryMaxMessages,
  assistantMessageMaxLength,
  assistantRequestMaxCharacters,
  type AssistantConversationMessage,
  type AssistantChatError,
  type AssistantChatSuccess,
} from "@/lib/assistant-types";
import {
  answerAssistantQuestion,
  AssistantServiceError,
} from "@/lib/ai/assistant";
import { createClient } from "@/lib/supabase/server";

type AuthenticationResult =
  | { firstName: string | null; error: null }
  | { firstName: null; error: NextResponse<AssistantChatError> };

function errorResponse(error: string, status: number) {
  return NextResponse.json<AssistantChatError>({ error }, { status });
}

async function authenticateRequest(): Promise<AuthenticationResult> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return {
      firstName: null,
      error: errorResponse("Sua sessão expirou. Entre novamente.", 401),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError) {
    return {
      firstName: null,
      error: errorResponse(
        "Não foi possível validar seu acesso agora. Tente novamente.",
        503,
      ),
    };
  }

  if (!profile) {
    return {
      firstName: null,
      error: errorResponse("Seu perfil não está ativo.", 403),
    };
  }

  const registeredName =
    typeof profile.name === "string" ? profile.name.trim() : "";
  const firstName = registeredName.split(/\s+/).filter(Boolean)[0] ?? null;
  const safeFirstName =
    firstName &&
    firstName.length <= 80 &&
    /^[\p{L}\p{M}'’-]+$/u.test(firstName)
      ? firstName
      : null;

  return { firstName: safeFirstName, error: null };
}

function serviceErrorResponse(error: AssistantServiceError) {
  switch (error.code) {
    case "CONFIGURATION":
      return errorResponse(
        "O Assistente IA ainda não está configurado. Procure o administrador.",
        503,
      );
    case "RATE_LIMIT":
      return errorResponse(
        "O Assistente atingiu temporariamente o limite de uso. Aguarde alguns instantes e tente novamente.",
        429,
      );
    case "TIMEOUT":
      return errorResponse(
        "A consulta demorou mais que o esperado. Tente novamente.",
        504,
      );
    case "TOOL":
      return errorResponse(
        "Não foi possível concluir a consulta de estoque. Tente reformular a pergunta.",
        502,
      );
    case "EMPTY_RESPONSE":
    case "UPSTREAM":
      return errorResponse(
        "O Assistente IA está indisponível no momento. Tente novamente.",
        502,
      );
  }
}

function normalizeHistory(
  value: unknown,
): AssistantConversationMessage[] | null {
  if (!Array.isArray(value) || value.length > assistantHistoryMaxMessages) {
    return null;
  }

  const history: AssistantConversationMessage[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record);
    const role = record.role;
    const content =
      typeof record.content === "string" ? record.content.trim() : "";

    if (
      keys.length !== 2 ||
      !keys.includes("role") ||
      !keys.includes("content") ||
      (role !== "user" && role !== "assistant") ||
      !content ||
      content.length > assistantMessageMaxLength
    ) {
      return null;
    }

    history.push({ role, content });
  }

  return history;
}

export async function POST(request: Request) {
  const authentication = await authenticateRequest();

  if (authentication.error) {
    return authentication.error;
  }

  const contentLength = Number(request.headers.get("content-length"));

  if (
    Number.isFinite(contentLength) &&
    contentLength > assistantRequestMaxCharacters * 4
  ) {
    return errorResponse("A conversa enviada é muito longa.", 400);
  }

  let rawBody: string;
  let body: unknown;

  try {
    rawBody = await request.text();

    if (rawBody.length > assistantRequestMaxCharacters) {
      return errorResponse("A conversa enviada é muito longa.", 400);
    }

    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("Envie uma mensagem válida.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Envie uma mensagem válida.", 400);
  }

  const bodyRecord = body as Record<string, unknown>;
  const bodyKeys = Object.keys(bodyRecord);
  const message =
    typeof bodyRecord.message === "string" ? bodyRecord.message.trim() : "";
  const history = normalizeHistory(bodyRecord.history ?? []);

  if (
    bodyKeys.some((key) => key !== "message" && key !== "history") ||
    !bodyKeys.includes("message")
  ) {
    return errorResponse("Envie uma mensagem válida.", 400);
  }

  if (!message || message.length > assistantMessageMaxLength) {
    return errorResponse(
      `A mensagem deve ter entre 1 e ${assistantMessageMaxLength} caracteres.`,
      400,
    );
  }

  if (history === null) {
    return errorResponse(
      `O histórico deve conter no máximo ${assistantHistoryMaxMessages} mensagens válidas.`,
      400,
    );
  }

  try {
    const answer = await answerAssistantQuestion(
      message,
      history,
      authentication.firstName,
    );

    return NextResponse.json<AssistantChatSuccess>({ message: answer });
  } catch (error) {
    if (error instanceof AssistantServiceError) {
      return serviceErrorResponse(error);
    }

    return errorResponse(
      "O Assistente IA está indisponível no momento. Tente novamente.",
      502,
    );
  }
}
