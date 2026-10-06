/* global self */

"use strict";

const supplierOrderIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const negotiationNumberPattern = /^\d+$/;

function pushDataFromEvent(event) {
  if (!event.data) return null;

  try {
    const payload = event.data.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const data = payload.data && typeof payload.data === "object"
      ? payload.data
      : payload;

    if (
      (data.type !== "SAFISA_FULLY_READY" && data.type !== "SAFISA_ITEM_READY") ||
      typeof data.supplierOrderId !== "string" ||
      !supplierOrderIdPattern.test(data.supplierOrderId) ||
      typeof data.negotiationNumber !== "string" ||
      !negotiationNumberPattern.test(data.negotiationNumber) || data.negotiationNumber.length > 120
    ) {
      return null;
    }

    const base = {
      type: data.type,
      supplierOrderId: data.supplierOrderId,
      negotiationNumber: data.negotiationNumber,
      url: `/pedidos?order=${encodeURIComponent(data.supplierOrderId)}`,
    };
    if (data.type === "SAFISA_FULLY_READY") return base;
    if (typeof data.eventId !== "string" || !supplierOrderIdPattern.test(data.eventId) ||
        typeof data.supplierOrderItemId !== "string" || !supplierOrderIdPattern.test(data.supplierOrderItemId) ||
        !isNotificationText(data.code, 80) || !isNotificationText(data.description, 300) ||
        typeof data.quantity !== "string" || !/^[1-9]\d{0,9}$/.test(data.quantity) ||
        Number(data.quantity) > 2147483647 ||
        (data.url !== undefined && data.url !== base.url)) return null;
    return { ...base, eventId: data.eventId, supplierOrderItemId: data.supplierOrderItemId,
      code: data.code, description: data.description, quantity: data.quantity };
  } catch {
    return null;
  }
}

function isNotificationText(value, limit) {
  return typeof value === "string" && value.trim().length > 0 &&
    Array.from(value).length <= limit && !/[<>\u0000-\u001f\u007f]/.test(value);
}

function safeNotificationUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== "/pedidos") {
      return null;
    }
    const orderId = url.searchParams.get("order");
    if (!orderId || !supplierOrderIdPattern.test(orderId)) return null;

    return `${url.pathname}?order=${encodeURIComponent(orderId)}`;
  } catch {
    return null;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const data = pushDataFromEvent(event);
  if (!data) return;

  const itemReady = data.type === "SAFISA_ITEM_READY";
  event.waitUntil(
    self.registration.showNotification(itemReady
      ? `Item pronto no pedido ${data.negotiationNumber} ✅` : "Pedido pronto para retirada ✅", {
      body: itemReady
        ? `Cód. ${data.code} — ${data.description} — ${data.quantity} ${data.quantity === "1" ? "unidade pronta" : "unidades prontas"}.`
        : `Pedido ${data.negotiationNumber} está completamente pronto na Safisa.`,
      icon: "/icons/nk-app-icon-192.png",
      badge: "/icons/nk-app-icon-192.png",
      tag: itemReady ? `safisa-item-ready:${data.eventId}` : `safisa-fully-ready:${data.supplierOrderId}`,
      renotify: false,
      data: {
        type: data.type,
        ...(itemReady ? { eventId: data.eventId, supplierOrderItemId: data.supplierOrderItemId } : {}),
        supplierOrderId: data.supplierOrderId,
        url: data.url,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = safeNotificationUrl(event.notification.data?.url);
  if (!destination) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windowClients) => {
        const existingClient = windowClients.find((client) => {
          try {
            return new URL(client.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });

        if (existingClient) {
          if ("navigate" in existingClient) {
            await existingClient.navigate(destination);
          }
          return existingClient.focus();
        }

        return self.clients.openWindow(destination);
      }),
  );
});
