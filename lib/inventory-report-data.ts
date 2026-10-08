import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadInventoryData } from "@/lib/inventory-data";
import { buildInventoryReport, inventoryReportCategories, isInventoryReportOrder, type InventoryReportSettings } from "@/lib/inventory-report";

export async function loadInventoryReportSettings(): Promise<InventoryReportSettings> {
  const client = await createClient();
  const { data, error } = await client.from("inventory_report_settings").select("category_order").eq("singleton", true).maybeSingle();
  if (error || !data) {
    if (error?.code === "42P01" || error?.code === "PGRST205") return {
      categoryOrder: [...inventoryReportCategories], available: false,
      notice: "Ordem padrão em uso. Salvar uma ordem compartilhada requer a migration do relatório, ainda pendente de autorização.",
    };
    throw new Error("Não foi possível carregar a ordem compartilhada do relatório.");
  }
  if (!isInventoryReportOrder(data.category_order)) throw new Error("A ordem das categorias do relatório é inválida.");
  return { categoryOrder: data.category_order, available: true, notice: null };
}
export async function loadInventoryReportData() {
  const [inventory, settings] = await Promise.all([
    loadInventoryData({ includeInactivePhysical: true }), loadInventoryReportSettings(),
  ]);
  if (!inventory.data) throw new Error(inventory.error);
  return { report: buildInventoryReport(inventory.data), settings, generatedAt: new Date().toISOString() };
}
