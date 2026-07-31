import type {
  AssistantSupplierOrderPickupConfirmationResult,
} from "@/lib/assistant-types";
import { addSupplierOrderPickupRefreshWarning } from "@/lib/ai/supplier-order-pickup-result";

export const assistantActionBodyLimitBytes = 8 * 1024;

type SupplierOrderPickupHttpDependencies = {
  confirm: (
    proposalToken: string,
  ) => Promise<AssistantSupplierOrderPickupConfirmationResult>;
  revalidate: () => void | Promise<void>;
};

type ParsedSupplierOrderPickupBody =
  | { ok: true; proposalToken: string }
  | { ok: false };

function noStoreJson(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function requestIsSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin || (fetchSite && fetchSite !== "same-origin")) {
    return false;
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    const suppliedOrigin = new URL(origin);

    return (
      suppliedOrigin.origin === origin &&
      suppliedOrigin.origin === requestOrigin
    );
  } catch {
    return false;
  }
}

function parseContentLength(request: Request) {
  const rawContentLength = request.headers.get("content-length");

  if (rawContentLength === null) {
    return null;
  }

  if (!/^\d+$/.test(rawContentLength)) {
    return Number.NaN;
  }

  return Number(rawContentLength);
}

export function parseSupplierOrderPickupRequestBody(
  value: unknown,
): ParsedSupplierOrderPickupBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  if (
    keys.length !== 1 ||
    keys[0] !== "proposalToken" ||
    typeof record.proposalToken !== "string" ||
    !record.proposalToken ||
    record.proposalToken.length > 4096 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(record.proposalToken)
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    proposalToken: record.proposalToken,
  };
}

export async function handleSupplierOrderPickupPost(
  request: Request,
  dependencies: SupplierOrderPickupHttpDependencies,
) {
  if (!requestIsSameOrigin(request)) {
    return noStoreJson(
      { error: "Origem da solicitação não permitida." },
      403,
    );
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLocaleLowerCase("en-US");

  if (contentType !== "application/json") {
    return noStoreJson(
      { error: "O conteúdo da solicitação deve ser JSON." },
      415,
    );
  }

  const contentLength = parseContentLength(request);

  if (
    contentLength !== null &&
    (!Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > assistantActionBodyLimitBytes)
  ) {
    return noStoreJson({ error: "Solicitação muito grande." }, 413);
  }

  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return noStoreJson(
      { error: "Não foi possível ler a solicitação." },
      400,
    );
  }

  if (
    new TextEncoder().encode(rawBody).byteLength >
    assistantActionBodyLimitBytes
  ) {
    return noStoreJson({ error: "Solicitação muito grande." }, 413);
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return noStoreJson({ error: "JSON inválido." }, 400);
  }

  const parsedBody = parseSupplierOrderPickupRequestBody(body);

  if (!parsedBody.ok) {
    return noStoreJson(
      { error: "Solicitação de confirmação inválida." },
      400,
    );
  }

  let result: AssistantSupplierOrderPickupConfirmationResult;

  try {
    result = await dependencies.confirm(parsedBody.proposalToken);
  } catch {
    return noStoreJson(
      {
        block: {
          kind: "assistant_action_result",
          action: "supplier_order_pickup",
          outcome: "error",
          title: "Resultado não confirmado",
          message:
            "Não foi possível confirmar o resultado da retirada. Confira o Pedido antes de realizar qualquer nova tentativa.",
          order: null,
          idempotentReplay: false,
          actions: [],
        },
        contextSupplierOrderId: null,
        contextSupplierOrderCatalogCode: null,
      } satisfies AssistantSupplierOrderPickupConfirmationResult,
      503,
    );
  }

  let responseResult = result;

  if (
    result.block.outcome === "success" ||
    result.block.outcome === "no_change"
  ) {
    try {
      await dependencies.revalidate();
    } catch {
      responseResult =
        addSupplierOrderPickupRefreshWarning(result);
    }
  }

  return noStoreJson(responseResult, 200);
}
