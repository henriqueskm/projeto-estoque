import type { SafisaActionResult } from "@/lib/safisa-portal-types";

type SafisaMutationError = {
  code?: string;
  message?: string;
};

type SafisaMutationResponse = {
  error: SafisaMutationError | null;
  status?: number;
  statusText?: string;
};

const unknownMutationResult: SafisaActionResult = {
  status: "unknown",
  message: "Não foi possível confirmar o resultado da operação. Tente verificar novamente.",
};

const authoritativeSafisaSqlStates = new Set(["22023", "28000", "40001", "42501"]);

const inactiveMembershipMessages = new Set([
  "An active Safisa portal membership with a registered name is required.",
  "An authorized Safisa or internal user with a registered name is required.",
]);

export function mapSafisaMutationError(
  error: SafisaMutationError,
): SafisaActionResult {
  if (error.message?.includes("idempotency_key")) {
    return {
      status: "conflict",
      message: "Esta tentativa já foi usada com uma operação diferente. Revise os dados antes de continuar.",
    };
  }

  if (error.code === "40001" || error.message?.includes("version_conflict")) {
    return {
      status: "conflict",
      message: "Este pedido foi atualizado por outra pessoa. Os dados foram recarregados.",
    };
  }

  if (error.code === "28000") {
    return {
      status: "error",
      message: "Sua sessão não está válida. Entre novamente.",
    };
  }

  if (
    error.code === "42501" &&
    error.message !== undefined &&
    inactiveMembershipMessages.has(error.message)
  ) {
    return {
      status: "error",
      message: "Seu acesso ao Portal Safisa não está ativo.",
    };
  }

  if (
    error.code === "42501" &&
    error.message === "The supplier order is not authorized for the Safisa portal."
  ) {
    return {
      status: "error",
      message: "Este pedido não está disponível para operação no Portal Safisa.",
    };
  }

  if (error.code === "42501") {
    return {
      status: "error",
      message: "Não foi possível autorizar esta operação. Tente novamente.",
    };
  }

  if (error.code === "22023") {
    return {
      status: "error",
      message: "Os dados do pedido mudaram ou a quantidade informada não é mais válida.",
    };
  }

  return {
    status: "error",
    message: "Não foi possível concluir a operação. Tente novamente.",
  };
}

export function classifySafisaMutationResponse(
  response: SafisaMutationResponse,
): SafisaActionResult | null {
  if (!response.error) return null;

  // postgrest-js 2.110.6 resolves fetch/network/abort failures with status 0.
  // Even if an unexpected adapter attaches a code, status 0 cannot prove that
  // PostgreSQL did not commit the transaction.
  if (response.status === 0) return unknownMutationResult;

  const code = response.error.code ?? "";
  if (authoritativeSafisaSqlStates.has(code)) {
    return mapSafisaMutationError(response.error);
  }

  if (response.status === 408 || response.status === 499) {
    return unknownMutationResult;
  }

  // Other 4xx responses are authoritative rejections by the HTTP/PostgREST layer.
  if (
    typeof response.status === "number" &&
    response.status >= 400 &&
    response.status < 500
  ) {
    return mapSafisaMutationError(response.error);
  }

  // Unclassified 5xx, malformed 2xx responses and missing status are
  // conservative unknowns: the caller must retry with the same receipt key.
  return unknownMutationResult;
}

export async function runSafisaMutation(
  mutation: () => PromiseLike<SafisaMutationResponse>,
): Promise<SafisaActionResult | null> {
  try {
    return classifySafisaMutationResponse(await mutation());
  } catch {
    return unknownMutationResult;
  }
}
