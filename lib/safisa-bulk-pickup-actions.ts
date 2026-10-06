"use server";

import { revalidatePath } from "next/cache";
import { requireActiveProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bulkPickupLimitMessage, bulkPickupStaleMessage, normalizeBulkPickupRequest,
  parseBulkPickupPreview, parseBulkPickupReceipt, type BulkPickupPreviewResult, type BulkPickupResult } from "@/lib/safisa-bulk-pickup";

export async function previewSafisaBulkPickup(): Promise<BulkPickupPreviewResult> {
  await requireActiveProfile();
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("preview_safisa_bulk_pickup");
    if (error?.code === "54000") return { ok: false, error: bulkPickupLimitMessage };
    if (error) return { ok: false, error: "Não foi possível carregar a prévia da retirada Safisa. Nenhuma operação foi executada." };
    const preview = parseBulkPickupPreview(data);
    return preview ? { ok: true, preview } : { ok: false, error: "A prévia está incompleta. Atualize antes de retirar." };
  } catch {
    return { ok: false, error: "Não foi possível carregar a prévia. Tente novamente." };
  }
}

export async function confirmSafisaBulkPickup(input: unknown): Promise<BulkPickupResult> {
  const request = normalizeBulkPickupRequest(input);
  if (!request) return { ok: false, error: "Prévia inválida. Atualize antes de retirar." };
  await requireActiveProfile();
  const client = await createClient();
  try {
    const { data, error } = await client.rpc("bulk_mark_supplier_orders_all_picked_checked", {
      p_orders: request.orders.map(o => ({ supplier_order_id: o.supplierOrderId, expected_updated_at: o.expectedUpdatedAt, expected_line_fingerprint: o.expectedLineFingerprint })),
      p_idempotency_key: request.idempotencyKey,
    });
    if (error) {
      if (error.code === "40001") return { ok: false, stale: true, error: bulkPickupStaleMessage };
      if (error.code === "54000") return { ok: false, error: bulkPickupLimitMessage };
      // PostgREST errors with a SQLSTATE are confirmed transaction failures.
      // Empty codes/HTTP or transport errors cannot prove that the RPC rolled back.
      if (/^[0-9A-Z]{5}$/.test(error.code ?? "") && !error.code.startsWith("PGRST")
        && !/^(08|40003|57P0[123])/.test(error.code)) {
        return { ok: false, error: "A retirada não foi concluída. Nenhum Pedido foi processado. Confira os Pedidos antes de gerar nova prévia." };
      }
      return { ok: false, transportUncertain: true, error: "Resultado não confirmado. Tente novamente com a mesma operação." };
    }
    const receipt = parseBulkPickupReceipt(data);
    if (!receipt) return { ok: false, transportUncertain: true, error: "Resultado não confirmado. Tente novamente com a mesma operação." };
    ["/", "/pedidos", "/estoque", "/entrada", "/saida", "/estatisticas", "/historico"].forEach(path => revalidatePath(path));
    return { ok: true, receipt };
  } catch {
    return { ok: false, transportUncertain: true, error: "Resultado não confirmado. Tente novamente com a mesma operação." };
  }
}
