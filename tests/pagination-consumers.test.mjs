import assert from "node:assert/strict";
import test from "node:test";

import { loadHomeData } from "../lib/home-data.ts";
import { loadInventoryData } from "../lib/inventory-data.ts";
import { getInboundCatalog } from "../lib/inbound-data.ts";
import { getOutboundCatalog } from "../lib/outbound-data.ts";
import {
  AssistantDataError,
  consultAssistantCatalogMedia,
  consultAssistantItem,
} from "../lib/assistant-data.ts";
import { loadConfigurationDisassemblyTargetsByServoId } from "../lib/assistant-configuration-disassembly-data.ts";
import { loadHistoryList } from "../lib/history-data.ts";
import { loadPurchaseRecommendations } from "../lib/purchase-recommendations.ts";
import { loadSupplierOrderPhotoCatalog } from "../lib/assistant-supplier-order-photo-catalog.ts";
import { readSharedCatalogSnapshot } from "../lib/shared-catalog.ts";
import { loadFreshStockBalances, loadFreshMinimumStocks } from "../lib/stock-operational-data.ts";
import {
  loadSupplierOrderCatalogWithClient,
  loadSupplierOrderSummariesWithClient,
  searchSupplierOrderIdsWithClient,
} from "../lib/supplier-orders-data.ts";

