import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  buildBundleInventory,
  loadBundleInventoryRows,
} from "../lib/bundle-inventory.ts";
import { loadInventoryData } from "../lib/inventory-data.ts";
import { buildStockFlowSearch } from "../lib/stock-flow-search.ts";
import { runStockAdjustmentSubmission } from "../lib/stock-adjustment-stale-conflict.ts";
import {
  assembleCommercialBundle,
  disassembleCommercialBundle,
  adjustInventoryStock,
} from "../app/(authenticated)/estoque/actions.ts";
import { InventoryWorkspace } from "../app/(authenticated)/estoque/inventory-workspace.tsx";
import { InventoryRowActions } from "../components/inventory-row-actions.tsx";
import { getInboundCatalog } from "../lib/inbound-data.ts";
import { getOutboundCatalog } from "../lib/outbound-data.ts";
import { InboundEntryFlow } from "../app/(authenticated)/entrada/inbound-entry-flow.tsx";
import { OutboundEntryFlow } from "../app/(authenticated)/saida/outbound-entry-flow.tsx";

const id = (n) => `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bundleId = id(20),
  configurationId = id(10),
  key = id(30);
let tables, calls, rpcCalls;
function fixture() {
  const codes = ["1", "KT-01", "CIL", "EMP", "RES", "COT", "RP-01"];
  return {
    items: codes.map((code, index) => ({
      id: id(index + 1),
      code,
      description:
        index === 0 ? "SERVO MBF-015 Deslocado" : `Componente ${code}`,
      item_type:
        index === 0
          ? "SERVO"
          : index === 1
            ? "INSTALLATION_KIT"
            : index === 6
              ? "REPAIR_KIT"
              : "LOOSE_PART",
      is_active: true,
      minimum_stock: 0,
    })),
    servo_models: [{ item_id: id(1), model: "MBF-015 Deslocado" }],
    commercial_configurations: [
      {
        id: configurationId,
        description: "1H montado",
        servo_id: id(1),
        installation_kit_id: id(2),
        is_active: true,
        minimum_stock: 1,
        image_path: "1h.png",
      },
    ],
    commercial_configuration_codes: [
      {
        id: id(11),
        configuration_id: configurationId,
        code: "1H",
        is_active: true,
      },
    ],
    stock_balances: codes.map((_, index) => ({
      item_id: id(index + 1),
      quantity: 5,
    })),
    configuration_stock_balances: [
      { configuration_id: configurationId, quantity: 3 },
    ],
    commercial_bundles: [
      {
        id: bundleId,
        description: "Conjunto 1HC",
        is_active: true,
        minimum_stock: 0,
      },
    ],
    commercial_bundle_codes: [
      { id: id(21), bundle_id: bundleId, code: "1HC", is_active: true },
    ],
    commercial_bundle_components: [
      {
        bundle_id: bundleId,
        configuration_id: configurationId,
        item_id: null,
        quantity_per_bundle: 1,
      },
      ...[3, 4, 5, 6].map((n) => ({
        bundle_id: bundleId,
        item_id: id(n),
        configuration_id: null,
        quantity_per_bundle: 1,
      })),
    ],
    bundle_stock_balances: [{ bundle_id: bundleId, quantity: 1 }],
  };
}
function client() {
  return {
    auth: {
      async getClaims() {
        return {
          data: { claims: { sub: globalThis.__NK72_ACTIVE__ ? id(99) : null } },
          error: null,
        };
      },
    },
    from(table) {
      const filters = [],
        orders = [];
      const query = {
        select() {
          return this;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return this;
        },
        order(column) {
          orders.push(column);
          return this;
        },
        async range(from, to) {
          calls.push({ table, from, to });
          const rows = [...(tables[table] ?? [])]
            .filter((row) => filters.every((filter) => filter(row)))
            .sort((a, b) => {
              for (const column of orders) {
                const result = String(a[column] ?? "").localeCompare(
                  String(b[column] ?? ""),
                );
                if (result) return result;
              }
              return 0;
            });
          return { data: rows.slice(from, to + 1), error: null };
        },
        async maybeSingle() {
          return {
            data:
              table === "profiles"
                ? { id: id(99) }
                : (tables[table]?.find((row) =>
                    filters.every((filter) => filter(row)),
                  ) ?? null),
            error: null,
          };
        },
      };
      return query;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return globalThis.__NK72_RPC_RESULT__;
    },
  };
}
beforeEach(() => {
  tables = fixture();
  calls = [];
  rpcCalls = [];
  globalThis.__NK72_ACTIVE__ = true;
  globalThis.__NK72_SNAPSHOT__ = {
    items: tables.items,
    servoModels: tables.servo_models,
    configurations: tables.commercial_configurations,
    commercialCodes: tables.commercial_configuration_codes,
  };
  globalThis.__NK72_CLIENT__ = client();
  globalThis.__NK72_PATHS__ = [];
  globalThis.__NK72_SEARCH__ = "";
  globalThis.__NK72_MENU_OPEN__ = false;
});

test("loader carrega 1HC em lote, deriva família e preserva receita", async () => {
  const { data, error } = await loadInventoryData();
  assert.equal(error, null);
  assert.equal(data.bundles[0].family, "MBF-015");
  assert.deepEqual(data.bundles[0].recipe.map((row) => row.code).sort(), [
    "1H",
    "CIL",
    "COT",
    "EMP",
    "RES",
  ]);
  for (const table of [
    "commercial_bundles",
    "commercial_bundle_codes",
    "commercial_bundle_components",
    "bundle_stock_balances",
  ])
    assert.equal(calls.filter((call) => call.table === table).length, 1);
  assert.equal(rpcCalls.length, 0);
});

test("buscar 1HC abre família e renderiza representação própria e saldo zero", async () => {
  tables.bundle_stock_balances = [];
  const { data } = await loadInventoryData();
  assert.equal(data.bundles[0].readyQuantity, 0);
  assert.equal(data.bundles[0].state, "EMPTY");
  globalThis.__NK72_SEARCH__ = "1HC";
  const html = renderToStaticMarkup(
    createElement(InventoryWorkspace, { inventory: data }),
  );
  assert.match(html, /id="inventory-family-0"[^>]*aria-expanded="true"/);
  assert.match(html, /MBF-015/);
  assert.match(html, /Conjunto/);
  assert.match(html, /Sem conjuntos prontos/);
  for (const code of ["1H", "CIL", "COT", "EMP", "RES"])
    assert.ok(html.includes(`1 × ${code}`));
});

test("capacidade usa somente saldo livre e quantidade por receita", async () => {
  tables.stock_balances.find((row) => row.item_id === id(3)).quantity = 1;
  tables.commercial_bundle_components.find(
    (row) => row.item_id === id(3),
  ).quantity_per_bundle = 2;
  tables.bundle_stock_balances[0].quantity = 100;
  const { data } = await loadInventoryData();
  assert.equal(data.bundles[0].maximumAssemblable, 0);
  tables.stock_balances.find((row) => row.item_id === id(3)).quantity = 7;
  assert.equal(
    (await loadInventoryData()).data.bundles[0].maximumAssemblable,
    3,
  );
});

test("montagem conserva total físico de configuração, servo, kit e peças sem dupla contagem", async () => {
  const before = (await loadInventoryData()).data;
  tables.configuration_stock_balances[0].quantity -= 1;
  for (const n of [3, 4, 5, 6])
    tables.stock_balances.find((row) => row.item_id === id(n)).quantity -= 1;
  tables.bundle_stock_balances[0].quantity += 1;
  const after = (await loadInventoryData()).data;
  assert.equal(after.configurations[0].assembledQuantity, 2);
  assert.equal(after.configurations[0].embeddedInBundlesQuantity, 2);
  assert.equal(after.configurations[0].totalPhysicalQuantity, 4);
  assert.equal(before.configurations[0].totalPhysicalQuantity, 4);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.equal(
      after.physicalItems.find((item) => item.id === id(n)).totalQuantity,
      before.physicalItems.find((item) => item.id === id(n)).totalQuantity,
    );
    assert.equal(
      after.physicalItems.find((item) => item.id === id(n)).embeddedQuantity,
      2,
    );
  }
  assert.equal(
    after.physicalItems.find((item) => item.id === id(1)).totalQuantity,
    9,
  );
  assert.equal(
    after.physicalItems.find((item) => item.id === id(3)).totalQuantity,
    6,
  );
  assert.equal(after.summary.completeBoxesTotal, 4);
  assert.equal(after.summary.loosePartTotal, before.summary.loosePartTotal);
});

test("minimum e balances de bundle são relidos; receita inválida falha fechada", async () => {
  await loadInventoryData();
  tables.commercial_bundles[0].minimum_stock = 2;
  tables.bundle_stock_balances[0].quantity = 0;
  const { data } = await loadInventoryData();
  assert.equal(data.bundles[0].minimumStock, 2);
  assert.equal(data.bundles[0].state, "ZERO");
  tables.commercial_bundle_components = [];
  assert.equal((await loadInventoryData()).data, null);
});

test("filtro zerado e alerta da configuração consideram seu estoque físico embutido", async () => {
  tables.configuration_stock_balances[0].quantity = 0;
  const { data } = await loadInventoryData();
  assert.equal(data.configurations[0].totalPhysicalQuantity, 1);
  assert.equal(data.configurations[0].state, "LOW");
  globalThis.__NK72_SEARCH__ = "1H";
  const zero = renderToStaticMarkup(createElement(InventoryWorkspace, { inventory: data, initialStatusFilter: "zero" }));
  assert.ok(!zero.includes(`inventory-configuration-${configurationId}`));
  const withStock = renderToStaticMarkup(createElement(InventoryWorkspace, { inventory: data, initialStatusFilter: "with-stock" }));
  assert.ok(withStock.includes(`inventory-configuration-${configurationId}`));
});

test("paginação dos quatro readers de bundle completa mais de 1000 linhas", async () => {
  tables.commercial_bundles = Array.from({ length: 1001 }, (_, i) => ({
    id: id(i + 100),
    description: "B",
    minimum_stock: 0,
    is_active: true,
  }));
  tables.commercial_bundle_codes = tables.commercial_bundles.map((row, i) => ({
    id: id(i + 2000),
    bundle_id: row.id,
    code: `B${i}`,
    is_active: true,
  }));
  tables.commercial_bundle_components = tables.commercial_bundles.map(
    (row) => ({
      bundle_id: row.id,
      item_id: id(3),
      configuration_id: null,
      quantity_per_bundle: 1,
    }),
  );
  tables.bundle_stock_balances = tables.commercial_bundles.map((row) => ({
    bundle_id: row.id,
    quantity: 0,
  }));
  const rows = await loadBundleInventoryRows(globalThis.__NK72_CLIENT__);
  for (const field of ["bundles", "codes", "components", "balances"])
    assert.equal(rows[field].length, 1001);
  const result = buildBundleInventory(
    rows,
    globalThis.__NK72_SNAPSHOT__,
    new Map(),
    new Map(),
  );
  assert.equal(result.bundles.length, 1001);
});

test("componentes ITEM e CONFIGURATION com mesmo UUID não colidem na paginação", async () => {
  tables.commercial_bundle_components[0].configuration_id = id(3);
  const rows = await loadBundleInventoryRows(globalThis.__NK72_CLIENT__);
  assert.equal(rows.components.length, 5);
});

test("ações do menu BUNDLE oferecem três writers protegidos e nenhum mínimo", async () => {
  const bundle = (await loadInventoryData()).data.bundles[0];
  globalThis.__NK72_MENU_OPEN__ = true;
  const html = renderToStaticMarkup(
    createElement(InventoryRowActions, {
      target: {
        ...bundle,
        kind: "BUNDLE",
        bundleId: bundle.id,
        commercialCodes: bundle.codes,
        commercialAliases: bundle.aliases,
      },
    }),
  );
  for (const label of ["Montar", "Desmontar", "Ajustar estoque"])
    assert.ok(html.includes(label));
  assert.ok(!html.includes("Alterar estoque mínimo"));
});

for (const [action, rpc, type, before, after] of [
  [assembleCommercialBundle, "assemble_commercial_bundle", "ASSEMBLY", 0, 2],
  [
    disassembleCommercialBundle,
    "disassemble_commercial_bundle",
    "DISASSEMBLY",
    2,
    0,
  ],
]) {
  test(`${type} chama RPC correta com idempotência e aceita receipt auditado`, async () => {
    globalThis.__NK72_RPC_RESULT__ = {
      data: {
        movement_batch_id: id(40),
        operation_type: type,
        bundle_id: bundleId,
        bundle_code: "1HC",
        quantity: 2,
        bundle_quantity_before: before,
        bundle_quantity_after: after,
        operation_applied: true,
      },
      error: null,
    };
    const input = {
      bundle_id: bundleId,
      bundle_code: "1HC",
      quantity: 2,
      idempotency_key: key,
      description: null,
    };
    const result = await action(input);
    assert.equal(result.ok, true);
    assert.equal(rpcCalls[0].name, rpc);
    assert.equal(rpcCalls[0].args.p_idempotency_key, key);
    assert.ok(globalThis.__NK72_PATHS__.includes("/estoque"));
    assert.ok(globalThis.__NK72_PATHS__.includes("/entrada"));
    assert.ok(globalThis.__NK72_PATHS__.includes("/saida"));
  });
}

test("desmontagem aceita metadata inativa e ação mantém guard de sessão", async () => {
  tables.commercial_bundle_codes[0].is_active = false;
  tables.commercial_bundles[0].is_active = false;
  globalThis.__NK72_RPC_RESULT__ = {
    data: {
      movement_batch_id: id(40),
      operation_type: "DISASSEMBLY",
      bundle_id: bundleId,
      bundle_code: "1HC",
      quantity: 1,
      bundle_quantity_before: 1,
      bundle_quantity_after: 0,
      operation_applied: true,
    },
    error: null,
  };
  const input = {
    bundle_id: bundleId,
    bundle_code: "1HC",
    quantity: 1,
    idempotency_key: key,
    description: null,
  };
  assert.equal((await disassembleCommercialBundle(input)).ok, true);
  globalThis.__NK72_ACTIVE__ = false;
  assert.equal((await disassembleCommercialBundle(input)).ok, false);
  assert.equal(rpcCalls.length, 1);
  assert.equal((await loadInventoryData()).data, null);
});

test("writers rejeitam quantidades inválidas e traduzem falhas de saldo, lifecycle e idempotência", async () => {
  const input = {
    bundle_id: bundleId,
    bundle_code: "1HC",
    quantity: 1,
    idempotency_key: key,
    description: null,
  };
  for (const quantity of [0, -1, 1.5, 2147483648]) {
    assert.equal(
      (await assembleCommercialBundle({ ...input, quantity })).ok,
      false,
    );
  }
  assert.equal(rpcCalls.length, 0);
  for (const [message, pattern] of [
    ["Insufficient free component stock", /saldo livre/],
    ["contains an inactive component", /inativo/],
    ["p_idempotency_key has already been used", /dados diferentes/],
  ]) {
    globalThis.__NK72_RPC_RESULT__ = {
      data: null,
      error: { code: "23514", message },
    };
    const result = await assembleCommercialBundle(input);
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
  }
});

test("ajuste BUNDLE usa expected quantity e não inventa movimento no no-op", async () => {
  const bundle = (await loadInventoryData()).data.bundles[0];
  globalThis.__NK72_RPC_RESULT__ = {
    data: {
      movement_batch_id: null,
      adjustment_applied: false,
      quantity_before: 1,
      quantity_change: 0,
      quantity_after: 1,
    },
    error: null,
  };
  let receipt;
  const outcome = await runStockAdjustmentSubmission({
    target: { kind: "BUNDLE", bundleId, readyQuantity: bundle.readyQuantity },
    countedQuantity: 1,
    reason: "Conferência",
    idempotencyKey: key,
    isCurrentAttempt: () => true,
    execute: adjustInventoryStock,
    clearAttempt() {},
    closeDialog() {},
    onStale() {},
    onError(error) {
      throw new Error(error);
    },
    onSuccess(result) {
      receipt = result;
    },
  });
  assert.equal(outcome, "success");
  assert.equal(receipt.adjustmentApplied, false);
  assert.deepEqual(rpcCalls[0], {
    name: "adjust_commercial_bundle_stock_checked",
    args: {
      p_bundle_id: bundleId,
      p_counted_quantity: 1,
      p_expected_quantity: 1,
      p_reason: "Conferência",
      p_idempotency_key: key,
    },
  });
  globalThis.__NK72_RPC_RESULT__ = {
    data: null,
    error: {
      code: "40001",
      message: "bundle_stock_adjustment_quantity_conflict",
    },
  };
  const result = await adjustInventoryStock({
    target_kind: "BUNDLE",
    target_id: bundleId,
    counted_quantity: 2,
    expected_quantity: 1,
    reason: "Conferência",
    idempotency_key: key,
  });
  assert.equal(result.stale, true);
});

test("busca abre simultaneamente todas as categorias com resultados e restaura manual ao limpar", () => {
  const sections = {
    separate: ["CIL", "1H físico"],
    repair: ["1H reparo", "outro"],
    commercial: ["1H Servo + Kit"],
  };
  const result = buildStockFlowSearch(
    sections,
    "1h",
    "separate",
    (option) => option,
  );
  for (const section of Object.values(result)) {
    assert.equal(section.count, 1);
    assert.equal(section.isOpen, true);
  }
  const cleared = buildStockFlowSearch(
    sections,
    "",
    "separate",
    (option) => option,
  );
  assert.equal(cleared.separate.count, 2);
  assert.equal(cleared.separate.isOpen, true);
  assert.equal(cleared.repair.isOpen, false);
  assert.equal(cleared.commercial.isOpen, false);
  assert.equal(
    buildStockFlowSearch(sections, "CIL", "commercial", (option) => option)
      .commercial.isOpen,
    false,
  );
});

for (const [label, loader, Component, file] of [
  [
    "Entrada",
    getInboundCatalog,
    InboundEntryFlow,
    "entrada/inbound-entry-flow.tsx",
  ],
  [
    "Saída",
    getOutboundCatalog,
    OutboundEntryFlow,
    "saida/outbound-entry-flow.tsx",
  ],
]) {
  test(`${label} renderiza categoria encontrada fechada manualmente e nunca oferece BUNDLE_CODE`, async () => {
    const result = await loader();
    const catalog = result.catalog ?? result.data;
    assert.ok(catalog);
    assert.ok(
      !catalog.commercialCodes.some(
        (code) => code.code === "1HC" || code.commercialCode === "1HC",
      ),
    );
    globalThis.__NK72_SEARCH__ = "1H";
    const html = renderToStaticMarkup(createElement(Component, { catalog }));
    const prefix = label === "Entrada" ? "inbound" : "outbound";
    assert.match(
      html,
      new RegExp(`id="${prefix}-commercial-section"[^>]*aria-expanded="true"`),
    );
    assert.ok(html.includes("1H"));
    assert.ok(!html.includes("1HC"));
    const source = readFileSync(
      new URL(`../app/(authenticated)/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /count=\{catalogSections\.commercial\.count\}/);
    assert.ok(!source.includes("BUNDLE_CODE"));
    globalThis.__NK72_SEARCH__ = "Componente";
    const allCategories = renderToStaticMarkup(
      createElement(Component, { catalog }),
    );
    for (const section of ["separate", "repair", "commercial"]) {
      assert.match(
        allCategories,
        new RegExp(
          `id="${prefix}-${section}-section"[^>]*aria-expanded="true"`,
        ),
      );
    }
    globalThis.__NK72_SEARCH__ = "";
    const cleared = renderToStaticMarkup(createElement(Component, { catalog }));
    assert.match(
      cleared,
      new RegExp(`id="${prefix}-commercial-section"[^>]*aria-expanded="false"`),
    );
  });
}
