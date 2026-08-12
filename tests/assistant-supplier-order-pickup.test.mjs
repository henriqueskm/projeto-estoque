import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createSupplierOrderPickupProposalToken,
  verifySupplierOrderPickupProposalToken,
} from "../lib/ai/assistant-action-token-core.ts";
import {
  classifySupplierOrderPickupRpcFailure,
  createSupplierOrderPickupCheckedRpcCall,
  parseSupplierOrderPickupRpcResult,
} from "../lib/ai/supplier-order-pickup-execution.ts";
import {
  calculateSupplierOrderPickupTarget,
  routeSupplierOrderPickupAction,
  summarizeSupplierOrderMarkAll,
  validateSupplierOrderPickupLine,
} from "../lib/ai/supplier-order-pickup-routing.ts";

const userId = "10000000-0000-4000-8000-000000000001";
const orderId = "10000000-0000-4000-8000-000000000002";
const itemId = "10000000-0000-4000-8000-000000000003";
const key = "10000000-0000-4000-8000-000000000004";
const entryId = "10000000-0000-4000-8000-000000000005";
const batchId = "10000000-0000-4000-8000-000000000006";
const secret = "local-test-secret-with-at-least-32-characters";

function line(overrides = {}) {
  return {
    orderedQuantity: 10,
    readyQuantity: 3,
    pickedQuantity: 1,
    stockedQuantity: 1,
    cancelledQuantity: 0,
    ...overrides,
  };
}

test("direct pickup quantities route as increments", () => {
  const cases = [
    ["Retire 1 do Cód. 11A no Pedido 1212", 1, "11A", "1212"],
    ["retirar 2 do 2e no pedido teste 01", 2, "2E", "teste 01"],
    ["Retire uma do código 6A.", 1, "6A", null],
    ["RETIRE 1 DO CÓD. 11A NO PEDIDO 1212", 1, "11A", "1212"],
  ];

  for (const [message, requestedQuantity, catalogCode, negotiationNumber] of cases) {
    assert.deepEqual(routeSupplierOrderPickupAction(message), {
      kind: "PICKUP_ACTION",
      request: {
        mode: "increment",
        catalogCode,
        requestedQuantity,
        negotiationNumber,
      },
    });
  }

  assert.deepEqual(calculateSupplierOrderPickupTarget("increment", 2, 1), {
    targetPickedQuantity: 3,
    addedQuantity: 1,
  });
});

test("explicit totals remain set_total and genuinely ambiguous wording remains ambiguous", () => {
  for (const message of [
    "Defina o total retirado do Cód. 11A como 3 no Pedido 1212",
    "Deixe o total retirado do Cód. 11A em 3 no Pedido 1212",
  ]) {
    const result = routeSupplierOrderPickupAction(message);
    assert.equal(result.kind, "PICKUP_ACTION");
    assert.equal(result.request.mode, "set_total");
    assert.equal(result.request.requestedQuantity, 3);
    assert.equal(result.request.catalogCode, "11A");
    assert.equal(result.request.negotiationNumber, "1212");
  }

  assert.deepEqual(
    routeSupplierOrderPickupAction("Marque 3 do Cód. 11A no Pedido 1212"),
    {
      kind: "AMBIGUOUS_PICKUP_MODE",
      catalogCode: "11A",
      requestedQuantity: 3,
      negotiationNumber: "1212",
    },
  );
});

test("confirmation text and pickup reads never become direct pickup actions", () => {
  assert.equal(routeSupplierOrderPickupAction("sim").kind, "BUTTON_CONFIRMATION_TEXT");
  assert.equal(
    routeSupplierOrderPickupAction("Quanto foi retirado do Cód. 11A no Pedido 1212?").kind,
    "NOT_PICKUP_ACTION",
  );
});

test("ready quantity, not ordered quantity, bounds each pickup preview", () => {
  assert.deepEqual(validateSupplierOrderPickupLine("increment", 1, line({ readyQuantity: 0, pickedQuantity: 0, stockedQuantity: 0 })), {
    kind: "above_limit",
    pickupLimit: 0,
    availableQuantity: 0,
  });

  assert.deepEqual(validateSupplierOrderPickupLine("increment", 2, line({ readyQuantity: 2 })), {
    kind: "above_limit",
    pickupLimit: 2,
    availableQuantity: 1,
  });

  assert.deepEqual(validateSupplierOrderPickupLine("increment", 2, line()), {
    kind: "valid",
    targetPickedQuantity: 3,
    addedQuantity: 2,
    remainingAfter: 0,
    availableQuantity: 2,
  });
});

test("set total blocks reduction and treats equal totals as no change", () => {
  const current = line({ pickedQuantity: 2 });
  assert.equal(validateSupplierOrderPickupLine("set_total", 1, current).kind, "reduction");
  assert.equal(validateSupplierOrderPickupLine("set_total", 2, current).kind, "no_change");
  const increased = validateSupplierOrderPickupLine("set_total", 3, current);
  assert.equal(increased.kind, "valid");
  assert.equal(increased.addedQuantity, 1);
});

test("mark all includes only ready deltas and leaves historical backlog separate", () => {
  assert.deepEqual(summarizeSupplierOrderMarkAll([
    line(),
    line({ readyQuantity: 4, pickedQuantity: 4, stockedQuantity: 2 }),
    line({ readyQuantity: 5, pickedQuantity: 3, stockedQuantity: 1 }),
  ]), {
    changedLines: 2,
    addedPickedQuantity: 4,
  });
});

