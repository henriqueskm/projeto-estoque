import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateStatistics,
  createStatisticsRange,
} from "../lib/statistics-calculations.ts";
import { fetchAllStatisticsRows } from "../lib/statistics-pagination.ts";

const now = new Date("2026-09-15T15:00:00.000Z");

const item = (id, code, itemType) => ({
  id,
  code,
  description: code,
  item_type: itemType,
  minimum_stock: 0,
  is_active: true,
});

function fixture() {
  const batches = [
    ["modern-in", "INBOUND", "2026-09-09T03:00:00.000Z"],
    ["legacy-in-single", "INBOUND", "2026-09-10T12:00:00.000Z"],
    ["legacy-in-batch", "INBOUND", "2026-09-11T12:00:00.000Z"],
    ["modern-out-item", "OUTBOUND", "2026-09-12T12:00:00.000Z"],
    ["modern-out-config", "OUTBOUND", "2026-09-12T13:00:00.000Z"],
    ["modern-wins", "OUTBOUND", "2026-09-13T12:00:00.000Z"],
    ["legacy-out-item", "OUTBOUND", "2026-09-14T12:00:00.000Z"],
    ["legacy-out-config", "OUTBOUND", "2026-09-14T13:00:00.000Z"],
    ["assembly", "ASSEMBLY", "2026-09-14T14:00:00.000Z"],
    ["disassembly", "DISASSEMBLY", "2026-09-14T15:00:00.000Z"],
    ["adjustment-plus", "ADJUSTMENT", "2026-09-14T16:00:00.000Z"],
    ["adjustment-minus", "ADJUSTMENT", "2026-09-14T17:00:00.000Z"],
    ["reversal", "REVERSAL", "2026-09-14T18:00:00.000Z"],
    ["previous-out", "OUTBOUND", "2026-09-08T12:00:00.000Z"],
    ["end-exclusive", "OUTBOUND", "2026-09-16T03:00:00.000Z"],
  ].map(([id, movement_type, occurred_at]) => ({
    id,
    movement_type,
    occurred_at,
  }));

  return {
    period: 7,
    now,
    batches,
    inboundLines: [
      {
        batch_id: "modern-in",
        item_id: "servo-2",
        commercial_configuration_code_id: null,
        quantity: 2,
      },
    ],
    outboundLines: [
      {
        batch_id: "modern-out-item",
        item_id: "servo-10",
        commercial_configuration_code_id: null,
        quantity: 4,
        assembled_quantity_used: 0,
        auto_assembled_quantity: 0,
      },
      {
        batch_id: "modern-out-config",
        item_id: null,
        commercial_configuration_code_id: "alias-a",
        quantity: 5,
        assembled_quantity_used: 5,
        auto_assembled_quantity: 0,
      },
      {
        batch_id: "modern-wins",
        item_id: null,
        commercial_configuration_code_id: "alias-b",
        quantity: 2,
        assembled_quantity_used: 2,
        auto_assembled_quantity: 0,
      },
      {
        batch_id: "previous-out",
        item_id: "part",
        commercial_configuration_code_id: null,
        quantity: 4,
        assembled_quantity_used: 0,
        auto_assembled_quantity: 0,
      },
      {
        batch_id: "end-exclusive",
        item_id: "part",
        commercial_configuration_code_id: null,
        quantity: 99,
        assembled_quantity_used: 0,
        auto_assembled_quantity: 0,
      },
    ],
    stockMovements: [
      { batch_id: "modern-in", item_id: "servo-2", quantity_change: 200 },
      { batch_id: "legacy-in-single", item_id: "part", quantity_change: 7 },
      { batch_id: "legacy-in-batch", item_id: "repair", quantity_change: 3 },
      { batch_id: "legacy-in-batch", item_id: "kit", quantity_change: 4 },
      { batch_id: "modern-out-item", item_id: "servo-10", quantity_change: -300 },
      { batch_id: "legacy-out-item", item_id: "servo-2", quantity_change: -4 },
      { batch_id: "modern-wins", item_id: "part", quantity_change: -90 },
      { batch_id: "adjustment-plus", item_id: "part", quantity_change: 100 },
      { batch_id: "adjustment-minus", item_id: "part", quantity_change: -100 },
      { batch_id: "reversal", item_id: "part", quantity_change: -100 },
    ],
    configurationMovements: [
      {
        batch_id: "modern-out-config",
        configuration_id: "config",
        quantity_change: -500,
      },
      {
        batch_id: "modern-wins",
        configuration_id: "config",
        quantity_change: -90,
      },
      {
        batch_id: "legacy-out-config",
        configuration_id: "config",
        quantity_change: -6,
      },
      {
        batch_id: "reversal",
        configuration_id: "config",
        quantity_change: 100,
      },
    ],
    assemblyOperations: [
      {
        batch_id: "assembly",
        configuration_id: "config",
        operation_type: "ASSEMBLY",
        quantity: 8,
        commercial_code_snapshot: "2A",
      },
      {
        batch_id: "disassembly",
        configuration_id: "config",
        operation_type: "DISASSEMBLY",
        quantity: 9,
        commercial_code_snapshot: "2A",
      },
    ],
    items: [
      item("servo-2", "2", "SERVO"),
      item("servo-10", "10", "SERVO"),
      item("kit", "KT-18", "INSTALLATION_KIT"),
      item("repair", "R-1", "REPAIR_KIT"),
      item("part", "P-1", "LOOSE_PART"),
    ],
    configurations: [
      {
        id: "config",
        description: "Caixa 2A",
        servo_id: "servo-2",
        installation_kit_id: "kit",
        minimum_stock: 0,
        is_active: true,
      },
    ],
    commercialCodes: [
      { id: "alias-a", configuration_id: "config", code: "2A", is_active: true },
      { id: "alias-b", configuration_id: "config", code: "2B", is_active: true },
    ],
    stockBalances: [],
    configurationBalances: [],
  };
}

