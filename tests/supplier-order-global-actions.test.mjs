import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getSupplierOrderGlobalActionVisibility } from "../lib/supplier-order-global-actions.ts";

function visibility(readyWaitingPickupQuantity, waitingStockQuantity) {
  return getSupplierOrderGlobalActionVisibility({
    canMarkAll: true,
    readyWaitingPickupQuantity,
    waitingStockQuantity,
  });
}

test("shows both global actions when ready pickup and historical backlog exist", () => {
  assert.deepEqual(visibility(2, 3), {
    showMarkAll: true,
    showStockEntry: true,
    showDock: true,
  });
});

test("shows only mark all when ready pickup exists without backlog", () => {
  assert.deepEqual(visibility(2, 0), {
    showMarkAll: true,
    showStockEntry: false,
    showDock: true,
  });
});

test("shows only stock entry when backlog exists without ready pickup", () => {
  assert.deepEqual(visibility(0, 3), {
    showMarkAll: false,
    showStockEntry: true,
    showDock: true,
  });
});

test("renders no dock when neither global action applies", () => {
  assert.deepEqual(visibility(0, 0), {
    showMarkAll: false,
    showStockEntry: false,
    showDock: false,
  });
});

test("mark all remains hidden when the order is not eligible", () => {
  assert.deepEqual(
    getSupplierOrderGlobalActionVisibility({
      canMarkAll: false,
      readyWaitingPickupQuantity: 2,
      waitingStockQuantity: 0,
    }),
    {
      showMarkAll: false,
      showStockEntry: false,
      showDock: false,
    },
  );
});

test("uses a compact sticky dock inside the scroll region", () => {
  const workspace = readFileSync(
    "app/(authenticated)/pedidos/orders-workspace.tsx",
    "utf8",
  );

  assert.match(workspace, /data-testid="supplier-order-action-dock"/);
  assert.match(workspace, /pointer-events-none sticky bottom-2/);
  assert.match(workspace, /max-w-\[min\(100%,17rem\)\] flex-col/);
  assert.match(workspace, /sm:flex-row sm:items-center/);
  assert.match(workspace, /bg-surface\/95 p-1 shadow/);
  assert.match(workspace, /min-h-10/);
  assert.doesNotMatch(workspace, /inline-flex max-w-full flex-wrap/);
  assert.doesNotMatch(
    workspace,
    /grid shrink-0 gap-1\.5 border-t border-border-neutral bg-app-background\/95/,
  );
});
