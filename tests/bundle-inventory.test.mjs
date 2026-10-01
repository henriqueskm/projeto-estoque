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
import { buildInboundPreview } from "../lib/inbound-preview.ts";
import { buildOutboundPreview } from "../lib/outbound-preview.ts";
import { submitStockInbound } from "../app/(authenticated)/entrada/actions.ts";
import { submitStockOutbound } from "../app/(authenticated)/saida/actions.ts";
import { executeCatalogWrite } from "../lib/catalog-writer.ts";
import { StockFlowAddButton } from "../components/stock-flow-add-button.tsx";

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

test("prévia de Entrada recebe bundle pronto sem criar componentes", async () => {
  const { data } = await getInboundCatalog();
  const preview = buildInboundPreview([{ option: data.bundleCodes[0], quantity: 2 }]);
  assert.equal(preview.isValid, true);
  assert.equal(preview.totalQuantity, 2);
  assert.deepEqual(preview.itemLines, []);
  assert.deepEqual(preview.commercialLines, []);
  assert.deepEqual(preview.configurationImpacts, []);
  assert.equal(preview.bundleLines[0].currentBalance, 1);
  assert.equal(preview.bundleLines[0].predictedBalance, 3);
});

test("prévia de Saída nunca monta bundles nem consome componentes", async () => {
  const { data } = await getOutboundCatalog();
  const option = data.bundleCodes[0];
  const valid = buildOutboundPreview([{ option, quantity: 1 }]);
  assert.equal(valid.isValid, true);
  assert.equal(valid.bundleLines[0].predictedBalance, 0);
  assert.deepEqual(valid.physicalRequirements, []);
  assert.deepEqual(valid.commercialLines, []);
  assert.equal(valid.autoAssembledQuantity, 0);
  const insufficient = buildOutboundPreview([{ option, quantity: 2 }]);
  assert.equal(insufficient.isValid, false);
  assert.equal(insufficient.autoAssembledQuantity, 0);
  assert.deepEqual(insufficient.physicalRequirements, []);
});

test("aliases de bundle são agregados na prévia sem duplicar disponibilidade", async () => {
  const { data } = await getOutboundCatalog();
  const option = data.bundleCodes[0];
  const lines = [{option,quantity:1},{option:{...option,bundleCodeId:id(22),code:"1HC-A"},quantity:1}];
  assert.equal(buildOutboundPreview(lines).isValid, false);
  assert.equal(buildOutboundPreview(lines).bundleLines.length, 1);
  assert.equal(buildInboundPreview(lines).bundleLines[0].predictedBalance, 3);
});

test("saldo pronto é relido pela Entrada/Saída sem cache persistente", async () => {
  assert.equal((await getInboundCatalog()).data.bundleCodes[0].readyBalance, 1);
  tables.bundle_stock_balances[0].quantity = 4;
  assert.equal((await getOutboundCatalog()).data.bundleCodes[0].readyBalance, 4);
  tables.bundle_stock_balances = [];
  assert.equal((await getInboundCatalog()).data.bundleCodes[0].readyBalance, 0);
});

test("server actions enviam BUNDLE_CODE somente às RPCs canônicas de Entrada/Saída", async () => {
  for (const [action, name] of [[submitStockInbound,"stock_inbound_lines"],[submitStockOutbound,"stock_outbound_items"]]) {
    rpcCalls.length = 0;
    globalThis.__NK72_RPC_RESULT__ = {data:{movement_batch_id:id(80),lines_processed:1,total_quantity:2,commercial_quantity:0,auto_assembled_quantity:0},error:null};
    const result = await action({p_lines:[{kind:"BUNDLE_CODE",bundle_code_id:id(21),quantity:1},{kind:"BUNDLE_CODE",bundle_code_id:id(21),quantity:1}],p_idempotency_key:key,p_description:null});
    assert.equal(result.ok, true);
    assert.deepEqual(rpcCalls,[{name,args:{p_lines:[{kind:"BUNDLE_CODE",bundle_code_id:id(21),quantity:2}],p_idempotency_key:key,p_description:null}}]);
    assert.ok(globalThis.__NK72_PATHS__.includes("/estoque"));
    const bad = await action({p_lines:[{kind:"BUNDLE_CODE",bundle_code_id:id(21),item_id:id(1),quantity:1}],p_idempotency_key:key});
    assert.equal(bad.ok,false);
    globalThis.__NK72_RPC_RESULT__ = {data:null,error:{code:"23514",message:"Insufficient stock"}};
    const failed = await action({p_lines:[{kind:"BUNDLE_CODE",bundle_code_id:id(21),quantity:1}],p_idempotency_key:key});
    assert.equal(failed.ok,false);
    assert.match(failed.error, name === "stock_inbound_lines" ? /dados da entrada mudaram/i : /estoque mudou/i);
  }
});

