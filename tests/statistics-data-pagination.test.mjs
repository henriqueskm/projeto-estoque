import assert from "node:assert/strict";
import test from "node:test";

import { loadStatisticsData } from "../lib/statistics-data.ts";

const size = 1_001;
const pad = (value) => String(value).padStart(4, "0");
const batches = Array.from({ length: size }, (_, index) => ({
  id: `batch-${pad(index)}`,
  movement_type:
    index === 0
      ? "INBOUND"
      : index === 1
        ? "OUTBOUND"
        : index === 2
          ? "ASSEMBLY"
          : "ADJUSTMENT",
  occurred_at: "2026-09-14T12:00:00.000Z",
}));
const items = Array.from({ length: size }, (_, index) => ({
  id: `item-${pad(index)}`,
  code: `I${pad(index)}`,
  description: `Item ${index}`,
  item_type:
    index === 0
      ? "SERVO"
      : index === 1
        ? "INSTALLATION_KIT"
        : "LOOSE_PART",
  minimum_stock: 0,
  is_active: true,
}));
const configurations = Array.from({ length: size }, (_, index) => ({
  id: `config-${pad(index)}`,
  description: `Configuration ${index}`,
  servo_id: "item-0000",
  installation_kit_id: "item-0001",
  minimum_stock: 0,
  is_active: true,
}));
const commercialCodes = configurations.map((configuration, index) => ({
  id: `code-${pad(index)}`,
  configuration_id: configuration.id,
  code: `C${pad(index)}`,
  is_active: true,
}));
const rows = {
  movement_batches: batches,
  items,
  commercial_configurations: configurations,
  commercial_configuration_codes: commercialCodes,
  stock_balances: items.map((entry, index) => ({
    item_id: entry.id,
    quantity: index === size - 1 ? 5 : 0,
  })),
  configuration_stock_balances: configurations.map((entry, index) => ({
    configuration_id: entry.id,
    quantity: index === size - 1 ? 7 : 0,
  })),
  inbound_batch_lines: Array.from({ length: size }, (_, index) => ({
    id: `in-${pad(index)}`,
    batch_id: "batch-0000",
    item_id: "item-1000",
    commercial_configuration_code_id: null,
    quantity: 1,
  })),
  outbound_batch_lines: Array.from({ length: size }, (_, index) => ({
    id: `out-${pad(index)}`,
    batch_id: "batch-0001",
    item_id: index === size - 1 ? "item-1000" : null,
    commercial_configuration_code_id:
      index === size - 1 ? null : "code-1000",
    quantity: 1,
    assembled_quantity_used: index === size - 1 ? 0 : 1,
    auto_assembled_quantity: 0,
  })),
  stock_movements: items.map((entry, index) => ({
    id: `stock-${pad(index)}`,
    batch_id: "batch-0000",
    item_id: entry.id,
    quantity_change: 1,
  })),
  configuration_stock_movements: configurations.map((entry, index) => ({
    id: `configuration-movement-${pad(index)}`,
    batch_id: "batch-0001",
    configuration_id: entry.id,
    quantity_change: -1,
  })),
  assembly_operations: Array.from({ length: size }, (_, index) => ({
    id: `assembly-${pad(index)}`,
    batch_id: "batch-0002",
    configuration_id: "config-1000",
    operation_type: "ASSEMBLY",
    quantity: 1,
    commercial_code_snapshot: "C1000",
  })),
};

function fakeClient() {
  const calls = new Map();

  return {
    calls,
    from(table) {
      const filters = [];
      const orders = [];
      const builder = {
        select() {
          return builder;
        },
        gte(column, value) {
          filters.push((row) => row[column] >= value);
          return builder;
        },
        lt(column, value) {
          filters.push((row) => row[column] < value);
          return builder;
        },
        in(column, values) {
          const accepted = new Set(values);
          filters.push((row) => accepted.has(row[column]));
          return builder;
        },
        order(column, { ascending }) {
          orders.push({ column, ascending });
          return builder;
        },
        range(from, to) {
          const tableCalls = calls.get(table) ?? [];
          tableCalls.push([from, to]);
          calls.set(table, tableCalls);
          const filtered = (rows[table] ?? []).filter((row) =>
            filters.every((filter) => filter(row)),
          );
          filtered.sort((first, second) => {
            for (const order of orders) {
              const comparison = String(first[order.column]).localeCompare(
                String(second[order.column]),
              );
              if (comparison !== 0) return order.ascending ? comparison : -comparison;
            }
            return 0;
          });
          return Promise.resolve({ data: filtered.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
}

test("official loader paginates parent, catalog, balances, and every child query", async () => {
  const client = fakeClient();
  globalThis.__NK59_STATISTICS_CLIENT__ = client;

  const result = await loadStatisticsData(
    7,
    new Date("2026-09-15T15:00:00.000Z"),
  );
  assert.equal(result.error, null);
  assert.equal(result.data.totals.inbound, 1_001);
  assert.equal(result.data.totals.outbound, 1_001);
  assert.equal(result.data.totals.assembled, 1_001);
  assert.equal(result.data.rankings.configurations[0].id, "config-1000");
  assert.equal(result.data.rankings.configurations[0].quantity, 1_000);
  assert.equal(result.data.rankings.looseParts[0].id, "item-1000");
  assert.equal(result.data.currentStock.loosePartTotal, 5);
  assert.equal(result.data.currentStock.completeBoxesTotal, 7);
  assert.equal(result.data.withoutMovement.items.length, 0);
  assert.equal(result.data.withoutMovement.configurations.length, 0);

  for (const table of Object.keys(rows)) {
    assert.ok(
      client.calls.get(table).some(([from, to]) => from === 1_000 && to === 1_999),
      `${table} did not fetch its second page`,
    );
  }
});
