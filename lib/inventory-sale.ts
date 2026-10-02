import type { InventoryActionTarget } from "@/lib/inventory-action-types";
import type { OutboundReceipt, OutboundRequestLine } from "@/lib/outbound-types";

export type InventorySaleRequest = {
  p_lines: OutboundRequestLine[];
  p_idempotency_key: string;
  p_description: string | null;
};
export type InventorySaleReceipt = OutboundReceipt & {
  quantityBefore: number;
  quantityAfter: number;
};
export type InventorySaleActionResult =
  | { ok: true; receipt: InventorySaleReceipt }
  | { ok: false; error: string; stale?: true };

export function inventorySaleAvailable(target: InventoryActionTarget) {
  return target.kind === "ITEM" ? target.looseQuantity
    : target.kind === "CONFIGURATION" ? target.assembledQuantity : target.readyQuantity;
}

export function inventorySaleCodes(target: InventoryActionTarget) {
  if (target.kind === "ITEM" || !target.isActive) return [];
  return target.commercialAliases.filter(
    (alias): alias is { id: string; code: string; isActive: boolean } =>
      alias.isActive && Boolean(alias.id),
  );
}

export function buildInventorySaleRequest(
  target: InventoryActionTarget,
  codeId: string,
  quantity: number,
  description: string,
  idempotencyKey: string,
): InventorySaleRequest | null {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2_147_483_647 ||
    quantity > inventorySaleAvailable(target) || description.trim().length > 500) return null;
  if (target.kind !== "ITEM" && !inventorySaleCodes(target).some((code) => code.id === codeId)) return null;
  const line: OutboundRequestLine = target.kind === "ITEM"
    ? { kind: "ITEM", item_id: target.itemId, quantity }
    : target.kind === "CONFIGURATION"
      ? { kind: "COMMERCIAL_CODE", commercial_code_id: codeId, quantity }
      : { kind: "BUNDLE_CODE", bundle_code_id: codeId, quantity };
  return { p_lines: [line], p_idempotency_key: idempotencyKey, p_description: description.trim() || null };
}

/** Freezes a single attempt, including its key, across transport errors/retries. */
export function createInventorySaleAttempt() {
  let request: InventorySaleRequest | null = null;
  let inFlight = false;
  return {
    get request() { return request; },
    async submit(input: InventorySaleRequest, writer: (request: InventorySaleRequest) => Promise<InventorySaleActionResult>) {
      if (inFlight) return null;
      request ??= input;
      inFlight = true;
      try { return await writer(request); }
      finally { inFlight = false; }
    },
  };
}

export function formatInventorySaleFeedback(target: InventoryActionTarget, code: string, receipt: InventorySaleReceipt) {
  const unit = target.kind === "BUNDLE" ? "conjunto(s) pronto(s)"
    : target.kind === "CONFIGURATION" ? "Servos com kit"
      : target.itemType === "SERVO" ? "sem kit" : "avulsos";
  return `Venda confirmada. ${code}: ${receipt.quantityBefore} → ${receipt.quantityAfter} ${unit}.`;
}
