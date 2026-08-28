"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getSafisaOrder,
  listSafisaOrders,
  SafisaPortalAccessError,
  SafisaPortalDataError,
} from "@/lib/safisa-portal-data";
import { maximumReadyQuantity } from "@/lib/safisa-portal-readiness";
import type { SafisaActionResult } from "@/lib/safisa-portal-types";
import { dispatchSafisaFullyReadyPush } from "@/lib/safisa-push-dispatch";

export type SafisaLoginState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isExactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value as Record<string, unknown>).sort();
  return actualKeys.length === keys.length && actualKeys.every((key, index) => key === [...keys].sort()[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function safeActionError(error: unknown): SafisaActionResult {
  if (error instanceof SafisaPortalAccessError) {
    return {
      status: "error",
      message: "Seu acesso ao Portal Safisa não está ativo.",
    };
  }
  if (error instanceof SafisaPortalDataError) {
    return { status: "error", message: error.message };
  }
  return {
    status: "error",
    message: "Não foi possível concluir a operação. Tente novamente.",
  };
}

function mapMutationError(error: { code?: string; message?: string }): SafisaActionResult {
  if (error.code === "40001" || error.message?.includes("version_conflict")) {
    return {
      status: "conflict",
      message: "Este pedido foi atualizado por outra pessoa. Os dados foram recarregados.",
    };
  }
  if (error.code === "42501" || error.code === "28000") {
    return { status: "error", message: "Seu acesso ao Portal Safisa não está ativo." };
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

export async function safisaLogin(
  _previousState: SafisaLoginState,
  formData: FormData,
): Promise<SafisaLoginState> {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const email = typeof emailValue === "string" ? emailValue.trim() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const fieldErrors: SafisaLoginState["fieldErrors"] = {};

  if (!email) fieldErrors.email = "Informe seu e-mail.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Informe um e-mail válido.";
  }
  if (!password) fieldErrors.password = "Informe sua senha.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "E-mail ou senha inválidos." };

  try {
    await listSafisaOrders(supabase);
  } catch (portalError) {
    await supabase.auth.signOut();
    if (!(portalError instanceof SafisaPortalAccessError)) {
      return { error: "Não foi possível validar seu acesso. Tente novamente." };
    }
    return {
      error: "Este usuário não possui acesso ativo ao Portal Safisa.",
    };
  }

  redirect("/safisa");
}

export async function safisaLogout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/safisa/login");
}

export async function incrementSafisaReadyQuantity(
  input: unknown,
): Promise<SafisaActionResult> {
  if (
    !isExactObject(input, ["idempotencyKey", "incrementQuantity", "supplierOrderId", "supplierOrderItemId"]) ||
    !isUuid(input.idempotencyKey) ||
    !isUuid(input.supplierOrderId) ||
    !isUuid(input.supplierOrderItemId) ||
    !Number.isSafeInteger(input.incrementQuantity) ||
    (input.incrementQuantity as number) <= 0
  ) {
    return { status: "error", message: "Informe uma quantidade inteira maior que zero." };
  }

  try {
    const supabase = await createClient();
    const order = await getSafisaOrder(supabase, input.supplierOrderId);
    const line = order.lines.find((item) => item.supplierOrderItemId === input.supplierOrderItemId);
    if (!line) return { status: "error", message: "Este item não pertence ao pedido." };
    if (order.isReadOnly) return { status: "error", message: "Este pedido está encerrado e permite somente consulta." };
    if ((input.incrementQuantity as number) > line.waitingReadyQuantity) {
      return { status: "error", message: "A quantidade é maior que o restante disponível." };
    }

    const { error } = await supabase.rpc("increment_safisa_ready_quantity", {
      p_supplier_order_item_id: line.supplierOrderItemId,
      p_increment_quantity: input.incrementQuantity,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) return mapMutationError(error);

    await dispatchSafisaFullyReadyPush(input.supplierOrderId);
    revalidatePath("/safisa");
    return { status: "success", message: `${input.incrementQuantity} unidade(s) informada(s) como pronta(s).` };
  } catch (error) {
    return safeActionError(error);
  }
}

export async function markSafisaRemainingReady(
  input: unknown,
): Promise<SafisaActionResult> {
  if (
    !isExactObject(input, ["idempotencyKey", "supplierOrderId", "supplierOrderItemId"]) ||
    !isUuid(input.idempotencyKey) ||
    !isUuid(input.supplierOrderId) ||
    !isUuid(input.supplierOrderItemId)
  ) {
    return { status: "error", message: "Pedido ou item inválido." };
  }

  try {
    const supabase = await createClient();
    const order = await getSafisaOrder(supabase, input.supplierOrderId);
    const line = order.lines.find((item) => item.supplierOrderItemId === input.supplierOrderItemId);
    if (!line) return { status: "error", message: "Este item não pertence ao pedido." };
    if (order.isReadOnly) return { status: "error", message: "Este pedido está encerrado e permite somente consulta." };
    if (line.waitingReadyQuantity <= 0) {
      revalidatePath("/safisa");
      return { status: "error", message: "Todo o restante deste item já foi informado como pronto." };
    }

    const { error } = await supabase.rpc("increment_safisa_ready_quantity", {
      p_supplier_order_item_id: line.supplierOrderItemId,
      p_increment_quantity: line.waitingReadyQuantity,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) return mapMutationError(error);

    await dispatchSafisaFullyReadyPush(input.supplierOrderId);
    revalidatePath("/safisa");
    return { status: "success", message: "Todo o restante foi informado como pronto." };
  } catch (error) {
    return safeActionError(error);
  }
}

export async function markSafisaOrderRemainingReady(
  input: unknown,
): Promise<SafisaActionResult> {
  if (
    !isExactObject(input, ["idempotencyKey", "supplierOrderId"]) ||
    !isUuid(input.idempotencyKey) ||
    !isUuid(input.supplierOrderId)
  ) {
    return { status: "error", message: "Pedido inválido." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_safisa_order_remaining_ready", {
      p_supplier_order_id: input.supplierOrderId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) return mapMutationError(error);

    await dispatchSafisaFullyReadyPush(input.supplierOrderId);
    revalidatePath("/safisa");
    return {
      status: "success",
      message: "Todos os itens restantes do pedido foram informados como prontos.",
    };
  } catch (error) {
    return safeActionError(error);
  }
}

export async function correctSafisaReadyQuantity(
  input: unknown,
): Promise<SafisaActionResult> {
  if (
    !isExactObject(input, [
      "expectedUpdatedAt",
      "idempotencyKey",
      "justification",
      "newReadyQuantity",
      "supplierOrderId",
      "supplierOrderItemId",
    ]) ||
    !isUuid(input.supplierOrderId) ||
    !isUuid(input.supplierOrderItemId) ||
    !isUuid(input.idempotencyKey) ||
    !Number.isSafeInteger(input.newReadyQuantity) ||
    (input.newReadyQuantity as number) < 0 ||
    typeof input.justification !== "string" ||
    !input.justification.trim() ||
    input.justification.trim().length > 500 ||
    typeof input.expectedUpdatedAt !== "string" ||
    Number.isNaN(Date.parse(input.expectedUpdatedAt))
  ) {
    return { status: "error", message: "Revise o total e informe uma justificativa de até 500 caracteres." };
  }

  try {
    const supabase = await createClient();
    const order = await getSafisaOrder(supabase, input.supplierOrderId);
    const line = order.lines.find((item) => item.supplierOrderItemId === input.supplierOrderItemId);
    if (!line) return { status: "error", message: "Este item não pertence ao pedido." };
    if (order.isReadOnly) return { status: "error", message: "Este pedido está encerrado e permite somente consulta." };
    if (line.updatedAt !== input.expectedUpdatedAt) {
      revalidatePath("/safisa");
      return {
        status: "conflict",
        message: "Este pedido foi atualizado por outra pessoa. Os dados foram recarregados.",
      };
    }
    const maximum = maximumReadyQuantity(line.readyQuantity, line.waitingReadyQuantity);
    if ((input.newReadyQuantity as number) < line.pickedQuantity || (input.newReadyQuantity as number) > maximum) {
      return {
        status: "error",
        message: `O total pronto deve ficar entre ${line.pickedQuantity} e ${maximum}.`,
      };
    }

    const { error } = await supabase.rpc("correct_safisa_ready_quantity", {
      p_supplier_order_item_id: line.supplierOrderItemId,
      p_new_ready_quantity: input.newReadyQuantity,
      p_justification: input.justification.trim(),
      p_confirmed: true,
      p_expected_updated_at: line.updatedAt,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) {
      const result = mapMutationError(error);
      if (result.status === "conflict") revalidatePath("/safisa");
      return result;
    }

    await dispatchSafisaFullyReadyPush(input.supplierOrderId);
    revalidatePath("/safisa");
    return { status: "success", message: "Quantidade pronta corrigida com auditoria." };
  } catch (error) {
    return safeActionError(error);
  }
}
