import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isLatestSupplierOrderRequest,
  mergeSupplierOrderMedia,
} from "../lib/supplier-orders-client-state.ts";
import {
  isSupplierOrderId,
  loadSupplierOrderDetailWithClient,
  loadSupplierOrderMediaWithClient,
  loadSupplierOrderSummariesWithClient,
  searchSupplierOrderIdsWithClient,
} from "../lib/supplier-orders-data.ts";

const orderId = "11111111-1111-4111-8111-111111111111";

function summaryRow(overrides = {}) {
  return {
    id: orderId,
    negotiation_number: "40959",
    order_date: "2026-08-27",
    notes: null,
    created_by_name_snapshot: "Operador",
    created_at: "2026-08-27T12:00:00.000Z",
    updated_at: "2026-08-27T12:00:00.000Z",
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
    ready_quantity: 0,
    picked_quantity: 0,
    cancelled_quantity: 0,
    waiting_pickup_quantity: 0,
    waiting_ready_quantity: 2,
    ready_waiting_pickup_quantity: 0,
    stocked_quantity: 0,
    waiting_stock_quantity: 0,
    pickup_percentage: 0,
    status: "PENDING",
    ...overrides,
  };
}

function itemRow(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    supplier_order_id: orderId,
    item_id: "33333333-3333-4333-8333-333333333333",
    commercial_configuration_id: null,
    commercial_configuration_code_id: null,
    code_snapshot: "1B",
    description_snapshot: "SERVO",
    model_snapshot: "1B",
    item_type_snapshot: "SERVO",
    commercial_code_snapshot: null,
    ordered_quantity: 2,
    ready_quantity: 0,
    picked_quantity: 0,
    stocked_quantity: 0,
    cancelled_quantity: 0,
    waiting_pickup_quantity: 0,
    waiting_ready_quantity: 2,
    ready_waiting_pickup_quantity: 0,
    waiting_stock_quantity: 0,
    position: 1,
    notes: null,
    created_at: "2026-08-27T12:00:00.000Z",
    updated_at: "2026-08-27T12:00:00.000Z",
    ...overrides,
  };
}