const size = 1_001;
const uuid = (index) =>
  `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function fakeClient(tables, { errorPage = null } = {}) {
  const calls = new Map();
  return {
    calls,
    from(table) {
      const filters = [];
      const orders = [];
      let withCount = false;

      const execute = (from = 0, to = 999) => {
        const tableCalls = calls.get(table) ?? [];
        tableCalls.push([from, to]);
        calls.set(table, tableCalls);
        if (errorPage?.table === table && errorPage.from === from) {
          return Promise.resolve({ data: null, error: errorPage.error });
        }

        const filtered = (tables[table] ?? []).filter((row) =>
          filters.every((filter) => filter(row)),
        );
        filtered.sort((left, right) => {
          for (const order of orders) {
            const comparison = String(left[order.column] ?? "").localeCompare(
              String(right[order.column] ?? ""),
            );
            if (comparison !== 0) return order.ascending ? comparison : -comparison;
          }
          return 0;
        });
        const cappedTo = Math.min(to, from + 999);
        return Promise.resolve({
          data: filtered.slice(from, cappedTo + 1),
          error: null,
          ...(withCount ? { count: filtered.length } : {}),
        });
      };

      const query = {
        select(_columns, options) {
          withCount = options?.count === "exact";
          return query;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return query;
        },
        gt(column, value) {
          filters.push((row) => row[column] > value);
          return query;
        },
        gte(column, value) {
          filters.push((row) => row[column] >= value);
          return query;
        },
        lt(column, value) {
          filters.push((row) => row[column] < value);
          return query;
        },
        in(column, values) {
          const accepted = new Set(values);
          filters.push((row) => accepted.has(row[column]));
          return query;
        },
        or() {
          return query;
        },
        ilike() {
          return query;
        },
        order(column, { ascending = true } = {}) {
          orders.push({ column, ascending });
          return query;
        },
        range(from, to) {
          return execute(from, to);
        },
        limit(value) {
          return execute(0, value - 1);
        },
        async maybeSingle() {
          const result = await execute(0, 0);
          return { data: result.data?.[0] ?? null, error: result.error };
        },
        then(resolve, reject) {
          return execute().then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function summaryRow(index) {
  const id = uuid(index);
  return {
    id,
    negotiation_number: String(10_000 + index),
    order_date: "2026-09-20",
    notes: null,
    created_by_name_snapshot: "Operador",
    created_at: "2026-09-20T12:00:00.000Z",
    updated_at: "2026-09-20T12:00:00.000Z",
    cancelled_at: null,
    cancelled_by_name_snapshot: null,
    cancellation_note: null,
    finalized_at: null,
    finalized_by_name_snapshot: null,
    finalization_note: null,
    is_finalized: false,
    is_active_order: true,
    is_in_history: false,
    closure_kind: null,
    closed_at: null,
    closed_by_name_snapshot: null,
    line_count: 1,
    ordered_quantity: 2,
    ready_quantity: 1,
    picked_quantity: 0,
    cancelled_quantity: 0,
    waiting_pickup_quantity: 1,
    waiting_ready_quantity: 1,
    ready_waiting_pickup_quantity: 1,
    stocked_quantity: 0,
    waiting_stock_quantity: 1,
    pickup_percentage: 0,
    status: "PENDING",
  };
}

function orderItemRow(index) {
  return {
    id: uuid(10_000 + index),
    supplier_order_id: uuid(index),
    item_id: `item-${index}`,
    commercial_configuration_id: null,
    commercial_configuration_code_id: null,
    code_snapshot: `P-${index}`,
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
    waiting_stock_quantity: 1,
    position: 1,
    notes: null,
    created_at: "2026-09-20T12:00:00.000Z",
    updated_at: "2026-09-20T12:00:00.000Z",
  };
}

test("home e catálogo de foto incluem a linha 1001 sob max_rows=1000", async () => {
  const items = Array.from({ length: size }, (_, index) => ({
    id: `item-${index}`,
    code: `P-${index}`,
    description: `Peça ${index}`,
    item_type: "LOOSE_PART",
    minimum_stock: 0,
    is_active: true,
  }));
  const client = fakeClient({
    items,
    stock_balances: items.map((item) => ({ item_id: item.id, quantity: 1 })),
    commercial_configurations: [],
    commercial_configuration_codes: [],
    configuration_stock_balances: [],
    servo_models: [],
    servo_repair_compatibility: [],
  });
  globalThis.__NK63_PAGINATION_CLIENT__ = client;

  const home = await loadHomeData();
  assert.equal(home.error, null);
  assert.equal(home.data.summary.loosePartTotal, size);

  const [inventory, inbound, outbound, assistant] = await Promise.all([
    loadInventoryData(),
    getInboundCatalog(),
    getOutboundCatalog(),
    consultAssistantItem("P-1000"),
  ]);
  assert.equal(inventory.error, null);
  assert.equal(inventory.data.physicalItems.length, size);
  assert.equal(inbound.error, null);
  assert.equal(inbound.data.physicalItems.length, size);
  assert.equal(outbound.error, null);
  assert.equal(outbound.data.physicalItems.length, size);
  assert.equal(assistant.exact_code_match, true);
  assert.equal(assistant.results[0].code, "P-1000");

  const photoCatalog = await loadSupplierOrderPhotoCatalog(client);
  assert.equal(photoCatalog.length, size);
  assert.ok(photoCatalog.some((target) => target.targetId === "item-1000"));
  assert.ok(client.calls.get("items").some(([from]) => from === 1_000));
});

test("erro na segunda página faz o loader real falhar sem resumo parcial", async () => {
  const items = Array.from({ length: size }, (_, index) => ({
    id: `item-${index}`,
    item_type: "LOOSE_PART",
    minimum_stock: 0,
    is_active: true,
  }));
  const error = new Error("second page unavailable");
  globalThis.__NK63_PAGINATION_CLIENT__ = fakeClient(
    {
      items,
      stock_balances: items.map((item) => ({ item_id: item.id, quantity: 1 })),
      commercial_configurations: [],
      commercial_configuration_codes: [],
      configuration_stock_balances: [],
      servo_models: [],
    },
    { errorPage: { table: "stock_balances", from: 1_000, error } },
  );
  const result = await loadHomeData();
  assert.equal(result.data, null);
  assert.match(result.error, /carregar os dados do estoque/i);
});

test("lista e busca de Pedidos encontram resultados após 1000 e chunkam summaries", async () => {
  const summaries = Array.from({ length: size }, (_, index) => summaryRow(index));
  const details = Array.from({ length: size }, (_, index) => orderItemRow(index));
  const client = fakeClient({
    supplier_order_summaries: summaries,
    supplier_order_item_details: details,
  });

  const list = await loadSupplierOrderSummariesWithClient("active", client);
  assert.equal(list.error, null);
  assert.equal(list.data.summaries.length, size);

  const search = await searchSupplierOrderIdsWithClient("active", "Peça", client);
  assert.equal(search.error, null);
  assert.equal(search.data.orderIds.length, size);
  assert.ok(search.data.orderIds.includes(uuid(1_000)));
  assert.ok(client.calls.get("supplier_order_item_details").some(([from]) => from === 1_000));
  assert.ok(client.calls.get("supplier_order_summaries").length > 10);
});

test("spans de streams paginados não afirmam uma única wave ou query", async () => {
  const items = Array.from({ length: size }, (_, index) => ({
    id: `item-${index}`,
    code: `P-${index}`,
    description: `Peça ${index}`,
    item_type: "LOOSE_PART",
    is_active: true,
    minimum_stock: 0,
  }));
  const client = fakeClient({
    items,
    servo_models: [],
    commercial_configurations: [],
    commercial_configuration_codes: [],
    stock_balances: items.map((item) => ({ item_id: item.id, quantity: 1 })),
    configuration_stock_balances: [],
    supplier_order_summaries: Array.from({ length: size }, (_, index) => summaryRow(index)),
    supplier_order_item_details: Array.from({ length: size }, (_, index) => orderItemRow(index)),
  });
  const logs = [];
  const previousInfo = console.info;
  try {
    console.info = (line) => logs.push(JSON.parse(line));
    await readSharedCatalogSnapshot(client);
    await loadFreshStockBalances(client);
    await loadFreshMinimumStocks(client);
    await loadSupplierOrderSummariesWithClient("active", client);
    await loadSupplierOrderCatalogWithClient(client);
    await searchSupplierOrderIdsWithClient("active", "Peça", client);
  } finally {
    console.info = previousInfo;
  }

  assert.ok(client.calls.get("items").some(([from]) => from === 1_000));
  assert.ok(client.calls.get("stock_balances").some(([from]) => from === 1_000));
  assert.ok(client.calls.get("supplier_order_summaries").some(([from]) => from === 1_000));
  for (const metric of logs.filter((entry) =>
    (entry.event === "nk_performance_audit" && ["structural_read", "fresh_balances", "fresh_minimums"].includes(entry.phase)) ||
    (entry.event === "supplier_orders_performance" && ["summaries", "catalog", "search"].includes(entry.loader))
  )) {
    assert.equal(Object.hasOwn(metric, "waveCount"), false, `${metric.loader}/${metric.phase} não mede ondas reais`);
    assert.equal(Object.hasOwn(metric, "queryCount"), false, `${metric.loader}/${metric.phase} não mede queries físicas reais`);
  }
});

test("Histórico soma 1001 relações dos mesmos 25 batches", async () => {
  const batchId = uuid(50_000);
  const client = fakeClient({
    movement_batches: [{
      id: batchId,
      movement_type: "INBOUND",
      source: "MANUAL",
      description: null,
      user_name_snapshot: "Operador",
      reversed_batch_id: null,
      occurred_at: "2026-09-20T12:00:00.000Z",
    }],
    inbound_batch_lines: Array.from({ length: size }, (_, index) => ({
      id: uuid(60_000 + index),
      batch_id: batchId,
      item_id: `item-${index}`,
      commercial_configuration_code_id: null,
      quantity: 1,
      created_at: "2026-09-20T12:00:00.000Z",
    })),
    outbound_batch_lines: [],
    stock_movements: [],
    configuration_stock_movements: [],
    assembly_operations: [],
  });
  globalThis.__NK63_PAGINATION_CLIENT__ = client;
  const result = await loadHistoryList({
    type: "ALL",
    source: "ALL",
    dateFrom: "",
    dateTo: "",
    dateFromIso: null,
    dateToExclusiveIso: null,
    user: "",
    query: "",
    page: 1,
    dateRangeAdjusted: false,
  });
  assert.equal(result.error, null);
  assert.match(result.data.batches[0].summary, /1001 itens separados/);
  assert.match(result.data.batches[0].summary, /1001 unidades/);
});

test("recomendações preservam catálogo e pendências após a linha 1000", async () => {
  const items = Array.from({ length: size }, (_, index) => ({
    id: `item-${index}`,
    code: `P-${index}`,
    description: `Peça ${index}`,
    item_type: "LOOSE_PART",
    minimum_stock: 2,
    is_active: true,
  }));
  globalThis.__NK63_PAGINATION_CLIENT__ = fakeClient({
    items,
    stock_balances: items.map((item) => ({ item_id: item.id, quantity: 0 })),
    commercial_configurations: [],
    commercial_configuration_codes: [],
    configuration_stock_balances: [],
    supplier_order_summaries: Array.from({ length: size }, (_, index) => summaryRow(index)),
    supplier_order_item_details: Array.from({ length: size }, (_, index) => orderItemRow(index)),
  });
  const result = await loadPurchaseRecommendations();
  assert.equal(result.error, null);
  assert.equal(result.data.allItems.length, size);
  const last = result.data.allItems.find((item) => item.targetId === "item-1000");
  assert.equal(last.pendingPurchaseQuantity, 2);
  assert.equal(last.projectedStock, 2);
});

function assistantFanoutFixtures({ sharedKit = false } = {}) {
  const servoId = "servo-root";
  const kitIds = Array.from({ length: size }, (_, index) => `kit-${index}`);
  const items = [
    {
      id: servoId,
      code: "SERVO-ROOT",
      description: "Servo raiz",
      item_type: "SERVO",
      minimum_stock: 0,
      is_active: true,
    },
    ...kitIds.map((id, index) => ({
      id,
      code: index === 0 ? "KIT-ROOT" : `KIT-${index}`,
      description: `Kit ${index}`,
      item_type: "INSTALLATION_KIT",
      minimum_stock: 0,
      is_active: true,
    })),
  ];
  const configurations = kitIds.map((kitId, index) => ({
    id: `configuration-${String(index).padStart(4, "0")}`,
    description: `Configuração ${index}`,
    image_path: null,
    servo_id: servoId,
    installation_kit_id: sharedKit ? kitIds[0] : kitId,
    minimum_stock: 0,
    is_active: true,
  }));
  const aliases = [
    ...Array.from({ length: size }, (_, index) => ({
      id: `alias-root-${String(index).padStart(4, "0")}`,
      configuration_id: configurations[0].id,
      code: `ROOT-${index}`,
      is_active: true,
    })),
    ...configurations.slice(1).map((configuration, index) => ({
      id: `alias-${String(index + 1).padStart(4, "0")}`,
      configuration_id: configuration.id,
      code: `C-${index + 1}`,
      is_active: true,
    })),
  ];
  return {
    servoId,
    items,
    configurations,
    aliases,
    tables: {
      items,
      commercial_configurations: configurations,
      commercial_configuration_codes: aliases,
      stock_balances: items.map((item) => ({ item_id: item.id, quantity: 3 })),
      configuration_stock_balances: configurations.map((configuration) => ({
        configuration_id: configuration.id,
        quantity: 2,
      })),
      servo_models: [{ item_id: servoId, model: "ROOT" }],
    },
  };
}

test("fanouts exatos de mídia e desmontagem carregam 1001 configurações, aliases e componentes", async () => {
  const mediaFixture = assistantFanoutFixtures({ sharedKit: true });
  const mediaClient = fakeClient(mediaFixture.tables);
  globalThis.__NK63_PAGINATION_CLIENT__ = mediaClient;

  const media = await consultAssistantCatalogMedia("KIT-ROOT");
  assert.equal(media.results[0].targetId, "kit-0");
  assert.ok(
    mediaClient.calls.get("commercial_configurations").some(([from]) => from === 1_000),
  );
  assert.ok(
    mediaClient.calls.get("commercial_configuration_codes").some(([from]) => from === 1_000),
  );

  const fixture = assistantFanoutFixtures();
  const client = fakeClient(fixture.tables);
  const disassembly = await loadConfigurationDisassemblyTargetsByServoId(
    client,
    fixture.servoId,
  );
  assert.equal(disassembly.failed, false);
  assert.equal(disassembly.targets.length, size);
  assert.equal(disassembly.targets.at(-1).installationKit.code, "KIT-1000");
  assert.ok(client.calls.get("items").length > 10, "component item IDs must be chunked");
});

test("erro na página 2 dos fanouts assistant nunca devolve snapshot parcial", async () => {
  const fixture = assistantFanoutFixtures({ sharedKit: true });
  const error = new Error("assistant fanout page two failed");
  const client = fakeClient(fixture.tables, {
    errorPage: { table: "commercial_configurations", from: 1_000, error },
  });
  globalThis.__NK63_PAGINATION_CLIENT__ = client;

  await assert.rejects(
    () => consultAssistantCatalogMedia("KIT-ROOT"),
    AssistantDataError,
  );
  const disassemblyFixture = assistantFanoutFixtures();
  const disassemblyClient = fakeClient(disassemblyFixture.tables, {
    errorPage: { table: "commercial_configurations", from: 1_000, error },
  });
  const disassembly = await loadConfigurationDisassemblyTargetsByServoId(
    disassemblyClient,
    disassemblyFixture.servoId,
  );
  assert.equal(disassembly.failed, true);
  assert.deepEqual(disassembly.targets, []);
});
