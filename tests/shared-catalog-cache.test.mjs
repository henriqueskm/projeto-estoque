import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";

import { POST as createPhotoLoosePart } from "../app/api/assistant/order-photo/create-loose-part/route.ts";
import { getInboundCatalog } from "../lib/inbound-data.ts";
import { loadInventoryData } from "../lib/inventory-data.ts";
import { getOutboundCatalog } from "../lib/outbound-data.ts";
import {
  invalidateNkCatalog,
  loadSharedCatalogForCurrentRequest,
} from "../lib/shared-catalog.ts";
import { buildStockCatalogBase } from "../lib/stock-catalog-base.ts";
import {
  buildFreshMinimumStockMaps,
  loadFreshMinimumStocks,
  loadFreshStockBalances,
} from "../lib/stock-operational-data.ts";

function fakeCatalogClient(tables, latencyMs = 0) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      let orderColumn = "id";
      let selectedColumns = null;
      const query = {
        select(columns) {
          selectedColumns = columns.split(",").map((column) => column.trim());
          return query;
        },
        order(column) {
          orderColumn = column;
          return query;
        },
        async range(from, to) {
          if (latencyMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, latencyMs));
          }
          const rows = [...(tables[table] ?? [])]
            .sort((left, right) =>
              String(left[orderColumn]).localeCompare(String(right[orderColumn])),
            )
            .map((row) =>
              selectedColumns
                ? Object.fromEntries(
                    selectedColumns.map((column) => [column, row[column]]),
                  )
                : row,
            );
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
}

function catalogFixture(suffix) {
  return {
    items: [
      {
        id: `servo-${suffix}`,
        code: `S-${suffix}`,
        description: `Servo ${suffix}`,
        item_type: "SERVO",
        is_active: true,
        minimum_stock: 999,
      },
      {
        id: `kit-${suffix}`,
        code: `K-${suffix}`,
        description: `Kit ${suffix}`,
        item_type: "INSTALLATION_KIT",
        is_active: true,
        minimum_stock: 999,
      },
    ],
    servo_models: [{ item_id: `servo-${suffix}`, model: `M-${suffix}` }],
    commercial_configurations: [
      {
        id: `configuration-${suffix}`,
        description: `Caixa ${suffix}`,
        servo_id: `servo-${suffix}`,
        installation_kit_id: `kit-${suffix}`,
        is_active: true,
        image_path: `catalog/${suffix}.png`,
        minimum_stock: 999,
      },
    ],
    commercial_configuration_codes: [
      {
        id: `code-${suffix}`,
        configuration_id: `configuration-${suffix}`,
        code: `C-${suffix}`,
        is_active: true,
      },
    ],
  };
}

function authenticate(userId, token = `token-${userId}`) {
  globalThis.__NK66_CURRENT_AUTH__ = {
    active: true,
    userId,
    sessionUserId: userId,
    token,
  };
}

beforeEach(() => {
  globalThis.__NK66_GATE_CALLS__ = 0;
  globalThis.__NK66_CURRENT_AUTH__ = null;
  globalThis.__NK66_BOUND_TOKENS__ = [];
  globalThis.__NK66_CACHE_LOOKUPS__ = [];
  globalThis.__NK66_REVALIDATE_CALLS__ = [];
  globalThis.__NK66_PERSISTENT_CACHE__ = new Map();
  globalThis.__NK66_CLIENTS_BY_TOKEN__ = new Map();
  globalThis.__NK66_REQUEST_CLIENT__ = null;
  globalThis.__NK66_EXECUTE_CATALOG_WRITE__ = async () => {
    throw new Error("catalog writer test double was not configured");
  };
});