function createFakeClient(fixtures, options = {}) {
  const calls = [];
  const storageCalls = [];
  return {
    calls,
    storageCalls,
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths) {
            storageCalls.push({ bucket, paths });
            if (options.storageError) {
              return { data: null, error: { message: "storage unavailable" } };
            }
            return {
              data: paths.map((path) => ({
                path,
                signedUrl: `https://media.invalid/${path}`,
                error: null,
              })),
              error: null,
            };
          },
        };
      },
    },
    from(table) {
      const call = { table, filters: [], selected: null };
      calls.push(call);
      const rows = fixtures[table] ?? [];
      const error = options.errorTables?.includes(table)
        ? { message: "query unavailable" }
        : null;
      const builder = {
        select(value) {
          call.selected = value;
          return builder;
        },
        eq(column, value) {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        in(column, value) {
          call.filters.push(["in", column, value]);
          return builder;
        },
        or(value) {
          call.filters.push(["or", value]);
          return builder;
        },
        order(column, options) {
          call.filters.push(["order", column, options]);
          return builder;
        },
        limit(value) {
          call.filters.push(["limit", value]);
          return builder;
        },
        async maybeSingle() {
          return { data: rows[0] ?? null, error };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test("initial loader performs one summaries-only query", async () => {
  const client = createFakeClient({ supplier_order_summaries: [summaryRow()] });
  const result = await loadSupplierOrderSummariesWithClient("active", client);

  assert.equal(result.error, null);
  assert.equal(result.data.summaries.length, 1);
  assert.deepEqual(client.calls.map((call) => call.table), [
    "supplier_order_summaries",
  ]);
  assert.equal(
    client.calls.some((call) => call.table === "supplier_order_item_details"),
    false,
  );
  assert.equal(
    client.calls.some((call) => call.table === "supplier_order_events"),
    false,
  );
  assert.equal(client.calls.some((call) => call.table === "items"), false);
  assert.equal(
    client.calls.some((call) => call.table === "commercial_configurations"),
    false,
  );
});

test("active and history lists retain their view classification filters", async () => {
  for (const [view, column] of [
    ["active", "is_active_order"],
    ["history", "is_in_history"],
  ]) {
    const client = createFakeClient({ supplier_order_summaries: [summaryRow()] });
    await loadSupplierOrderSummariesWithClient(view, client);
    assert.ok(
      client.calls[0].filters.some(
        (filter) => filter[0] === "eq" && filter[1] === column && filter[2] === true,
      ),
    );
  }
});

test("detail core reads only the selected order in one operational wave", async () => {
  const client = createFakeClient({
    supplier_order_summaries: [summaryRow()],
    supplier_order_item_details: [itemRow()],
    supplier_order_events: [],
  });
  const result = await loadSupplierOrderDetailWithClient(orderId, "active", client);

  assert.equal(result.error, null);
  assert.equal(result.data.order.id, orderId);
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.items[0].codeSnapshot, "1B");
  assert.equal(result.data.items[0].descriptionSnapshot, "SERVO");
  assert.equal(result.data.items[0].modelSnapshot, "1B");
  assert.equal(result.data.items[0].imageUrl, null);
  assert.deepEqual(result.data.items[0].compatibleKitImages, []);
  for (const table of ["supplier_order_item_details", "supplier_order_events"]) {
    const call = client.calls.find((candidate) => candidate.table === table);
    assert.ok(call);
    assert.ok(
      call.filters.some(
        (filter) =>
          filter[0] === "eq" &&
          filter[1] === "supplier_order_id" &&
          filter[2] === orderId,
      ),
    );
  }
  assert.deepEqual(client.calls.map((call) => call.table), [
    "supplier_order_summaries",
    "supplier_order_item_details",
    "supplier_order_events",
  ]);
  for (const table of [
    "items",
    "servo_models",
    "commercial_configurations",
    "commercial_configuration_codes",
  ]) {
    assert.equal(client.calls.some((call) => call.table === table), false);
  }
  assert.equal(client.storageCalls.length, 0);
});

test("history detail keeps its classification and skips active-only events", async () => {
  const client = createFakeClient({
    supplier_order_summaries: [
      summaryRow({ is_active_order: false, is_in_history: true }),
    ],
    supplier_order_item_details: [itemRow()],
  });

  const result = await loadSupplierOrderDetailWithClient(
    orderId,
    "history",
    client,
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.data.events, []);
  assert.deepEqual(client.calls.map((call) => call.table), [
    "supplier_order_summaries",
    "supplier_order_item_details",
  ]);
  assert.ok(
    client.calls[0].filters.some(
      (filter) =>
        filter[0] === "eq" &&
        filter[1] === "is_in_history" &&
        filter[2] === true,
    ),
  );
});

test("detail media enriches selected snapshots after core without blocking it", async () => {
  const configurationId = "55555555-5555-4555-8555-555555555555";
  const servoId = "66666666-6666-4666-8666-666666666666";
  const kitId = "77777777-7777-4777-8777-777777777777";
  const client = createFakeClient({
    supplier_order_summaries: [summaryRow()],
    supplier_order_item_details: [
      itemRow({
        item_id: null,
        commercial_configuration_id: configurationId,
        item_type_snapshot: "COMMERCIAL_CONFIGURATION",
      }),
    ],
    commercial_configurations: [
      {
        id: configurationId,
        description: "SERVO + KIT",
        image_path: "orders/configuration.png",
        servo_id: servoId,
        installation_kit_id: kitId,
        is_active: true,
      },
    ],
    items: [
      {
        id: servoId,
        code: "1B",
        description: "SERVO",
        item_type: "SERVO",
        is_active: true,
      },
      {
        id: kitId,
        code: "KT-18",
        description: "KIT",
        item_type: "INSTALLATION_KIT",
        is_active: true,
      },
    ],
    servo_models: [{ item_id: servoId, model: "MBF" }],
    commercial_configuration_codes: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        code: "1B",
        configuration_id: configurationId,
        is_active: true,
      },
    ],
  });

  const result = await loadSupplierOrderMediaWithClient(
    orderId,
    "active",
    client,
  );

  assert.equal(result.error, null);
  assert.equal(result.data.items.length, 1);
  assert.equal(
    result.data.items[0].imageUrl,
    "https://media.invalid/orders/configuration.png",
  );
  assert.equal(client.storageCalls.length, 1);
  for (const table of [
    "supplier_order_summaries",
    "supplier_order_item_details",
  ]) {
    const call = client.calls.find((candidate) => candidate.table === table);
    assert.ok(call);
    assert.ok(
      call.filters.some(
        (filter) => filter[0] === "eq" && filter[2] === orderId,
      ),
    );
  }
});

test("optional media failure cannot make the snapshot detail unavailable", async () => {
  const coreClient = createFakeClient({
    supplier_order_summaries: [summaryRow()],
    supplier_order_item_details: [itemRow()],
    supplier_order_events: [],
  });
  const mediaClient = createFakeClient(
    {
      supplier_order_summaries: [summaryRow()],
      supplier_order_item_details: [itemRow()],
    },
    { errorTables: ["supplier_order_item_details"] },
  );

  const core = await loadSupplierOrderDetailWithClient(
    orderId,
    "active",
    coreClient,
  );
  const media = await loadSupplierOrderMediaWithClient(
    orderId,
    "active",
    mediaClient,
  );

  assert.equal(core.error, null);
  assert.equal(core.data.items[0].codeSnapshot, "1B");
  assert.equal(media.data, null);
});

test("media patches merge without replacing operational snapshots", () => {
  const item = {
    id: itemRow().id,
    supplierOrderId: orderId,
    itemId: itemRow().item_id,
    commercialConfigurationId: null,
    commercialConfigurationCodeId: null,
    codeSnapshot: "1B",
    descriptionSnapshot: "SERVO",
    modelSnapshot: "1B",
    itemTypeSnapshot: "SERVO",
    commercialCodeSnapshot: null,
    imageUrl: null,
    compatibleKitImages: [],
    orderedQuantity: 2,
    readyQuantity: 0,
    pickedQuantity: 0,
    stockedQuantity: 0,
    cancelledQuantity: 0,
    waitingPickupQuantity: 0,
    waitingReadyQuantity: 2,
    readyWaitingPickupQuantity: 0,
    waitingStockQuantity: 0,
    position: 1,
    notes: null,
    createdAt: itemRow().created_at,
    updatedAt: itemRow().updated_at,
  };
  const [merged] = mergeSupplierOrderMedia([item], [
    {
      id: item.id,
      imageUrl: "https://media.invalid/item.png",
      compatibleKitImages: [],
    },
  ]);

  assert.equal(merged.codeSnapshot, "1B");
  assert.equal(merged.descriptionSnapshot, "SERVO");
  assert.equal(merged.imageUrl, "https://media.invalid/item.png");
});

test("invalid detail ids fail before any query", async () => {
  const client = createFakeClient({});
  const result = await loadSupplierOrderDetailWithClient("not-a-uuid", "active", client);
  const mediaResult = await loadSupplierOrderMediaWithClient(
    "not-a-uuid",
    "active",
    client,
  );
  assert.equal(result.data, null);
  assert.equal(result.error, "Pedido inválido.");
  assert.equal(mediaResult.data, null);
  assert.equal(mediaResult.error, "Pedido inválido.");
  assert.equal(client.calls.length, 0);
  assert.equal(isSupplierOrderId(orderId), true);
});

test("detail core reports query failures without starting media enrichment", async () => {
  const client = createFakeClient(
    {
      supplier_order_summaries: [summaryRow()],
      supplier_order_item_details: [itemRow()],
      supplier_order_events: [],
    },
    { errorTables: ["supplier_order_item_details"] },
  );

  const result = await loadSupplierOrderDetailWithClient(
    orderId,
    "active",
    client,
  );

  assert.equal(result.data, null);
  assert.equal(result.error, "Não foi possível carregar este pedido agora.");
  assert.equal(
    client.calls.some((call) => call.table === "commercial_configurations"),
    false,
  );
  assert.equal(client.storageCalls.length, 0);
});

test("item search returns only accessible summary ids, not hydrated details", async () => {
  const client = createFakeClient({
    supplier_order_item_details: [{ supplier_order_id: orderId }],
    supplier_order_summaries: [{ id: orderId }],
  });
  const result = await searchSupplierOrderIdsWithClient("active", "1B", client);
  assert.deepEqual(result.data, { orderIds: [orderId] });
  assert.deepEqual(client.calls.map((call) => call.table), [
    "supplier_order_item_details",
    "supplier_order_summaries",
  ]);
  assert.equal(client.calls[0].selected, "supplier_order_id");
});

test("late detail response cannot replace a newer selection", () => {
  const nextOrderId = "44444444-4444-4444-8444-444444444444";
  assert.equal(isLatestSupplierOrderRequest(1, 2, orderId, nextOrderId), false);
  assert.equal(isLatestSupplierOrderRequest(2, 2, nextOrderId, nextOrderId), true);
});

test("page and workspace keep summaries on the critical path only", () => {
  const page = readFileSync("app/(authenticated)/pedidos/page.tsx", "utf8");
  const workspace = readFileSync(
    "app/(authenticated)/pedidos/orders-workspace.tsx",
    "utf8",
  );
  const dataLoader = readFileSync("lib/supplier-orders-data.ts", "utf8");

  assert.match(page, /loadSupplierOrderSummaries\(view\)/);
  assert.doesNotMatch(page, /loadSupplierOrdersData/);
  assert.match(workspace, /\/api\/supplier-orders\/\$\{encodeURIComponent\(orderId\)\}/);
  assert.match(workspace, /\/media\?view=\$\{view\}/);
  assert.match(workspace, /\/api\/supplier-orders\/catalog/);
  assert.match(workspace, /\/api\/supplier-orders\/search/);
  assert.doesNotMatch(workspace, /data\.items\.forEach/);
  assert.doesNotMatch(workspace, /data\.catalog\.configurations/);
  assert.match(workspace, /data-testid="supplier-order-detail-pending"/);
  assert.match(workspace, /selectedOrderId && .*detailState\.status === "loading"/s);
  assert.match(dataLoader, /loader: "summaries"/);
  assert.match(dataLoader, /loader: "detail_core"/);
  assert.match(dataLoader, /detail_core_ms/);
  assert.match(dataLoader, /loader: "detail_media"/);
  assert.match(dataLoader, /enrichment_ms/);
  assert.match(dataLoader, /signed_urls_ms/);
  assert.match(dataLoader, /payloadBytes/);
  assert.match(workspace, /loadCatalog\(\)/);
});

test("read routes are authenticated, dynamic and no-store", () => {
  for (const path of [
    "app/api/supplier-orders/[orderId]/route.ts",
    "app/api/supplier-orders/[orderId]/media/route.ts",
    "app/api/supplier-orders/catalog/route.ts",
    "app/api/supplier-orders/search/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /authenticateSupplierOrdersRequest/);
    assert.match(source, /force-dynamic/);
    assert.match(source, /Cache-Control.*no-store/s);
  }
});