test("preflight bloqueia criação de peça 1HC antes de qualquer RPC", async () => {
  await assert.rejects(executeCatalogWrite(globalThis.__NK72_CLIENT__, {kind:"CATALOG_ONLY_LOOSE_PART",code:"1HC",description:"Não criar"}), (error) => error.reason === "KNOWN_CODE");
  assert.deepEqual(rpcCalls,[]);
});

test("catálogo de bundles na Entrada/Saída pagina acima de 1000 e exclui metadata inativa", async () => {
  tables.commercial_bundles = Array.from({length:1001},(_,i)=>({id:id(1000+i),description:`Conjunto ${i}`,is_active:true}));
  tables.commercial_bundle_codes = tables.commercial_bundles.map((bundle,i)=>({id:id(3000+i),bundle_id:bundle.id,code:`B-${i}`,is_active:true}));
  tables.bundle_stock_balances = tables.commercial_bundles.map((bundle)=>({bundle_id:bundle.id,quantity:2}));
  for (const loader of [getInboundCatalog,getOutboundCatalog]) {
    calls.length=0;
    const {data,error} = await loader();
    assert.equal(error,null);
    assert.equal(data.bundleCodes.length,1001);
    assert.equal(data.bundleCodes.find((code)=>code.code==="B-1000").readyBalance,2);
    for (const table of ["commercial_bundles","commercial_bundle_codes","bundle_stock_balances"])
      assert.equal(calls.filter((call)=>call.table===table).length,2);
  }
  tables.commercial_bundles[0].is_active=false;
  tables.commercial_bundle_codes[1].is_active=false;
  assert.equal((await getInboundCatalog()).data.bundleCodes.length,999);
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

test("configuração livre zero continua operacionalmente zerada com total físico embutido 1", async () => {
  tables.configuration_stock_balances[0].quantity = 0;
  const { data } = await loadInventoryData();
  assert.equal(data.configurations[0].totalPhysicalQuantity, 1);
  assert.equal(data.configurations[0].assembledQuantity, 0);
  assert.equal(data.configurations[0].embeddedInBundlesQuantity, 1);
  assert.equal(data.configurations[0].state, "ZERO");
  assert.equal(data.summary.outOfStockItems, 1);
  assert.equal(data.summary.lowStockItems, 0);
  assert.equal(data.bundles[0].maximumAssemblable, 0);
  globalThis.__NK72_SEARCH__ = "1H";
  const zero = renderToStaticMarkup(createElement(InventoryWorkspace, { inventory: data, initialStatusFilter: "zero" }));
  assert.ok(zero.includes(`inventory-configuration-${configurationId}`));
  assert.match(zero, /0 livres · 1 em conjuntos · total físico 1/);
  const withStock = renderToStaticMarkup(createElement(InventoryWorkspace, { inventory: data, initialStatusFilter: "with-stock" }));
  assert.ok(!withStock.includes(`inventory-configuration-${configurationId}`));
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
    bundles: ["1HC Conjunto", "outro"],
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
  assert.equal(cleared.bundles.count, 2);
  assert.equal(cleared.bundles.isOpen, false);
  const exactBundle = buildStockFlowSearch(sections, "1HC", "repair", (option) => option);
  assert.equal(exactBundle.bundles.count, 1);
  assert.equal(exactBundle.bundles.isOpen, true);
  for (const section of ["separate", "repair", "commercial"]) {
    assert.equal(exactBundle[section].count, 0);
    assert.equal(exactBundle[section].isOpen, false);
  }
  const restoreRepair = buildStockFlowSearch(sections, "", "repair", (option) => option);
  assert.equal(restoreRepair.repair.isOpen, true);
  assert.equal(restoreRepair.bundles.isOpen, false);
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
  test(`${label} oferece 1HC como Conjunto, busca abre seção própria sem confundir configuração`, async () => {
    const result = await loader();
    const catalog = result.catalog ?? result.data;
    assert.ok(catalog);
    assert.equal(catalog.bundleCodes[0].code, "1HC");
    assert.equal(catalog.bundleCodes[0].kind, "BUNDLE_CODE");
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
    assert.ok(html.includes("1HC"));
    globalThis.__NK72_SEARCH__ = "1HC";
    const bundleHtml = renderToStaticMarkup(createElement(Component, { catalog }));
    assert.match(bundleHtml, new RegExp(`id="${prefix}-bundles-section"[^>]*aria-expanded="true"`));
    assert.match(bundleHtml, new RegExp(`id="${prefix}-commercial-section"[^>]*aria-expanded="false"`));
    assert.match(bundleHtml, /Saldo pronto/);
    assert.match(bundleHtml, /class="p-2 sm:p-3"/);
    assert.match(bundleHtml, /Adicionar conjunto 1HC/);
    const bundleButton = bundleHtml.match(
      /<button[^>]*aria-label="Adicionar conjunto 1HC"[^>]*class="([^"]+)"[^>]*>/,
    )?.[1];
    assert.ok(bundleButton);
    const source = readFileSync(
      new URL(`../app/(authenticated)/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /count=\{catalogSections\.commercial\.count\}/);
    assert.match(source, /bundle_code_id: line.option.bundleCodeId/);
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
    const addButtons = [
      ...allCategories.matchAll(
        /<button[^>]*aria-label="Adicionar (?:item|Servo com kit) [^"]+"[^>]*class="([^"]+)"[^>]*>/g,
      ),
    ];
    assert.ok(
      addButtons.length >= 3,
      "all physical/repair/commercial buttons share responsive presentation",
    );
    for (const button of addButtons) assert.equal(button[1], bundleButton);
    globalThis.__NK72_SEARCH__ = "";
    const cleared = renderToStaticMarkup(createElement(Component, { catalog }));
    assert.match(
      cleared,
      new RegExp(`id="${prefix}-commercial-section"[^>]*aria-expanded="false"`),
    );
  });
}

test("shared Add button stays readable without icons, nowrap and clean selected state", () => {
  for (const isSelected of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(StockFlowAddButton, {
        isSelected,
        onAdd() {},
        label: "Adicionar item CIL",
      }),
    );
    assert.match(html, /min-h-11/);
    assert.match(html, /whitespace-nowrap/);
    assert.match(html, /w-11/);
    assert.match(html, /-mx-2/);
    assert.match(html, /sm:mx-0/);
    assert.match(html, /sm:w-auto sm:px-3/);
    assert.match(html, /aria-hidden="true" class="text-xl leading-none sm:hidden"/);
    assert.match(html, /aria-hidden="true" class="hidden sm:inline"/);
    assert.ok(html.includes(isSelected ? "✓" : "+"));
    assert.match(html, isSelected ? /aria-label="item CIL adicionado"/ : /aria-label="Adicionar item CIL"/);
    assert.doesNotMatch(html, /<svg|font-black|sm:w-full/);
    assert.ok(html.includes(isSelected ? "Adicionado" : "Adicionar"));
    assert.equal(html.includes('disabled=""'), isSelected);
  }
});