test("cache persistente é isolado por usuário e preenchido pelo JWT/RLS correspondente", async () => {
  const clientA = fakeCatalogClient(catalogFixture("A"));
  const clientB = fakeCatalogClient(catalogFixture("B"));
  globalThis.__NK66_CLIENTS_BY_TOKEN__.set("token-user-a", clientA);
  globalThis.__NK66_CLIENTS_BY_TOKEN__.set("token-user-b", clientB);

  authenticate("user-a");
  const firstA = await loadSharedCatalogForCurrentRequest();
  authenticate("user-b");
  const firstB = await loadSharedCatalogForCurrentRequest();
  authenticate("user-a");
  const warmA = await loadSharedCatalogForCurrentRequest();

  assert.equal(firstA.items.some((item) => item.code === "S-A"), true);
  assert.equal(firstB.items.some((item) => item.code === "S-B"), true);
  assert.deepEqual(warmA, firstA);
  assert.deepEqual(globalThis.__NK66_BOUND_TOKENS__, ["token-user-a", "token-user-b", "token-user-a"]);
  assert.equal(clientA.calls.length, 4, "warm user A must not refill metadata");
  assert.equal(clientB.calls.length, 4);
  assert.equal(globalThis.__NK66_GATE_CALLS__, 3, "active profile gate stays fresh before every lookup");
  assert.deepEqual(globalThis.__NK66_CACHE_LOOKUPS__, [
    ["nk-shared-catalog", "user-a"],
    ["nk-shared-catalog", "user-b"],
    ["nk-shared-catalog", "user-a"],
  ]);
  assert.equal(
    JSON.stringify(globalThis.__NK66_CACHE_LOOKUPS__).includes("token-user"),
    false,
  );
});

test("usuário anônimo/inativo e sessão divergente falham antes de ler catálogo", async () => {
  await assert.rejects(
    () => loadSharedCatalogForCurrentRequest(),
    /redirected before catalog lookup/,
  );
  assert.equal(globalThis.__NK66_CACHE_LOOKUPS__.length, 0);
  assert.equal(globalThis.__NK66_BOUND_TOKENS__.length, 0);

  const client = fakeCatalogClient(catalogFixture("A"));
  globalThis.__NK66_CLIENTS_BY_TOKEN__.set("token-user-a", client);
  authenticate("user-a");
  globalThis.__NK66_CURRENT_AUTH__.sessionUserId = "different-user";
  await assert.rejects(() => loadSharedCatalogForCurrentRequest(), {
    name: "SharedCatalogError",
  });
  assert.equal(globalThis.__NK66_CACHE_LOOKUPS__.length, 0);
  assert.equal(client.calls.length, 0);
});

test("misses concorrentes entre requests seguem a semântica real do Next e invalidação revela catálogo novo", async () => {
  const tables = catalogFixture("A");
  const client = fakeCatalogClient(tables, 10);
  globalThis.__NK66_CLIENTS_BY_TOKEN__.set("token-user-a", client);
  authenticate("user-a");

  const [first, second] = await Promise.all([
    loadSharedCatalogForCurrentRequest(),
    loadSharedCatalogForCurrentRequest(),
  ]);
  assert.deepEqual(second, first);
  assert.equal(
    client.calls.length,
    8,
    "unstable_cache does not guarantee cross-request cold-miss single-flight",
  );

  tables.items.push({
    id: "part-new",
    code: "NEW",
    description: "Nova peça",
    item_type: "LOOSE_PART",
    is_active: true,
  });
  tables.commercial_configuration_codes.push({
    id: "code-new-alias",
    configuration_id: "configuration-A",
    code: "C-A2",
    is_active: true,
  });
  const stillWarm = await loadSharedCatalogForCurrentRequest();
  assert.equal(stillWarm.items.some((item) => item.code === "NEW"), false);

  invalidateNkCatalog();
  const refreshed = await loadSharedCatalogForCurrentRequest();
  assert.equal(refreshed.items.some((item) => item.code === "NEW"), true);
  assert.equal(
    refreshed.commercialCodes.some((code) => code.code === "C-A2"),
    true,
  );
  assert.equal(client.calls.length, 12, "post-invalidation read blocks for a fresh fill");
});

