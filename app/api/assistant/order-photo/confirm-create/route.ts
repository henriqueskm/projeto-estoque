import { createSupplierOrder } from "@/app/(authenticated)/pedidos/actions";
import { createClient } from "@/lib/supabase/server";
import {
  assistantOrderPhotoJson,
  authenticateAssistantOrderPhotoRequest,
  readExactJson,
} from "@/lib/assistant-order-photo-route";
import {
  supplierOrderPhotoCreateConfirmBodyBytes,
  supplierOrderPhotoCreateMaxTokenLength,
} from "@/lib/assistant-supplier-order-photo-create-contract";
import {
  confirmSupplierOrderPhotoCreate,
  type SupplierOrderPhotoCreateExistingOrder,
} from "@/lib/assistant-supplier-order-photo-create";
import { loadSupplierOrderPhotoCatalog } from "@/lib/assistant-supplier-order-photo-catalog";
import { verifySupplierOrderPhotoCreateProposalToken } from "@/lib/ai/supplier-order-photo-create-token";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function findExistingOrder(
  supabase: SupabaseClient,
  negotiationNumber: string,
): Promise<SupplierOrderPhotoCreateExistingOrder | null> {
  const result = await supabase.from("supplier_order_summaries")
    .select("id, negotiation_number, status, is_in_history")
    .eq("negotiation_number", negotiationNumber).limit(2);
  if (result.error || (result.data?.length ?? 0) > 1) throw new Error("order_lookup_failed");
  const order = result.data?.[0] as {
    id: string;
    negotiation_number: string;
    status: SupplierOrderPhotoCreateExistingOrder["status"];
    is_in_history: boolean;
  } | undefined;
  return order ? {
    id: order.id,
    negotiationNumber: order.negotiation_number,
    status: order.status,
    isInHistory: order.is_in_history,
  } : null;
}

export async function POST(request: Request) {
  const auth = await authenticateAssistantOrderPhotoRequest(request, {
    maxBodyBytes: supplierOrderPhotoCreateConfirmBodyBytes,
    requireProfileName: true,
  });
  if ("error" in auth) return auth.error;
  const body = await readExactJson(
    request,
    ["proposalToken"],
    supplierOrderPhotoCreateConfirmBodyBytes,
  );
  const proposalToken = typeof body?.proposalToken === "string" ? body.proposalToken : "";
  if (!proposalToken || proposalToken.length > supplierOrderPhotoCreateMaxTokenLength ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(proposalToken)) {
    return assistantOrderPhotoJson({ error: "A confirmação é inválida." }, 400);
  }
  try {
    const result = await confirmSupplierOrderPhotoCreate(proposalToken, auth.userId, {
      verifyProposal: (token, userId) => verifySupplierOrderPhotoCreateProposalToken(
        token,
        process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "",
        userId,
      ),
      loadCatalog: () => loadSupplierOrderPhotoCatalog(auth.supabase),
      findExistingOrder: (negotiationNumber) =>
        findExistingOrder(auth.supabase, negotiationNumber),
      createOrder: createSupplierOrder,
    });
    if (result.ok) return assistantOrderPhotoJson({ block: result.block }, 200);
    const status = result.code === "EXPIRED" ? 410
      : result.code === "USER_MISMATCH" ? 403
        : result.code === "CATALOG_CHANGED" ? 409
          : result.code === "TRANSPORT_UNCERTAIN" ? 503 : 400;
    return assistantOrderPhotoJson({
      error: result.error,
      transportUncertain: result.code === "TRANSPORT_UNCERTAIN",
    }, status);
  } catch {
    return assistantOrderPhotoJson({
      error: "Não foi possível confirmar o resultado. Verifique se o Pedido foi criado antes de iniciar uma nova tentativa.",
      transportUncertain: true,
    }, 503);
  }
}
