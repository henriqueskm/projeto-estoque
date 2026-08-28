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
      data.type !== "SAFISA_FULLY_READY" ||
      typeof data.supplierOrderId !== "string" ||
      !supplierOrderIdPattern.test(data.supplierOrderId) ||
      typeof data.negotiationNumber !== "string" ||
      !negotiationNumberPattern.test(data.negotiationNumber)
    ) {
      return null;
    }

    return {
      supplierOrderId: data.supplierOrderId,
      negotiationNumber: data.negotiationNumber,
      url: `/pedidos?order=${encodeURIComponent(data.supplierOrderId)}`,
    };
  } catch {
    return null;
  }
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

  event.waitUntil(
    self.registration.showNotification("Pedido pronto para retirada ✅", {
      body: `Pedido ${data.negotiationNumber} está completamente pronto na Safisa.`,
      icon: "/icons/nk-app-icon-192.png",
      badge: "/icons/nk-app-icon-192.png",
      tag: `safisa-fully-ready:${data.supplierOrderId}`,
      renotify: false,
      data: {
        type: "SAFISA_FULLY_READY",
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