test("retry created:false recupera cache quando o primeiro commit perdeu a resposta", async () => {
  const tables = catalogFixture("A");
  const client = fakeCatalogClient(tables);
  globalThis.__NK66_CLIENTS_BY_TOKEN__.set("token-user-a", client);
  authenticate("user-a");

  const beforeCommit = await loadSharedCatalogForCurrentRequest();
  assert.equal(beforeCommit.items.some((item) => item.code === "RECOVERED"), false);

  // Modela a primeira RPC já commitada no banco. A resposta/processo se perde
  // antes de o endpoint alcançar invalidateNkCatalog().
  tables.items.push({
    id: "recovered-part",
    code: "RECOVERED",
    description: "Peça recuperada",
    item_type: "LOOSE_PART",
    is_active: true,
  });
  const staleAfterLostResponse = await loadSharedCatalogForCurrentRequest();
  assert.equal(
    staleAfterLostResponse.items.some((item) => item.code === "RECOVERED"),
    false,
  );

  globalThis.__NK66_EXECUTE_CATALOG_WRITE__ = async (_client, write) => {
    assert.deepEqual(write, {
      kind: "CATALOG_ONLY_LOOSE_PART",
      code: "RECOVERED",
      description: "Peça recuperada",
    });
    return {
      data: {
        code: "RECOVERED",
        description: "Peça recuperada",
        created: false,
      },
      error: null,
    };
  };
  const response = await createPhotoLoosePart(
    new Request("https://nk.invalid/api/assistant/order-photo/create-loose-part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "RECOVERED",
        description: "Peça recuperada",
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    code: "RECOVERED",
    description: "Peça recuperada",
    created: false,
  });
  assert.deepEqual(globalThis.__NK66_REVALIDATE_CALLS__, [
    "nk-shared-catalog-v1",
  ]);

  const recovered = await loadSharedCatalogForCurrentRequest();
  assert.equal(recovered.items.some((item) => item.code === "RECOVERED"), true);
});

test("snapshot guarda apenas path estável; saldos e mínimos são relidos e alteram builders", async () => {
  const tables = catalogFixture("A");
  tables.stock_balances = [
    { item_id: "servo-A", quantity: 8 },
    { item_id: "kit-A", quantity: 4 },
  ];
  tables.configuration_stock_balances = [
    { configuration_id: "configuration-A", quantity: 2 },
  ];
  const operationalClient = fakeCatalogClient(tables);
  globalThis.__NK66_CLIENTS_BY_TOKEN__.set("token-user-a", operationalClient);
  authenticate("user-a");
  const snapshot = await loadSharedCatalogForCurrentRequest();

  assert.equal(snapshot.configurations[0].image_path, "catalog/A.png");
  assert.equal("imageUrl" in snapshot.configurations[0], false);
  assert.equal("minimum_stock" in snapshot.items[0], false);
  assert.equal("minimum_stock" in snapshot.configurations[0], false);

  const firstBalances = await loadFreshStockBalances(operationalClient);
  const firstMinimums = await loadFreshMinimumStocks(operationalClient);
  const firstBase = buildStockCatalogBase(
    snapshot,
    firstBalances.stockBalancesResult.data,
    firstBalances.configurationBalancesResult.data,
  );
  const firstMinimumMaps = buildFreshMinimumStockMaps(
    snapshot,
    firstMinimums.itemMinimumsResult.data,
    firstMinimums.configurationMinimumsResult.data,
  );
  assert.equal(firstBase.physicalItems[0].balance, 4);
  assert.equal(firstBase.commercialCodes[0].assembledBalance, 2);
  assert.equal(firstMinimumMaps.itemMinimumById.get("servo-A"), 999);

  tables.stock_balances[0].quantity = 7;
  tables.configuration_stock_balances[0].quantity = 1;
  tables.items[0].minimum_stock = 6;
  const nextBalances = await loadFreshStockBalances(operationalClient);
  const nextMinimums = await loadFreshMinimumStocks(operationalClient);
  const nextBase = buildStockCatalogBase(
    snapshot,
    nextBalances.stockBalancesResult.data,
    nextBalances.configurationBalancesResult.data,
  );
  const nextMinimumMaps = buildFreshMinimumStockMaps(
    snapshot,
    nextMinimums.itemMinimumsResult.data,
    nextMinimums.configurationMinimumsResult.data,
  );
  assert.equal(nextBase.physicalItems.find((item) => item.id === "servo-A").balance, 7);
  assert.equal(nextBase.commercialCodes[0].assembledBalance, 1);
  assert.equal(nextMinimumMaps.itemMinimumById.get("servo-A"), 6);
});

