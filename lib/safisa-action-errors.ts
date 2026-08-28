import type { SafisaActionResult } from "@/lib/safisa-portal-types";

type SafisaMutationError = {
  code?: string;
  message?: string;
};

const inactiveMembershipMessages = new Set([
  "An active Safisa portal membership with a registered name is required.",
  "An authorized Safisa or internal user with a registered name is required.",
]);

export function mapSafisaMutationError(
  error: SafisaMutationError,
): SafisaActionResult {
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
