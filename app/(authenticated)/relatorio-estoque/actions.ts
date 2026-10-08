"use server";

import { revalidatePath } from "next/cache";
import { requireActiveProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isInventoryReportOrder } from "@/lib/inventory-report";

export async function saveInventoryReportOrder(order: unknown): Promise<{ success: boolean; error?: string }> {
  await requireActiveProfile();
  if (!isInventoryReportOrder(order)) return { success: false, error: "Inclua as seis categorias, sem repetições." };
  try {
    const client = await createClient();
    // Normal RLS, column-level UPDATE only. The database derives author/time.
    const { data, error } = await client.from("inventory_report_settings")
      .update({ category_order: order }).eq("singleton", true).select("category_order").single();
    if (error || !data || !isInventoryReportOrder(data.category_order)) return {
      success: false, error: "Não foi possível salvar a ordem. Confira sua sessão e se a migration do relatório já foi autorizada e aplicada.",
    };
    revalidatePath("/relatorio-estoque");
    return { success: true };
  } catch {
    return { success: false, error: "Não foi possível confirmar o salvamento. Tente novamente." };
  }
}
