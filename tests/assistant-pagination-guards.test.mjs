import assert from "node:assert/strict";
import test from "node:test";

import {
  findOrdersContainingCode,
  loadItemsForOrders,
  loadOrderItems,
} from "../lib/assistant-supplier-order-pickup.ts";
import { loadLines } from "../lib/assistant-supplier-order-stock-entry.ts";

const uuid = (index) =>
  `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const firstOrderId = uuid(1);
const secondOrderId = uuid(2);

function itemRow(index, orderId) {
  return {
    id: uuid(10_000 + index),
    supplier_order_id: orderId,
    item_id: uuid(100_000 + index),
    commercial_configuration_id: null,
    commercial_configuration_code_id: null,
    code_snapshot: "P-1",
    description_snapshot: `Peça ${index}`,
    model_snapshot: null,
    item_type_snapshot: "LOOSE_PART",
    commercial_code_snapshot: null,
    ordered_quantity: 2,
    ready_quantity: 1,
    picked_quantity: 0,
    stocked_quantity: 0,
    cancelled_quantity: 0,
    waiting_pickup_quantity: 1,
    waiting_ready_quantity: 1,
    ready_waiting_pickup_quantity: 1,
    waiting_stock_quantity: 0,
    position: index,
    notes: null,
    created_at: "2026-09-20T12:00:00.000Z",
    updated_at: "2026-09-20T12:00:00.000Z",
  };
}

function fakeClient(details) {
  const ranges = [];
  return {
    ranges,
    from(table) {
      assert.equal(table, "supplier_order_item_details");
      const filters = [];
      const orders = [];
      const query = {
        select() { return query; },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return query;
        },
        in(column, values) {
          const accepted = new Set(values);
          filters.push((row) => accepted.has(row[column]));
          return query;
        },
        or() { return query; },
        order(column, { ascending = true } = {}) {
          orders.push({ column, ascending });
          return query;
        },
        range(from, to) {
          ranges.push([from, to]);
          const rows = details.filter((row) => filters.every((filter) => filter(row)));
          rows.sort((left, right) => {
            for (const order of orders) {
              const comparison = String(left[order.column]).localeCompare(String(right[order.column]));
              if (comparison !== 0) return order.ascending ? comparison : -comparison;
            }
            return 0;
          });
          return Promise.resolve({
            data: rows.slice(from, Math.min(to + 1, from + 1_000)),
            error: null,
          });
        },
      };
      return query;
    },
  };
}

test("sentinela de 1001 lê a segunda página e mantém o teto de 1000 por Pedido", async () => {
  let client = fakeClient(
    Array.from({ length: 1_000 }, (_, index) => itemRow(index, firstOrderId)),
  );
  let loaded = await loadOrderItems(client, firstOrderId);
  assert.equal(loaded.failed, false);
  assert.equal(loaded.items.length, 1_000);
  assert.deepEqual(client.ranges, [[0, 999], [1_000, 1_000]]);

  client = fakeClient(
    Array.from({ length: 1_001 }, (_, index) => itemRow(index, firstOrderId)),
  );
  loaded = await loadOrderItems(client, firstOrderId);
  assert.equal(loaded.failed, true);
  assert.deepEqual(loaded.items, []);

  const stockEntry = await loadLines(client, firstOrderId);
  assert.equal(stockEntry.failed, true);
});

test("multi-Pedidos aceita mais de 1000 linhas totais e rejeita 1001 em um Pedido", async () => {
  const validRows = [
    ...Array.from({ length: 700 }, (_, index) => itemRow(index, firstOrderId)),
    ...Array.from({ length: 700 }, (_, index) => itemRow(2_000 + index, secondOrderId)),
  ];
  let result = await loadItemsForOrders(
    fakeClient(validRows),
    [firstOrderId, secondOrderId],
  );
  assert.equal(result.failed, false);
  assert.equal(result.itemsByOrder.get(firstOrderId).length, 700);
  assert.equal(result.itemsByOrder.get(secondOrderId).length, 700);

  const invalidRows = [
    ...Array.from({ length: 1_001 }, (_, index) => itemRow(index, firstOrderId)),
    itemRow(3_000, secondOrderId),
  ];
  result = await loadItemsForOrders(
    fakeClient(invalidRows),
    [firstOrderId, secondOrderId],
  );
  assert.equal(result.failed, true);
  assert.equal(result.itemsByOrder.size, 0);
});

test("busca ampla preserva o fail-closed quando existem mais de 1000 matches", async () => {
  const client = fakeClient(
    Array.from({ length: 1_001 }, (_, index) => itemRow(index, firstOrderId)),
  );
  const result = await findOrdersContainingCode(client, "P-1");
  assert.equal(result.failed, true);
  assert.deepEqual(result.candidates, []);
  assert.ok(client.ranges.some(([from, to]) => from === 1_000 && to === 1_000));
});
