import type { PhysicalStockItemType } from "@/lib/stock-calculations";

export type InventoryShortcut = PhysicalStockItemType | "CONFIGURATION";

export function inventoryShortcutPlan(
  shortcut: InventoryShortcut,
) {
  return shortcut === "CONFIGURATION"
    ? {
        scrollTarget: "configurations-title",
        physicalGroup: null,
      }
    : {
        scrollTarget: `inventory-physical-${shortcut.toLocaleLowerCase("en-US")}`,
        physicalGroup: shortcut,
      };
}
