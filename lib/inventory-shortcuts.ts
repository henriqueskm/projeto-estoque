import { getServoFamilyLabel } from "@/lib/inventory-family";
import type { InventoryCommercialConfiguration } from "@/lib/inventory-types";
import type { PhysicalStockItemType } from "@/lib/stock-calculations";

export type InventoryShortcut = PhysicalStockItemType | "CONFIGURATION";

export function inventoryShortcutPlan(
  shortcut: InventoryShortcut,
  configurations: InventoryCommercialConfiguration[],
) {
  return shortcut === "CONFIGURATION"
    ? {
        scrollTarget: "configurations-title",
        physicalGroup: null,
        families: [...new Set(configurations.map((configuration) =>
          getServoFamilyLabel(configuration.servo.model, configuration.servo.description)))],
      }
    : {
        scrollTarget: `inventory-physical-${shortcut.toLocaleLowerCase("en-US")}`,
        physicalGroup: shortcut,
        families: [],
      };
}
