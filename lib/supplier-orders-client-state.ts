export function isLatestSupplierOrderRequest(
  requestSequence: number,
  currentSequence: number,
  requestedOrderId: string,
  currentOrderId: string | null,
) {
  return (
    requestSequence === currentSequence && requestedOrderId === currentOrderId
  );
}
