import { NextResponse } from "next/server";
import {
  assistantMessageMaxLength,
  assistantQueryMaxLength,
  assistantRequestMaxCharacters,
  parseAssistantServoModelInventoryAction,
  type AssistantChatError,
  type AssistantChatSuccess,
} from "@/lib/assistant-types";
import {
  answerAssistantQuestion,
  AssistantServiceError,
} from "@/lib/ai/assistant";
import { createClient } from "@/lib/supabase/server";

type AuthenticationResult =
  | {
      userId: string;
      firstName: string | null;
      profileName: string | null;
      error: null;
    }
  | {
      userId: null;
      firstName: null;
      profileName: null;
      error: NextResponse<AssistantChatError>;
    };

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
      userId: null,
      firstName: null,
      profileName: null,
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
      userId: null,
      firstName: null,
      profileName: null,
      error: errorResponse(
        "Não foi possível validar seu acesso agora. Tente novamente.",
        503,
      ),
    };
  }

  if (!profile) {
    return {
      userId: null,
      firstName: null,
      profileName: null,
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

  return {
    userId,
    firstName: safeFirstName,
    profileName: registeredName || null,
    error: null,
  };
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
        "Não foi possível concluir a consulta agora. Tente reformular a pergunta.",
        502,
      );
    case "EMPTY_RESPONSE":
    case "UNAVAILABLE":
    case "UPSTREAM":
      return errorResponse(
        "O Assistente IA está indisponível no momento. Tente novamente.",
        error.code === "UNAVAILABLE" ? 503 : 502,
      );
  }
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
    return errorResponse("A mensagem enviada é muito longa.", 400);
  }

  let rawBody: string;
  let body: unknown;

  try {
    rawBody = await request.text();

    if (rawBody.length > assistantRequestMaxCharacters) {
      return errorResponse("A mensagem enviada é muito longa.", 400);
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
  const rawLastItemQuery = bodyRecord.lastItemQuery;
  const rawLastSupplierOrderId = bodyRecord.lastSupplierOrderId;
  const rawLastSupplierOrderCatalogCode =
    bodyRecord.lastSupplierOrderCatalogCode;
  const rawSelectedSupplierOrderItemId =
    bodyRecord.selectedSupplierOrderItemId;
  const rawInventoryAction = bodyRecord.inventoryAction;

  if (
    bodyKeys.some(
      (key) =>
        key !== "message" &&
        key !== "lastItemQuery" &&
        key !== "lastSupplierOrderId" &&
        key !== "lastSupplierOrderCatalogCode" &&
        key !== "selectedSupplierOrderItemId" &&
        key !== "inventoryAction",
    ) ||
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

  const normalizedLastItemQuery =
    typeof rawLastItemQuery === "string" ? rawLastItemQuery.trim() : "";
  const lastItemQuery =
    normalizedLastItemQuery &&
    normalizedLastItemQuery.length <= assistantQueryMaxLength
      ? normalizedLastItemQuery
      : null;
  const normalizedLastSupplierOrderId =
    typeof rawLastSupplierOrderId === "string"
      ? rawLastSupplierOrderId.trim()
      : "";
  const lastSupplierOrderId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalizedLastSupplierOrderId,
    )
      ? normalizedLastSupplierOrderId
      : null;
  const normalizedLastSupplierOrderCatalogCode =
    typeof rawLastSupplierOrderCatalogCode === "string"
      ? rawLastSupplierOrderCatalogCode
          .trim()
          .replace(/\s+/g, " ")
          .toLocaleUpperCase("pt-BR")
      : "";
  const lastSupplierOrderCatalogCode =
    normalizedLastSupplierOrderCatalogCode.length <=
      assistantQueryMaxLength &&
    /^(?=.*\d)[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/.test(
      normalizedLastSupplierOrderCatalogCode,
    )
      ? normalizedLastSupplierOrderCatalogCode
      : null;
  const normalizedSelectedSupplierOrderItemId =
    typeof rawSelectedSupplierOrderItemId === "string"
      ? rawSelectedSupplierOrderItemId.trim()
      : "";
  const selectedSupplierOrderItemId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalizedSelectedSupplierOrderItemId,
    )
      ? normalizedSelectedSupplierOrderItemId
      : null;
  const inventoryAction =
    rawInventoryAction === undefined
      ? null
      : parseAssistantServoModelInventoryAction(rawInventoryAction);

  if (rawInventoryAction !== undefined && !inventoryAction) {
    return errorResponse("A opção selecionada não é válida.", 400);
  }

  try {
    const answer = await answerAssistantQuestion(
      message,
      lastItemQuery,
      lastSupplierOrderId,
      lastSupplierOrderCatalogCode,
      authentication.firstName,
      authentication.userId,
      authentication.profileName,
      selectedSupplierOrderItemId,
      inventoryAction,
    );

    return NextResponse.json<AssistantChatSuccess>(answer);
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
