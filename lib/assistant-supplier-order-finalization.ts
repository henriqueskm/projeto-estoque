import "server-only";

import { randomUUID } from "node:crypto";
import { finalizeSupplierOrder } from "@/app/(authenticated)/pedidos/actions";
import type {
  AssistantChatSuccess,
  AssistantSupplierOrderFinalizationConfirmationResult,
} from "@/lib/assistant-types";
import {
  addSupplierOrderFinalizationRefreshWarning,
  createSupplierOrderFinalizationOperations,
  type SupplierOrderFinalizationDependencies,
} from "@/lib/ai/supplier-order-finalization-service";
import {
  createSupplierOrderFinalizationProposalToken,
  verifySupplierOrderFinalizationProposalToken,
} from "@/lib/ai/supplier-order-finalization-action-token";
import {
  supplierOrderCanBeFinalized,
  supplierOrderFinalizationProfileHasName,
} from "@/lib/ai/supplier-order-finalization-contract";
import type { SupplierOrderFinalizationRequest } from "@/lib/ai/supplier-order-finalization-routing";
import {
  mapSupplierOrderSummary,
  supplierOrderSummarySelect,
  type SupplierOrderSummaryRow,
} from "@/lib/supplier-orders-data";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function loadOrderById(supabase: SupabaseClient, id: string) {
  const result = await supabase
    .from("supplier_order_summaries")
    .select(supplierOrderSummarySelect)
    .eq("id", id)
    .maybeSingle();
  return {
    failed: Boolean(result.error),
    order: result.data
      ? mapSupplierOrderSummary(result.data as SupplierOrderSummaryRow)
      : null,
  };
}

async function loadOrdersByNegotiation(
  supabase: SupabaseClient,
  negotiationNumber: string,
) {
  const result = await supabase
    .from("supplier_order_summaries")
    .select(supplierOrderSummarySelect)
    .eq("negotiation_number", negotiationNumber)
    .limit(2);
  return {
    failed: Boolean(result.error),
    orders: (result.data ?? [])
      .map((row) => mapSupplierOrderSummary(row as SupplierOrderSummaryRow))
      .filter((order): order is NonNullable<typeof order> => order !== null),
  };
}

function createDependencies(
  supabase: SupabaseClient,
): SupplierOrderFinalizationDependencies {
  return {
    createIdempotencyKey: randomUUID,
    createProposal: (input) => createSupplierOrderFinalizationProposalToken(
      input,
      process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "",
    ),
    verifyProposal: (proposalToken, expectedUserId) => verifySupplierOrderFinalizationProposalToken(
      proposalToken,
      process.env.ASSISTANT_ACTION_SIGNING_SECRET?.trim() ?? "",
      expectedUserId,
    ),
    profileHasName: supplierOrderFinalizationProfileHasName,
    isOrderEligible: supplierOrderCanBeFinalized,
    loadOrdersByNegotiation: (negotiationNumber) =>
      loadOrdersByNegotiation(supabase, negotiationNumber),
    loadOrderById: (supplierOrderId) => loadOrderById(supabase, supplierOrderId),
    getActiveProfile: async () => {
      const { data: claims } = await supabase.auth.getClaims();
      const userId = claims?.claims?.sub;
      if (!userId) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", userId)
        .eq("is_active", true)
        .maybeSingle();
      return profile ? { userId, profileName: profile.name } : null;
    },
    hasFinalizationEvent: async ({ supplierOrderId, idempotencyKey }) => {
      const { data } = await supabase
        .from("supplier_order_events")
        .select("id")
        .eq("supplier_order_id", supplierOrderId)
        .eq("event_type", "ORDER_FINALIZED")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      return Boolean(data);
    },
    finalize: finalizeSupplierOrder,
  };
}

export async function createAssistantSupplierOrderFinalizationPreview(
  request: SupplierOrderFinalizationRequest,
  context: { userId: string; profileName: string | null },
): Promise<AssistantChatSuccess> {
  const supabase = await createClient();
  return createSupplierOrderFinalizationOperations(createDependencies(supabase))
    .createPreview(request, context);
}

export async function confirmAssistantSupplierOrderFinalization(
  proposalToken: string,
): Promise<AssistantSupplierOrderFinalizationConfirmationResult> {
  const supabase = await createClient();
  return createSupplierOrderFinalizationOperations(createDependencies(supabase))
    .confirm(proposalToken);
}

export { addSupplierOrderFinalizationRefreshWarning };