test("Entrada, Saída e Estoque compartilham metadados, mas renovam estado e signed URL por render", async () => {
  const catalogTables = catalogFixture("A");
  const catalogClient = fakeCatalogClient(catalogTables);
  const operationalTables = {
    items: [
      { id: "servo-A", minimum_stock: 3 },
      { id: "kit-A", minimum_stock: 2 },
    ],
    commercial_configurations: [
      { id: "configuration-A", minimum_stock: 1 },
    ],
    stock_balances: [
      { item_id: "servo-A", quantity: 8 },
      { item_id: "kit-A", quantity: 4 },
    ],
    configuration_stock_balances: [
      { configuration_id: "configuration-A", quantity: 2 },
    ],
  };
  const requestClient = fakeCatalogClient(operationalTables);
  let signedUrlGeneration = 0;
  requestClient.storage = {
    from() {
      return {
        async createSignedUrls(paths) {
          signedUrlGeneration += 1;
          return {
            data: paths.map((path) => ({
              path,
              signedUrl: `https://media.invalid/${path}?generation=${signedUrlGeneration}`,
              error: null,
            })),
            error: null,
          };
        },
      };
    },
  };
  globalThis.__NK66_CLIENTS_BY_TOKEN__.set("token-user-a", catalogClient);
  globalThis.__NK66_REQUEST_CLIENT__ = requestClient;
  authenticate("user-a");

  const inbound = await getInboundCatalog();
  assert.equal(inbound.error, null);
  assert.equal(
    inbound.data.commercialCodes[0].imageUrl,
    "https://media.invalid/catalog/A.png?generation=1",
  );
  assert.equal(
    inbound.data.physicalItems.find((item) => item.id === "servo-A").balance,
    8,
  );

  operationalTables.stock_balances[0].quantity = 7;
  operationalTables.configuration_stock_balances[0].quantity = 1;
  const outbound = await getOutboundCatalog();
  assert.equal(outbound.error, null);
  assert.equal(
    outbound.data.commercialCodes[0].imageUrl,
    "https://media.invalid/catalog/A.png?generation=2",
  );
  assert.equal(outbound.data.commercialCodes[0].servo.balance, 7);
  assert.equal(outbound.data.commercialCodes[0].assembledBalance, 1);

  const inventory = await loadInventoryData();
  assert.equal(inventory.error, null);
  assert.equal(
    inventory.data.physicalItems.find((item) => item.id === "servo-A")
      .totalQuantity,
    8,
  );
  assert.equal(inventory.data.configurations[0].minimumStock, 1);
  assert.equal(
    inventory.data.configurations[0].imageUrl,
    "https://media.invalid/catalog/A.png?generation=3",
  );
  assert.equal(catalogClient.calls.length, 4, "structural metadata is shared");
  assert.equal(
    requestClient.calls.filter((table) => table === "stock_balances").length,
    3,
    "operational balance is read for every loader",
  );
});

test("writers de catálogo invalidam; operações sem catálogo não invalidam", async () => {
  const sharedCatalog = await readFile(
    new URL("../lib/shared-catalog.ts", import.meta.url),
    "utf8",
  );
  const inboundAction = await readFile(
    new URL("../app/(authenticated)/entrada/actions.ts", import.meta.url),
    "utf8",
  );
  const photoWriter = await readFile(
    new URL(
      "../app/api/assistant/order-photo/create-loose-part/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const unrelatedOperationalFiles = await Promise.all(
    [
      "../app/(authenticated)/saida/actions.ts",
      "../app/(authenticated)/estoque/actions.ts",
      "../lib/assistant-configuration-assembly.ts",
      "../lib/assistant-configuration-disassembly.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  assert.match(
    inboundAction,
    /normalized\.lines\.some\(\(line\) => line\.kind === "NEW_LOOSE_PART"\)[\s\S]*invalidateNkCatalog\(\)/u,
  );
  assert.match(photoWriter, /invalidateNkCatalog\(\);\s*return assistantOrderPhotoJson/u);
  assert.doesNotMatch(photoWriter, /if \(result\.created\)/u);
  assert.match(
    sharedCatalog,
    /loadSharedCatalogSnapshot = cache\(\s*loadSharedCatalogForCurrentRequest/u,
  );
  assert.match(sharedCatalog, /\["nk-shared-catalog", profile\.id\]/u);
  assert.doesNotMatch(sharedCatalog, /access_token\s*\]/u);
  unrelatedOperationalFiles.forEach((source) =>
    assert.doesNotMatch(source, /invalidateNkCatalog/u),
  );
});

test("mínimo ausente nunca degrada silenciosamente para zero", () => {
  const snapshot = {
    items: [{ id: "item-1" }],
    configurations: [{ id: "configuration-1" }],
  };
  assert.throws(
    () => buildFreshMinimumStockMaps(snapshot, [], []),
    /does not match the catalog/,
  );
});
