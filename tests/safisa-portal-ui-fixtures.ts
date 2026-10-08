import type { SafisaOrderDetail, SafisaOrderLine, SafisaOrderSummary } from "../lib/safisa-portal-types";

export const fixtureUserId = "87000000-0000-4000-8000-000000000001";
export const fixtureDate = "2026-10-08T12:00:00Z";
const id = (suffix: number) => `87000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function line(suffix: number, code: string, description: string, ordered: number, ready: number, picked = 0): SafisaOrderLine {
  return {
    supplierOrderItemId: id(suffix), code, description, model: null, itemType: "SERVO", commercialCode: code,
    orderedQuantity: ordered, readyQuantity: ready, pickedQuantity: picked,
    waitingReadyQuantity: ordered - ready, readyWaitingPickupQuantity: ready - picked,
    readinessStatus: ready === ordered ? "COMPLETELY_READY" : ready > 0 ? "PARTIALLY_READY" : "NOT_READY",
    position: suffix, updatedAt: fixtureDate,
  };
}

function order(suffix: number, number: string, lines: SafisaOrderLine[], closed = false): SafisaOrderDetail {
  const sum = (field: "orderedQuantity" | "readyQuantity" | "pickedQuantity" | "waitingReadyQuantity" | "readyWaitingPickupQuantity") => lines.reduce((total, item) => total + item[field], 0);
  return {
    supplierOrderId: id(suffix), negotiationNumber: number, orderDate: "2026-10-08", lines, events: [],
    orderedQuantity: sum("orderedQuantity"), readyQuantity: sum("readyQuantity"), pickedQuantity: sum("pickedQuantity"),
    waitingReadyQuantity: sum("waitingReadyQuantity"), readyWaitingPickupQuantity: sum("readyWaitingPickupQuantity"),
    readinessStatus: sum("waitingReadyQuantity") === 0 ? "COMPLETELY_READY" : sum("readyQuantity") > 0 ? "PARTIALLY_READY" : "NOT_READY",
    closureKind: closed ? "FINALIZED" : null, portalState: closed ? "COMPLETED" : "ACTIVE", isReadOnly: closed,
    updatedAt: fixtureDate,
  };
}

export const partialOrder = order(101, "40959", [
  line(201, "1H", "SERVO MBF-025", 3, 3, 1),
  line(202, "2A", "SERVO MBF-025 + KT-18", 5, 2),
]);
export const readyOrder = order(102, "40971", [line(203, "6C", "SERVO MBF-100", 5, 5)]);
export const historyOrder = order(103, "40980", [line(204, "KT-18", "KIT DE INSTALAÇÃO", 2, 2, 2)], true);
export const extremeOrder = order(104, "999999999999999999", [
  line(205, "CODIGO-MUITO-LONGO-SEM-ESPACOS-123456789", "Descrição sanitizada muito longa para testar quebra de texto e leitura do Pedido sem perder os controles operacionais em um viewport estreito.", 9999, 9998, 9000),
]);
export const fixtureOrders = [partialOrder, readyOrder, historyOrder, extremeOrder];
export function asSummary({ lines, events: _events, ...value }: SafisaOrderDetail): SafisaOrderSummary {
  void _events;
  return { ...value, lineCount: lines.length };
}
