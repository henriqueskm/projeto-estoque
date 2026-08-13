import { createClient } from "@/lib/supabase/server";
import {
  assistantOrderPhotoJson,
  authenticateAssistantOrderPhotoRequest,
  readExactJson,
} from "@/lib/assistant-order-photo-route";
import {
  parseSupplierOrderPhotoCreatePrepareInput,
  supplierOrderPhotoCreateMaxBodyBytes,
} from "@/lib/assistant-supplier-order-photo-create-contract";
import {
  prepareSupplierOrderPhotoCreate,
  type SupplierOrderPhotoCreateExistingOrder,
} from "@/lib/assistant-supplier-order-photo-create";
import { loadSupplierOrderPhotoCatalog } from "@/lib/assistant-supplier-order-photo-catalog";
import { createSupplierOrderPhotoCreateProposalToken } from "@/lib/ai/supplier-order-photo-create-token";

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
    maxBodyBytes: supplierOrderPhotoCreateMaxBodyBytes,
    requireProfileName: true,
  });
  if ("error" in auth) return auth.error;
  const body = await readExactJson(
    request,
    ["negotiationNumber", "orderDate", "lines"],
    supplierOrderPhotoCreateMaxBodyBytes,
  );
  const input = parseSupplierOrderPhotoCreatePrepareInput(body);
  if (!input) return assistantOrderPhotoJson({ error: "Os dados da prévia são inválidos." }, 400);
  try {
    const result = await prepareSupplierOrderPhotoCreate(input, auth.userId, {
      loadCatalog: () => loadSupplierOrderPhotoCatalog(auth.supabase),
      findExistingOrder: (negotiationNumber) =>
        findExistingOrder(auth.supabase, negotiationNumber),
      createProposal: (proposal) => createSupplierOrderPhotoCreateProposalToken(
        proposal,
        process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "",
      ),
    });
    if (result.ok) {
      return assistantOrderPhotoJson({ status: "READY", preparation: result.preparation }, 200);
    }
    if (result.code === "DUPLICATE") {
      return assistantOrderPhotoJson({ status: "DUPLICATE", block: result.block }, 409);
    }
    return assistantOrderPhotoJson(
      { error: result.error },
      result.code === "CONFIGURATION" ? 503 : 422,
    );
  } catch {
    return assistantOrderPhotoJson({ error: "Não foi possível preparar a criação agora." }, 503);
  }
}