test("builds complete external statistics and never double counts canonical batches", () => {
  const result = calculateStatistics(fixture());

  assert.deepEqual(result.totals, {
    inbound: 16,
    outbound: 21,
    assembled: 8,
    disassembled: 9,
  });
  assert.deepEqual(result.comparisons.outbound, {
    current: 21,
    previous: 4,
    direction: "UP",
    percentage: 425,
  });
  assert.deepEqual(result.servoSales, {
    withKit: 13,
    withoutKit: 8,
    total: 21,
    withKitPercentage: (13 / 21) * 100,
    withoutKitPercentage: (8 / 21) * 100,
  });
  assert.equal(result.rankings.configurations[0].quantity, 13);
  assert.deepEqual(result.rankings.configurations[0].aliases, ["2A", "2B"]);
  assert.deepEqual(
    result.rankings.looseServos.map(({ code, quantity }) => ({ code, quantity })),
    [
      { code: "2", quantity: 4 },
      { code: "10", quantity: 4 },
    ],
  );
  assert.equal(result.outboundByCategory.completeBoxes, 13);
  assert.equal(result.outboundByCategory.looseServos, 8);
  assert.equal(
    result.timeline.reduce((total, point) => total + point.outbound, 0),
    21,
  );
});

test("keeps Sao Paulo moving windows exact at both boundaries", () => {
  const range = createStatisticsRange(7, now);
  assert.equal(range.currentStart.toISOString(), "2026-09-09T03:00:00.000Z");
  assert.equal(range.currentEndExclusive.toISOString(), "2026-09-16T03:00:00.000Z");

  const result = calculateStatistics(fixture());
  assert.equal(result.periodStart, "2026-09-09T03:00:00.000Z");
  assert.equal(result.periodEndExclusive, "2026-09-16T03:00:00.000Z");
  assert.equal(result.comparisons.outbound.previous, 4);
  assert.equal(result.totals.outbound, 21);
});

test("returns deterministic empty statistics when there are no movements", () => {
  const empty = fixture();
  empty.batches = [];
  empty.inboundLines = [];
  empty.outboundLines = [];
  empty.stockMovements = [];
  empty.configurationMovements = [];
  empty.assemblyOperations = [];

  const result = calculateStatistics(empty);
  assert.deepEqual(result.totals, {
    inbound: 0,
    outbound: 0,
    assembled: 0,
    disassembled: 0,
  });
  assert.deepEqual(result.rankings.configurations, []);
  assert.deepEqual(result.rankings.looseServos, []);
  assert.equal(result.servoSales.total, 0);
  assert.equal(result.servoSales.withKitPercentage, 0);
});

test("pagination helper executes every page and propagates a later error", async () => {
  const source = Array.from({ length: 2_005 }, (_, index) => index);
  const calls = [];
  const success = await fetchAllStatisticsRows((from, to) => {
    calls.push([from, to]);
    return Promise.resolve({ data: source.slice(from, to + 1), error: null });
  });

  assert.deepEqual(success.data, source);
  assert.deepEqual(calls, [
    [0, 999],
    [1_000, 1_999],
    [2_000, 2_999],
  ]);

  const failure = await fetchAllStatisticsRows((from) =>
    Promise.resolve(
      from === 0
        ? { data: source.slice(0, 1_000), error: null }
        : { data: null, error: new Error("page failed") },
    ),
  );
  assert.equal(failure.data, null);
  assert.match(failure.error.message, /page failed/);
});