test("checked executor keeps one fixed RPC per pickup mode", () => {
  const base = {
    version: 1,
    action: "supplier_order_pickup",
    userId,
    supplierOrderId: orderId,
    expectedOrderUpdatedAt: "2026-08-12T01:02:03.123456+00:00",
    idempotencyKey: key,
    issuedAt: 1,
    expiresAt: 2,
  };
  const lineCall = createSupplierOrderPickupCheckedRpcCall({
    ...base,
    mode: "increment",
    supplierOrderItemId: itemId,
    requestedQuantity: 2,
    targetPickedQuantity: 3,
  });
  assert.equal(lineCall?.name, "set_supplier_order_item_picked_quantity_checked");
  assert.equal(lineCall?.arguments.p_target_picked_quantity, 3);

  const allCall = createSupplierOrderPickupCheckedRpcCall({
    ...base,
    mode: "mark_all",
    supplierOrderItemId: null,
    requestedQuantity: null,
    targetPickedQuantity: null,
  });
  assert.equal(allCall?.name, "mark_supplier_order_all_picked_checked");
});

test("compound receipt recognizes automatic stock entry and remains backward compatible", () => {
  const result = parseSupplierOrderPickupRpcResult({
    previous_picked_quantity: 1,
    new_picked_quantity: 3,
    picked_quantity_delta: 2,
    idempotent_replay: false,
    supplier_order_stock_entry_id: entryId,
    movement_batch_id: batchId,
    stock_entry_line_count: 1,
    stock_entry_quantity: 2,
    stock_entry_created_at: "2026-08-12T10:00:00.123456+00:00",
  }, "increment");
  assert.equal(result?.mode, "line");
  assert.equal(result?.value.stockEntry?.quantity, 2);

  const legacy = parseSupplierOrderPickupRpcResult({
    previous_picked_quantity: 1,
    new_picked_quantity: 2,
    picked_quantity_delta: 1,
    idempotent_replay: false,
  }, "increment");
  assert.equal(legacy?.mode, "line");
  assert.equal(legacy?.value.stockEntry, null);

  assert.equal(parseSupplierOrderPickupRpcResult({
    previous_picked_quantity: 1,
    new_picked_quantity: 3,
    picked_quantity_delta: 2,
    idempotent_replay: false,
    supplier_order_stock_entry_id: entryId,
    movement_batch_id: batchId,
    stock_entry_line_count: 1,
    stock_entry_quantity: 1,
    stock_entry_created_at: "2026-08-12T10:00:00Z",
  }, "increment"), null);
});

test("HMAC keeps user binding, expiry, and microsecond timestamp", () => {
  const issued = new Date("2026-08-12T10:00:00Z");
  const signed = createSupplierOrderPickupProposalToken({
    mode: "increment",
    userId,
    supplierOrderId: orderId,
    supplierOrderItemId: itemId,
    requestedQuantity: 2,
    targetPickedQuantity: 3,
    expectedOrderUpdatedAt: "2026-08-12T01:02:03.123456+00:00",
    idempotencyKey: key,
  }, secret, issued);
  assert.ok(signed);
  const verified = verifySupplierOrderPickupProposalToken(signed.token, secret, userId, issued);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.expectedOrderUpdatedAt, "2026-08-12T01:02:03.123456+00:00");
  assert.equal(verifySupplierOrderPickupProposalToken(signed.token, secret, orderId, issued).reason, "user_mismatch");
  assert.equal(verifySupplierOrderPickupProposalToken(signed.token, secret, userId, new Date("2026-08-12T10:11:00Z")).reason, "expired");
});

test("ready and reduction database errors receive safe dedicated classifications", () => {
  assert.equal(classifySupplierOrderPickupRpcFailure({
    data: null,
    error: { code: "22023", message: "picked_quantity cannot exceed ready_quantity" },
  }), "not_ready");
  assert.equal(classifySupplierOrderPickupRpcFailure({
    data: null,
    error: { code: "22023", message: "picked_quantity cannot be reduced by the pickup operation" },
  }), "reduction_not_allowed");
});

test("UI and Assistant describe one compound operation without a second stock RPC", () => {
  const assistant = readFileSync("lib/assistant-supplier-order-pickup.ts", "utf8");
  const execution = readFileSync("lib/ai/supplier-order-pickup-execution.ts", "utf8");
  const blocks = readFileSync("components/assistant-structured-block.tsx", "utf8");
  const types = readFileSync("lib/assistant-types.ts", "utf8");
  const orders = readFileSync("app/(authenticated)/pedidos/orders-workspace.tsx", "utf8");

  assert.match(assistant, /item!\.readyQuantity/);
  assert.doesNotMatch(assistant, /create_supplier_order_stock_entry/);
  assert.doesNotMatch(execution, /create_supplier_order_stock_entry/);
  assert.match(types, /Confirmar retirada \+ entrada/);
  assert.match(blocks, /Pendente antigo de entrada/);
  assert.match(orders, /const minimum = item\.pickedQuantity/g);
  assert.match(orders, /Retirar tudo que está pronto/);
  assert.match(orders, /Entrada automática no estoque/);
});
