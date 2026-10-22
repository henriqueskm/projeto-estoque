import { getCatalogCodeWriteIdentity } from "./catalog-code-policy";
import type { PhysicalStockItemType } from "./stock-calculations";

export const physicalCatalogLabels: Record<PhysicalStockItemType, string> = {
  SERVO: "Servo sem kit", INSTALLATION_KIT: "Kit de instalação",
  REPAIR_KIT: "Jogo de reparo", LOOSE_PART: "Peça avulsa",
};
export type PhysicalCatalogSnapshot = {
  id: string; code: string; description: string; itemType: PhysicalStockItemType;
  isActive: boolean; model: string | null; quantity: number; version: string;
  dependencies: Record<"configurations" | "recipes" | "compatibilities" | "applications" | "pendingOrders", number>;
};
export type PhysicalCatalogRequest = { reason: string } & (
  | { operation: "CREATE"; itemType: PhysicalStockItemType; code: string; description: string;
      model?: string; compatibleServoIds?: string[] }
  | { operation: "EDIT"; itemId: string; expectedVersion: string; code: string; description: string }
  | { operation: "ARCHIVE"; itemId: string; expectedVersion: string; expectedQuantity: number }
);
export type PhysicalCatalogReceipt = { operation: PhysicalCatalogRequest["operation"]; item: PhysicalCatalogSnapshot; idempotentReplay: boolean };
export type PhysicalCatalogResult = { ok: true; receipt: PhysicalCatalogReceipt }
  | { ok: false; error: string; stale?: boolean; uncertain?: boolean };
export const catalogUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dependencyKeys = ["configurations", "recipes", "compatibilities", "applications", "pendingOrders"] as const;
export function parsePhysicalCatalogSnapshot(value: unknown): PhysicalCatalogSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as PhysicalCatalogSnapshot;
  return typeof v.id === "string" && catalogUuidPattern.test(v.id)
    && typeof v.code === "string" && typeof v.description === "string" && Object.hasOwn(physicalCatalogLabels, v.itemType)
    && typeof v.isActive === "boolean" && (v.model === null || typeof v.model === "string")
    && Number.isSafeInteger(v.quantity) && v.quantity >= 0 && v.quantity <= 2_147_483_647
    && typeof v.version === "string" && /^[0-9a-f]{32}$/.test(v.version)
    && v.dependencies && dependencyKeys.every(k => Number.isSafeInteger(v.dependencies[k]) && v.dependencies[k] >= 0) ? v : null;
}
export function validatePhysicalCatalogRequest(request: PhysicalCatalogRequest): string | null {
  if (!request || !["CREATE", "EDIT", "ARCHIVE"].includes(request.operation)) return "Operação inválida.";
  if (typeof request.reason !== "string" || !request.reason.trim() || request.reason.trim().length > 500) return "Informe um motivo com até 500 caracteres.";
  if (request.operation !== "ARCHIVE" && (!getCatalogCodeWriteIdentity(request.code) || typeof request.description !== "string" || !request.description.trim() || request.description.trim().length > 500)) return "Confira código e descrição (até 500 caracteres).";
  if (request.operation === "CREATE") {
    if (!Object.hasOwn(physicalCatalogLabels, request.itemType)) return "Categoria inválida.";
    if (request.itemType === "SERVO" && (typeof request.model !== "string" || !request.model.trim() || request.model.trim().length > 120)) return "Informe o modelo do Servo (até 120 caracteres).";
    if (request.compatibleServoIds && (!Array.isArray(request.compatibleServoIds) || request.compatibleServoIds.length > 200 || request.compatibleServoIds.some(id => !catalogUuidPattern.test(id)))) return "Confira as compatibilidades.";
  } else if (!catalogUuidPattern.test(request.itemId) || !/^[0-9a-f]{32}$/.test(request.expectedVersion)) return "Atualize a prévia do produto.";
  if (request.operation === "ARCHIVE" && (!Number.isSafeInteger(request.expectedQuantity) || request.expectedQuantity < 0 || request.expectedQuantity > 2_147_483_647)) return "Saldo esperado inválido.";
  return null;
}
export function catalogPostCommitMatches(receipt: PhysicalCatalogReceipt, fresh: PhysicalCatalogSnapshot) {
  return receipt.item.id === fresh.id && receipt.item.itemType === fresh.itemType
    && receipt.item.code === fresh.code && receipt.item.description === fresh.description
    && fresh.isActive === (receipt.operation !== "ARCHIVE")
    && (receipt.operation !== "ARCHIVE" || fresh.quantity === 0);
}
