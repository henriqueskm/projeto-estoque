import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getSafisaPickupAlertKind,
  groupSafisaPickupAlertLines,
} from "../lib/safisa-pickup-alerts-contract.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function line(supplierOrderId, negotiationNumber, quantity) {
  return {
    supplierOrderId,
    negotiationNumber,
    orderDate: "2026-08-08",
    readyWaitingPickupQuantity: quantity,
  };
}

function summary(overrides = {}) {
  return {
    supplierOrderId: "order-a",
    negotiationNumber: "1212",
    orderDate: "2026-08-08",
    orderedQuantity: 10,
    cancelledQuantity: 0,
    readyQuantity: 4,
    pickedQuantity: 0,
    readyWaitingPickupQuantity: 4,
    cancelledAt: null,
    ...overrides,
  };
}

test("groups the official line reader into a single partial order alert", () => {
  const alerts = groupSafisaPickupAlertLines(
    [line("order-a", "1212", 4)],
    [summary()],
  );

  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0], {
    supplierOrderId: "order-a",
    negotiationNumber: "1212",
    orderDate: "2026-08-08",
    kind: "PARTIALLY_READY",
    readyWaitingPickupQuantity: 4,
    validOrderedQuantity: 10,
    readyQuantity: 4,
  });
});

test("classifies fully ready orders, including partial pickup and cancellations", () => {
  assert.equal(
    getSafisaPickupAlertKind({
      orderedQuantity: 10,
      cancelledQuantity: 0,
      readyQuantity: 10,
      readyWaitingPickupQuantity: 10,
    }),
    "FULLY_READY",
  );
  assert.equal(
    getSafisaPickupAlertKind({
      orderedQuantity: 10,
      cancelledQuantity: 0,
      readyQuantity: 10,
      readyWaitingPickupQuantity: 6,
    }),
    "FULLY_READY",
  );
  assert.equal(
    getSafisaPickupAlertKind({
      orderedQuantity: 10,
      cancelledQuantity: 3,
      readyQuantity: 7,
      readyWaitingPickupQuantity: 7,
    }),
    "FULLY_READY",
  );
});

test("omits orders with no current ready pickup and never derives negative values", () => {
  const alerts = groupSafisaPickupAlertLines(
    [line("order-a", "1212", 0)],
    [
      summary({
        orderedQuantity: -10,
        cancelledQuantity: -2,
        readyQuantity: -1,
        pickedQuantity: 4,
        readyWaitingPickupQuantity: 0,
      }),
    ],
  );

  assert.deepEqual(alerts, []);
  assert.equal(
    getSafisaPickupAlertKind({
      orderedQuantity: 10,
      cancelledQuantity: 0,
      readyQuantity: 4,
      readyWaitingPickupQuantity: 0,
    }),
    null,
  );
});

test("groups multiple ready lines into one order alert and counts orders, not lines", () => {
  const alerts = groupSafisaPickupAlertLines(
    [line("order-a", "1212", 3), line("order-a", "1212", 2)],
    [summary({ readyWaitingPickupQuantity: 5 })],
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].readyWaitingPickupQuantity, 5);
});

test("keeps two supplier orders as two alerts even when each has several lines", () => {
  const alerts = groupSafisaPickupAlertLines(
    [
      line("order-a", "1212", 2),
      line("order-a", "1212", 1),
      line("order-b", "40971", 3),
    ],
    [
      summary({ supplierOrderId: "order-a", readyWaitingPickupQuantity: 3 }),
      summary({
        supplierOrderId: "order-b",
        negotiationNumber: "40971",
        readyWaitingPickupQuantity: 3,
      }),
    ],
  );

  assert.equal(alerts.length, 2);
});

test("sorts fully ready orders before partial orders with stable recent ordering", () => {
  const alerts = groupSafisaPickupAlertLines(
    [line("order-a", "100", 2), line("order-b", "200", 1)],
    [
      summary({
        supplierOrderId: "order-a",
        negotiationNumber: "100",
        orderDate: "2026-08-09",
        readyQuantity: 2,
        readyWaitingPickupQuantity: 2,
      }),
      summary({
        supplierOrderId: "order-b",
        negotiationNumber: "200",
        orderDate: "2026-08-01",
        readyQuantity: 10,
        readyWaitingPickupQuantity: 1,
      }),
    ],
  );

  assert.deepEqual(
    alerts.map((alert) => alert.supplierOrderId),
    ["order-b", "order-a"],
  );
});

test("renders a read-only internal bell, Home summary, and order navigation", () => {
  const alertsUi = read("components/safisa-pickup-alerts.tsx");
  const shell = read("components/app-sidebar.tsx");
  const home = read("components/assistant-home.tsx");
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");

  assert.match(alertsUi, /aria-haspopup="dialog"/);
  assert.match(alertsUi, /event\.key !== "Escape"/);
  assert.match(alertsUi, /closeFromOutside/);
  assert.match(alertsUi, /Ver pedido/);
  assert.match(alertsUi, /Pronto para retirada/);
  assert.match(alertsUi, /Parcialmente pronto/);
  assert.doesNotMatch(alertsUi, /Retirar pedido|Cancelar pedido|Estoque/);
  assert.match(shell, /SafisaPickupAlertBell/);
  assert.match(home, /SafisaPickupAlertHomeSummary/);
  assert.match(orders, /SafisaPickupBadge/);
  assert.match(orders, /readyWaitingPickupQuantity > 0/);
});

test("refreshes only alert state on focus or a moderate visible interval", () => {
  const provider = read("components/safisa-pickup-alert-provider.tsx");
  const route = read("app/api/safisa-pickup-alerts/route.ts");

  assert.match(provider, /document\.visibilityState === "visible"/);
  assert.match(provider, /60_000/);
  assert.match(provider, /credentials: "same-origin"/);
  assert.doesNotMatch(provider, /router\.refresh/);
  assert.match(route, /require.*profile|from\("profiles"\)/i);
  assert.match(route, /Cache-Control": "no-store"/);
});
