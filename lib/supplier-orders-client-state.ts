import type {
  SupplierOrderItem,
  SupplierOrderMediaItem,
} from "@/lib/supplier-orders-types";

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

export function mergeSupplierOrderMedia(
  items: SupplierOrderItem[],
  mediaItems: SupplierOrderMediaItem[],
) {
  const mediaByItemId = new Map(mediaItems.map((item) => [item.id, item]));

  return items.map((item) => {
    const media = mediaByItemId.get(item.id);
    return media
      ? {
          ...item,
          imageUrl: media.imageUrl,
          compatibleKitImages: media.compatibleKitImages,
        }
      : item;
  });
}
