import type { SafisaReadinessStatus } from "@/lib/safisa-portal-types";

export function readinessLabel(
  status: SafisaReadinessStatus,
  readyQuantity: number,
  pickedQuantity: number,
) {
  if (
    status === "COMPLETELY_READY" &&
    readyQuantity > 0 &&
    pickedQuantity >= readyQuantity
  ) {
    return "Retirado";
  }
  if (pickedQuantity > 0) return "Retirada parcial";
  if (status === "COMPLETELY_READY") return "Tudo pronto";
  if (status === "PARTIALLY_READY") return "Parcialmente pronto";
  return "Não iniciado";
}

export function maximumReadyQuantity(
  readyQuantity: number,
  waitingReadyQuantity: number,
) {
  return readyQuantity + waitingReadyQuantity;
}
