import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  consultAssistantItem,
  consultAssistantInventoryItemSummary,
  consultAssistantInventoryMultiItemSummary,
  AssistantDataError,
} from "../lib/assistant-data.ts";
import { loadAssistantBundles } from "../lib/assistant-bundles.ts";
import { parseAssistantStructuredBlock } from "../lib/assistant-types.ts";
import { answerAssistantQuestion } from "../lib/ai/assistant.ts";

const id = (n) => `73000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let tables, calls, client;
function fixture() {
  return {
    items: ["1", "KT-01", "CIL", "EMP", "RES", "COT"].map((code, index) => ({
      id: id(index + 1),
      code,
      description: code,
      item_type:
        index === 0 ? "SERVO" : index === 1 ? "INSTALLATION_KIT" : "LOOSE_PART",
      minimum_stock: 0,
      is_active: true,
    })),
    servo_models: [{ item_id: id(1), model: "MBF-001" }],
    stock_balances: [1, 2, 3, 4, 5, 6].map((n) => ({
      item_id: id(n),
      quantity: 10,
    })),
    commercial_configurations: [
      {
        id: id(10),
        servo_id: id(1),
        installation_kit_id: id(2),
        description: "Servo com kit 1H",
        minimum_stock: 2,
        is_active: true,
        image_path: null,
      },
    ],
    commercial_configuration_codes: [
      { id: id(11), configuration_id: id(10), code: "1H", is_active: true },
    ],
    configuration_stock_balances: [{ configuration_id: id(10), quantity: 5 }],
    servo_repair_compatibility: [],
    commercial_bundles: [
      {
        id: id(20),
        description: "Conjunto comercial 1HC",
        minimum_stock: 2,
        is_active: true,
      },
    ],
    commercial_bundle_codes: [
      { id: id(21), bundle_id: id(20), code: "1HC", is_active: true },
      { id: id(22), bundle_id: id(20), code: "1HC-ALT", is_active: true },
    ],
    commercial_bundle_components: [
      {
        bundle_id: id(20),
        configuration_id: id(10),
        item_id: null,
        quantity_per_bundle: 1,
      },
      ...[3, 4, 5, 6].map((n) => ({
        bundle_id: id(20),
        item_id: id(n),
        configuration_id: null,
        quantity_per_bundle: 1,
      })),
    ],
    bundle_stock_balances: [{ bundle_id: id(20), quantity: 0 }],
  };
}
function fakeClient({ allowed = true, failedTable = null } = {}) {
  return {
    rpc() {
      throw new Error("Unexpected stock write");
    },
    from(table) {
      const filters = [],
        orders = [];
      let limit = 1000;
      const execute = (from = 0, to = limit - 1) => {
        calls.push({
          table,
          from,
          to,
          filters: filters.map((filter) => filter.slice(0, 2)),
        });
        if (table === failedTable)
          return Promise.resolve({
            data: null,
            error: { message: "Read failed" },
          });
        const data = allowed
          ? (tables[table] ?? []).filter((row) =>
              filters.every(([key, value, op]) =>
                op === "in" ? value.includes(row[key]) : row[key] === value,
              ),
            )
          : [];
        data.sort((a, b) => {
          for (const key of orders) {
            const result = String(a[key] ?? "").localeCompare(
              String(b[key] ?? ""),
            );
            if (result) return result;
          }
          return 0;
        });
        return Promise.resolve({
          data: data.slice(from, Math.min(to + 1, from + 1000)),
          error: null,
        });
      };
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          filters.push([key, value, "eq"]);
          return query;
        },
        in(key, values) {
          filters.push([key, values, "in"]);
          return query;
        },
        order(key) {
          orders.push(key);
          return query;
        },
        limit(value) {
          limit = value;
          return query;
        },
        range(from, to) {
          return execute(from, to);
        },
        then(resolve, reject) {
          return execute().then(resolve, reject);
        },
      };
      return query;
    },
  };
}
beforeEach(() => {
  tables = fixture();
  calls = [];
  client = fakeClient();
  globalThis.__NK63_PAGINATION_CLIENT__ = client;
});
const summary = (metric = "STOCK", code = "1HC") =>
  consultAssistantInventoryItemSummary(code, metric);
const emptyContext = {
  topic: "GENERAL",
  itemQuery: null,
  itemReferenceKind: null,
  supplierOrderId: null,
  supplierOrderCatalogCode: null,
  lastIntent: null,
  suggestedFollowUp: null,
  statisticsPeriod: null,
  statisticsIntent: null,
  statisticsCode: null,
};
function answer(message, overrides = {}) {
  return answerAssistantQuestion(
    message,
    null,
    null,
    null,
    "Teste",
    "test-user",
    "Teste",
    null,
    null,
    null,
    null,
    null,
    null,
    [],
    emptyContext,
    {
      semanticRouter: async () => ({ status: "FALLBACK", reason: "TIMEOUT" }),
      itemLookupReader: consultAssistantItem,
      inventorySummaryReader: consultAssistantInventoryItemSummary,
      inventoryMultiSummaryReader: consultAssistantInventoryMultiItemSummary,
      ...overrides,
    },
  );
}

test("full lookup resolves an explicit bundle, active aliases and complete recipe", async () => {
  const lookup = await consultAssistantItem("1HC");
  assert.equal(lookup.exact_code_match, true);
  const bundle = lookup.results[0];
  assert.equal(bundle.kind, "COMMERCIAL_BUNDLE");
  assert.equal(bundle.bundle_id, id(20));
  assert.equal(bundle.code, "1HC");
  assert.deepEqual(bundle.aliases, ["1HC", "1HC-ALT"]);
  assert.deepEqual(
    new Set(
      bundle.recipe.map(
        (component) => `${component.quantity_per_bundle} × ${component.code}`,
      ),
    ),
    new Set(["1 × 1H", "1 × CIL", "1 × EMP", "1 × RES", "1 × COT"]),
  );
  assert.equal(bundle.ready_quantity, 0);
  assert.equal(bundle.maximum_assemblable, 5);
  assert.equal(bundle.state, "ZERO");
});

test("exact summary reads only requested recipes and uses a safe real Inventory link", async () => {
  const block = await summary();
  assert.equal(block.status, "FOUND");
  assert.equal(block.results[0].targetKind, "commercial_bundle");
  assert.equal(block.results[0].itemType, "COMMERCIAL_BUNDLE");
  assert.equal(block.results[0].href, "/estoque");
  assert.ok(parseAssistantStructuredBlock(block));
  assert.ok(
    calls.some(
      (call) =>
        call.table === "commercial_bundle_codes" &&
        call.filters.some(
          ([key, values]) => key === "code" && values.includes("1HC"),
        ),
    ),
  );
  for (const call of calls.filter((call) =>
    [
      "commercial_bundles",
      "commercial_bundle_components",
      "bundle_stock_balances",
    ].includes(call.table),
  )) {
    assert.ok(
      call.filters.some(
        ([key, values]) =>
          ["id", "bundle_id"].includes(key) && values.includes(id(20)),
      ),
    );
  }
});

for (const [message, pattern] of [
  ["Quantos 1HC tenho?", /0 conjuntos 1HC prontos/],
  ["Qual o saldo do 1HC?", /0 conjuntos 1HC prontos/],
  ["Qual o estoque mínimo do 1HC?", /mínimo.*1HC.*2/],
  ["Qual a situação do 1HC?", /Zerado/],
  ["Quantos 1HC consigo montar?", /consegue montar 5 conjuntos 1HC/],
  ["O que compõe o 1HC?", /conjunto 1HC é formado por/],
  ["Qual a composição do 1HC?", /1 × 1H/],
]) {
  test(`deterministic read-only answer: ${message}`, async () => {
    const response = await answer(message);
    assert.match(response.message, pattern);
    assert.equal(response.structuredBlock?.kind, "inventory_item_summary");
    assert.ok(parseAssistantStructuredBlock(response.structuredBlock));
    assert.equal(response.structuredBlock.results[0].currentStock, 0);
    if (/compõe|composição/.test(message))
      for (const code of ["1H", "CIL", "EMP", "RES", "COT"])
        assert.ok(response.message.includes(`1 × ${code}`));
  });
}

test("multi-code query resolves configuration and bundle separately", async () => {
  const response = await answer("Quanto tenho de 1H e 1HC?");
  const block = response.structuredBlock;
  assert.equal(block.kind, "inventory_multi_item_summary");
  assert.deepEqual(
    block.entries.map((entry) => entry.results[0].targetKind),
    ["commercial_configuration", "commercial_bundle"],
  );
  assert.deepEqual(
    block.entries.map((entry) => entry.results[0].currentStock),
    [5, 0],
  );
  assert.ok(parseAssistantStructuredBlock(block));
});

test("bundle aliases collapse to the same target without duplicating balance", async () => {
  const lookup = await consultAssistantItem("1HC-ALT");
  assert.equal(lookup.results[0].code, "1HC-ALT");
  const block = await consultAssistantInventoryMultiItemSummary(
    ["1HC", "1HC-ALT"],
    "STOCK",
  );
  assert.equal(block.entries.length, 1);
  assert.deepEqual(block.entries[0].requestedCodes, ["1HC", "1HC-ALT"]);
  assert.deepEqual(block.entries[0].equivalentCodes, ["1HC", "1HC-ALT"]);
});

test("1H remains free operational stock even when embedded in bundles", async () => {
  tables.configuration_stock_balances[0].quantity = 0;
  tables.bundle_stock_balances[0].quantity = 1;
  const block = await consultAssistantInventoryMultiItemSummary(
    ["1H", "1HC"],
    "STOCK",
  );
  assert.equal(block.entries[0].results[0].currentStock, 0);
  assert.equal(block.entries[0].results[0].status, "ZERO");
  assert.equal(block.entries[1].results[0].currentStock, 1);
  assert.equal(block.entries[1].results[0].maximumAssemblable, 0);
});

test("capacity divides free quantities by recipe amounts and never uses physical totals", async () => {
  tables.commercial_bundle_components[1].quantity_per_bundle = 3;
  tables.stock_balances.find((row) => row.item_id === id(3)).quantity = 7;
  assert.equal((await summary()).results[0].maximumAssemblable, 2);
  tables.stock_balances.find((row) => row.item_id === id(3)).quantity = 0;
  tables.bundle_stock_balances[0].quantity = 8;
  assert.equal((await summary()).results[0].maximumAssemblable, 0);
  assert.equal((await summary()).results[0].currentStock, 8);
});

test("ready balance and minimum remain fresh across repeated reads", async () => {
  assert.equal((await summary()).results[0].currentStock, 0);
  tables.bundle_stock_balances[0].quantity = 3;
  tables.commercial_bundles[0].minimum_stock = 4;
  const target = (await summary()).results[0];
  assert.equal(target.currentStock, 3);
  assert.equal(target.minimumStock, 4);
  assert.equal(target.status, "LOW");
  tables.commercial_bundles[0].minimum_stock = 0;
  assert.equal((await summary("MINIMUM")).results[0].minimumStock, 0);
});

test("missing balance means zero, not assembly capacity", async () => {
  tables.bundle_stock_balances = [];
  const target = (await summary()).results[0];
  assert.equal(target.currentStock, 0);
  assert.equal(target.maximumAssemblable, 5);
});

test("inactive aliases and bundle definitions do not resolve as active catalogue targets", async () => {
  tables.commercial_bundle_codes[1].is_active = false;
  assert.equal((await summary("STOCK", "1HC-ALT")).status, "NOT_FOUND");
  tables.commercial_bundles[0].is_active = false;
  assert.equal((await summary()).status, "NOT_FOUND");
});

test("inactive component cannot contribute assembly capacity; ready stock stays readable", async () => {
  tables.items[2].is_active = false;
  tables.bundle_stock_balances[0].quantity = 1;
  const target = (await summary()).results[0];
  assert.equal(target.currentStock, 1);
  assert.equal(target.maximumAssemblable, 0);
  assert.equal(target.bundleRecipe.length, 5);
});

test("RLS-empty client never receives another session's bundle catalogue", async () => {
  await summary();
  globalThis.__NK63_PAGINATION_CLIENT__ = fakeClient({ allowed: false });
  assert.equal((await summary()).status, "NOT_FOUND");
});

test("failed reads fail closed instead of reporting false zero stock", async () => {
  globalThis.__NK63_PAGINATION_CLIENT__ = fakeClient({
    failedTable: "bundle_stock_balances",
  });
  await assert.rejects(summary(), AssistantDataError);
});

test("missing recipe component fails closed", async () => {
  tables.items = tables.items.filter((item) => item.code !== "CIL");
  await assert.rejects(summary(), AssistantDataError);
});

test("bundle catalogue pagination remains complete beyond 1000 codes", async () => {
  tables.commercial_bundle_codes = Array.from({ length: 1005 }, (_, index) => ({
    id: id(index + 100),
    bundle_id: id(20),
    code: `B-${index}`,
    is_active: true,
  }));
  const bundles = await loadAssistantBundles(client);
  assert.equal(bundles[0].aliases.length, 1005);
  assert.ok(
    calls.some(
      (call) => call.table === "commercial_bundle_codes" && call.from === 1000,
    ),
  );
});

test("recipe pagination distinguishes ITEM and CONFIGURATION sharing a UUID", async () => {
  const previousId = tables.items[2].id;
  tables.items[2].id = id(10);
  tables.stock_balances.find((balance) => balance.item_id === previousId).item_id = id(10);
  tables.commercial_bundle_components.find((component) => component.item_id === previousId).item_id = id(10);
  const target = (await summary()).results[0];
  assert.equal(target.bundleRecipe.length, 5);
  assert.equal(target.maximumAssemblable, 5);
});

test("servo model lookup and existing configuration aliases still work", async () => {
  const lookup = await consultAssistantItem("MBF-001");
  assert.ok(lookup.results.some((item) => item.kind === "SERVO"));
  assert.ok(
    lookup.results.some((item) => item.kind === "COMMERCIAL_CONFIGURATION"),
  );
  assert.ok(!lookup.results.some((item) => item.kind === "COMMERCIAL_BUNDLE"));
  assert.equal((await summary("STOCK", "1H")).results[0].currentStock, 5);
});

test("structured parser rejects fake configuration links, negative capacity and invalid recipes", async () => {
  const block = await summary();
  for (const patch of [
    { href: `/estoque?configuration=${id(20)}` },
    { maximumAssemblable: -1 },
    { bundleRecipe: [] },
    {
      bundleRecipe: [
        { ...block.results[0].bundleRecipe[0], quantity_per_bundle: 0 },
      ],
    },
  ]) {
    assert.equal(
      parseAssistantStructuredBlock({
        ...block,
        results: [{ ...block.results[0], ...patch }],
      }),
      null,
    );
  }
});

for (const message of [
  "Entraram 2 unidades de 1HC",
  "Saíram 2 unidades de 1HC",
  "Monte 1 unidade de 1HC",
  "Desmonte 1 unidade de 1HC",
]) {
  test(`bundle chat writes remain unsupported: ${message}`, async () => {
    const response = await answer(message);
    assert.ok(
      !response.structuredBlock ||
        !/(entry|output|assembly|disassembly).*preview/.test(
          response.structuredBlock.kind,
        ),
    );
    assert.ok(!JSON.stringify(response).includes('"proposalToken"'));
    assert.ok(!JSON.stringify(response).includes('"targetKind":"BUNDLE_CODE"'));
  });
}

test("semantic read-only plan also resolves bundles through the exact summary reader", async () => {
  const response = await answer("Pode me detalhar 1HC?", {
    semanticRouter: async () => ({
      status: "ROUTED",
      result: {
        intent: "QUERY",
        query: {
          kind: "INVENTORY_ITEM",
          targetQuery: "1HC",
          metric: "COMPOSITION",
        },
      },
    }),
  });
  assert.equal(response.structuredBlock?.kind, "inventory_item_summary");
  assert.equal(
    response.structuredBlock.results[0].targetKind,
    "commercial_bundle",
  );
});
