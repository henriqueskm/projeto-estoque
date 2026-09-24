export const inventoryDataChangedEvent = "nk:inventory-data-changed";

export function notifyInventoryDataChanged() {
  window.dispatchEvent(new Event(inventoryDataChangedEvent));
}
