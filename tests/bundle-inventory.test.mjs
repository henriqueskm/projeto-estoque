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
import { calculatePhysicalStockSummary } from "../lib/stock-calculations.ts";
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
import { submitStockOutbound, submitInventorySale } from "../app/(authenticated)/saida/actions.ts";
import { InventorySaleDialog } from "../components/inventory-sale-dialog.tsx";
import { buildInventorySaleRequest, createInventorySaleAttempt, formatInventorySaleFeedback, inventorySaleAvailable, inventorySaleCodes } from "../lib/inventory-sale.ts";
import { matchesCatalogSearch } from "../lib/catalog-search.ts";
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
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return this;
        },
        then(resolve) {
          return Promise.resolve({ data: (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null }).then(resolve);
        },
        async single() {
          const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          return { data: rows.length === 1 ? rows[0] : null, error: rows.length === 1 ? null : { message: "missing ledger" } };
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
  globalThis.__NK72_SORT__ = "code";
  globalThis.__NK72_MENU_OPEN__ = false;
});

for (const [label, loader, Component, prop] of [
  ["Estoque", loadInventoryData, InventoryWorkspace, "inventory"],
  ["Entrada", getInboundCatalog, InboundEntryFlow, "catalog"],
  ["Saída", getOutboundCatalog, OutboundEntryFlow, "catalog"],
]) {
  for (const search of ["MBF-015", "mbf-015", "MBF015", "mbf015", "MBF 015", "MBF_015", "MBF.015"]) {
    test(`${label}: ${search} encontra o modelo MBF-015 sem mudar o código exibido`, async () => {
      const loaded = await loader();
      assert.equal(loaded.error, null);
      globalThis.__NK72_SEARCH__ = search;
      const html = renderToStaticMarkup(createElement(Component, { [prop]: loaded.data ?? loaded.catalog }));
      assert.match(html, /SERVO MBF-015 Deslocado/);
      assert.doesNotMatch(html, /Nenhum item encontrado/);
      if (label === "Estoque") {
        assert.match(html, /Servo sem kit/);
        assert.match(html, /Servos disponíveis sem kit/);
      }
    });
  }
}

test("busca compartilhada preserva descrição, acentos, aliases, 1H/1HC e consulta vazia", () => {
  for (const query of ["1H", "1HC", "1D", "cilindro", "óleo", "oleo", ""]) {
    assert.equal(matchesCatalogSearch(query, ["1H", "1HC", "1B / 1D", "Cilindro de Óleo"]), true);
  }
  assert.equal(matchesCatalogSearch("...", ["1HC"]), false);
  assert.equal(matchesCatalogSearch("não existe", ["1HC"]), false);
});

function saleTarget(kind, available) {
  if (kind === "ITEM") return { kind, itemId: id(1), code: "1", description: "SERVO MBF-015", itemType: "SERVO", looseQuantity: available, mountedQuantity: 3, minimumStock: 1 };
  if (kind === "CONFIGURATION") return { kind, configurationId, commercialCodes: ["1H"], commercialAliases: [{ id: id(11), code: "1H", isActive: true }], description: "1H montado", isActive: true, assembledQuantity: available, minimumStock: 0, servo: { id: id(1), isActive: true, looseQuantity: 5 }, installationKit: { id: id(2), isActive: true, looseQuantity: 5 } };
  return { kind, bundleId, commercialCodes: ["1HC"], commercialAliases: [{ id: id(21), code: "1HC", isActive: true }], description: "Conjunto 1HC", isActive: true, readyQuantity: available, maximumAssemblable: 5, minimumStock: 0, recipe: [] };
}

for (const [kind, available] of [["ITEM", 0], ["CONFIGURATION", 2], ["BUNDLE", 1]]) {
  test(`Venda ${kind}: limite é saldo livre/pronto, nunca físico/capacidade`, () => {
    const target = saleTarget(kind, available);
    assert.equal(inventorySaleAvailable(target), available);
    assert.equal(buildInventorySaleRequest(target, inventorySaleCodes(target)[0]?.id ?? "", available + 1, "", key), null);
    if (available) assert.equal(buildInventorySaleRequest(target, inventorySaleCodes(target)[0].id, 1, "", key).p_lines[0].quantity, 1);
    const html = renderToStaticMarkup(createElement(InventorySaleDialog, { target, onClose() {}, onSuccess() {}, onStale() {} }));
    assert.match(html, new RegExp(`Disponível para venda: ${available}`));
    assert.match(html, /Registrar venda/);
    assert.match(html, /bg-red-700/);
    if (!available) assert.match(html, /disabled=""[^>]*>Confirmar venda/);
    globalThis.__NK72_MENU_OPEN__ = true;
    const menu = renderToStaticMarkup(createElement(InventoryRowActions, { target }));
    assert.match(menu, /text-red-700[^>]*>Venda/);
  });
}

test("Venda exige alias ativo real; múltiplos aliases oferecem seletor sem duplicar saldo", () => {
  const target = saleTarget("CONFIGURATION", 3);
  target.commercialAliases.push({ id: id(12), code: "1D", isActive: true }, { id: id(13), code: "antigo", isActive: false });
  const html = renderToStaticMarkup(createElement(InventorySaleDialog, { target, onClose() {}, onSuccess() {}, onStale() {} }));
  assert.match(html, /Código da venda/);
  assert.match(html, />1D<\/option>/);
  assert.doesNotMatch(html, />antigo<\/option>/);
  assert.equal(buildInventorySaleRequest(target, id(13), 1, "", key), null);
  target.commercialAliases = [];
  assert.equal(buildInventorySaleRequest(target, id(11), 1, "", key), null);
  target.commercialAliases = [{ code: "1H", isActive: true }];
  assert.deepEqual(inventorySaleCodes(target), []);
});

test("loaders carregam os IDs reais dos aliases usados na Venda", async () => {
  const { data } = await loadInventoryData();
  assert.equal(data.configurations[0].aliases[0].id, id(11));
  assert.equal(data.bundles[0].aliases[0].id, id(21));
});

for (const [kind, table] of [["ITEM", "stock_movements"], ["CONFIGURATION", "configuration_stock_movements"], ["BUNDLE", "bundle_stock_movements"]]) {
  test(`Venda ${kind}: OUTBOUND canônico sem autoassembly, comprovante real 3→2 e invalidação`, async () => {
    const target = saleTarget(kind, 3);
    const request = buildInventorySaleRequest(target, inventorySaleCodes(target)[0]?.id ?? "", 1, "Venda manual", key);
    tables[table] = [{ batch_id: id(70), quantity_before: 3, quantity_change: -1, quantity_after: 2 }];
    globalThis.__NK72_RPC_RESULT__ = { data: { movement_batch_id: id(70), lines_processed: 1, total_quantity: 1, auto_assembled_quantity: 0 }, error: null };
    const result = await submitInventorySale(request);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.quantityBefore, 3);
    assert.equal(result.receipt.quantityAfter, 2);
    assert.equal(rpcCalls[0].name, "stock_outbound_items");
    assert.equal(rpcCalls[0].args.p_allow_auto_assembly, false);
    assert.equal(rpcCalls[0].args.p_idempotency_key, key);
    assert.deepEqual(rpcCalls[0].args.p_lines, request.p_lines);
    assert.match(formatInventorySaleFeedback(target, kind === "ITEM" ? "1" : target.commercialCodes[0], result.receipt), /Venda confirmada.*3 → 2/);
    for (const path of ["/", "/estoque", "/saida"]) assert.ok(globalThis.__NK72_PATHS__.includes(path));
  });
}

test("Saída normal conserva política padrão; cliente não pode injetar autoassembly na Venda", async () => {
  globalThis.__NK72_RPC_RESULT__ = { data: { movement_batch_id: id(70), lines_processed: 1, total_quantity: 1, auto_assembled_quantity: 0 }, error: null };
  const request = buildInventorySaleRequest(saleTarget("BUNDLE", 3), id(21), 1, "", key);
  assert.equal((await submitStockOutbound(request)).ok, true);
  assert.equal("p_allow_auto_assembly" in rpcCalls[0].args, false);
  assert.equal((await submitInventorySale({ ...request, p_allow_auto_assembly: true })).ok, false);
  assert.equal(rpcCalls.length, 1);
});

test("Venda stale/insuficiente devolve erro para refresh e não tenta outro writer/montagem", async () => {
  globalThis.__NK72_RPC_RESULT__ = { data: null, error: { code: "23514", message: "insufficient stock" } };
  const result = await submitInventorySale(buildInventorySaleRequest(saleTarget("BUNDLE", 3), id(21), 3, "", key));
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.match(result.error, /mudou ou ficou insuficiente/);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].args.p_allow_auto_assembly, false);
});

test("Venda preserva erro canônico de mesma chave com payload diferente", async () => {
  globalThis.__NK72_RPC_RESULT__ = { data: null, error: { code: "22023", message: "idempotency_key has already been used with a different payload." } };
  const result = await submitInventorySale(buildInventorySaleRequest(saleTarget("BUNDLE", 3), id(21), 2, "", key));
  assert.equal(result.ok, false);
  assert.match(result.error, /chave|identificador|tentativa/i);
  assert.equal(rpcCalls.length, 1);
});

test("Venda replay lê o mesmo ledger imutável mesmo após o saldo atual mudar", async () => {
  globalThis.__NK72_RPC_RESULT__ = { data: { movement_batch_id: id(70), lines_processed: 1, total_quantity: 1, auto_assembled_quantity: 0 }, error: null };
  tables.bundle_stock_movements = [{ batch_id: id(70), quantity_before: 3, quantity_change: -1, quantity_after: 2 }];
  const request = buildInventorySaleRequest(saleTarget("BUNDLE", 3), id(21), 1, "", key);
  const first = await submitInventorySale(request);
  tables.bundle_stock_balances[0].quantity = 0;
  const replay = await submitInventorySale(request);
  assert.deepEqual(replay, first);
  assert.equal(replay.receipt.quantityAfter, 2);
  assert.deepEqual(rpcCalls[0], rpcCalls[1]);
});

test("Venda rejeita usuário anônimo antes do writer", async () => {
  globalThis.__NK72_ACTIVE__ = false;
  const result = await submitInventorySale(buildInventorySaleRequest(saleTarget("BUNDLE", 3), id(21), 1, "", key));
  assert.equal(result.ok, false);
  assert.equal(rpcCalls.length, 0);
});

test("Venda não inventa feedback se ledger faltar e informa retry seguro", async () => {
  globalThis.__NK72_RPC_RESULT__ = { data: { movement_batch_id: id(70), lines_processed: 1, total_quantity: 1, auto_assembled_quantity: 0 }, error: null };
  const result = await submitInventorySale(buildInventorySaleRequest(saleTarget("BUNDLE", 3), id(21), 1, "", key));
  assert.equal(result.ok, false);
  assert.match(result.error, /mesma chave evita uma segunda baixa/);
});

test("tentativa de Venda bloqueia double-click e preserva payload/chave após erro de transporte", async () => {
  const attempt = createInventorySaleAttempt();
  const request = buildInventorySaleRequest(saleTarget("BUNDLE", 3), id(21), 1, "", key);
  let release;
  const inputs = [];
  const writer = async (input) => { inputs.push(input); await new Promise((resolve) => { release = resolve; }); throw new Error("network"); };
  const first = attempt.submit(request, writer);
  assert.equal(await attempt.submit(request, writer), null);
  release();
  await assert.rejects(first, /network/);
  const changed = { ...request, p_idempotency_key: id(88), p_lines: [{ kind: "BUNDLE_CODE", bundle_code_id: id(21), quantity: 2 }] };
  await attempt.submit(changed, async (input) => { inputs.push(input); return { ok: false, error: "retry" }; });
  assert.deepEqual(inputs, [request, request]);
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
  assert.equal(after.summary.loosePartTotal, before.summary.loosePartTotal - 4);
});

function physicalRow(data, n, filter = "all") {
  const html = renderToStaticMarkup(createElement(InventoryWorkspace, {
    inventory: data,
    initialStatusFilter: filter,
    initialTarget: { kind: "item", id: id(n) },
  }));
  return html.match(new RegExp(`<tr[^>]*id="inventory-item-${id(n)}"[\\s\\S]*?</tr>`))?.[0] ?? "";
}

function assertMainQuantity(row, quantity) {
  // First Quantity span is the operational balance; second is the minimum.
  assert.match(row, new RegExp(`class="[^"]*font-extrabold tabular-nums text-text-primary[^"]*">${quantity}</span>`));
  assert.equal(row.match(/class="[^"]*font-extrabold tabular-nums text-text-primary[^"]*">(\d+)<\/span>/)?.[1], String(quantity));
}

test("servo avulso 0 livre e 3 montados mostra 0 e é zerado, preservando total físico", async () => {
  tables.bundle_stock_balances = [];
  tables.stock_balances[0].quantity = 0;
  tables.items[0].minimum_stock = 1;
  const { data } = await loadInventoryData();
  const servo = data.physicalItems.find(item => item.id === id(1));
  assert.deepEqual([servo.looseQuantity, servo.mountedQuantity, servo.embeddedQuantity, servo.totalQuantity, servo.state], [0, 3, 0, 3, "ZERO"]);
  const row = physicalRow(data, 1);
  assertMainQuantity(row, 0);
  assert.match(row, /0 sem kit · 3 com kit/);
  assert.match(row, /Zerado/);
  for (const filter of ["zero", "attention"]) assert.ok(physicalRow(data, 1, filter));
  assert.equal(physicalRow(data, 1, "with-stock"), "");
  assert.equal(data.summary.looseServoTotal, 0);
  assert.equal(data.summary.outOfStockItems, 1);
  assert.equal(data.configurations[0].assembledQuantity, 3);
});

test("kit avulso mostra 1 livre e preserva total físico 5 com 4 montados", async () => {
  tables.bundle_stock_balances = [];
  tables.configuration_stock_balances[0].quantity = 4;
  tables.stock_balances[1].quantity = 1;
  tables.items[1].minimum_stock = 1;
  const { data } = await loadInventoryData();
  const kit = data.physicalItems.find(item => item.id === id(2));
  assert.deepEqual([kit.looseQuantity, kit.mountedQuantity, kit.totalQuantity, kit.state], [1, 4, 5, "LOW"]);
  assertMainQuantity(physicalRow(data, 2), 1);
  assert.ok(physicalRow(data, 2, "low"));
  assert.ok(physicalRow(data, 2, "attention"));
  assert.equal(data.summary.looseKitTotal, 1);
  assert.equal(data.summary.lowStockItems, 1);
});

test("peça avulsa 2 livres e 3 embutidas mostra 2, total físico 5 e mínimo compara livre", async () => {
  tables.bundle_stock_balances[0].quantity = 3;
  tables.stock_balances[2].quantity = 2;
  tables.items[2].minimum_stock = 2;
  const { data } = await loadInventoryData();
  const part = data.physicalItems.find(item => item.id === id(3));
  assert.deepEqual([part.looseQuantity, part.embeddedQuantity, part.totalQuantity, part.state], [2, 3, 5, "LOW"]);
  const row = physicalRow(data, 3);
  assertMainQuantity(row, 2);
  assert.match(row, /2 livres · 3 em conjuntos · total físico 5/);
  assert.ok(physicalRow(data, 3, "low"));
  assert.equal(data.summary.loosePartTotal, 17);
  assert.equal(data.summary.lowStockItems, 1);
  assert.equal(data.bundles[0].readyQuantity, 3);
  assert.equal(data.bundles[0].maximumAssemblable, 2);
});

test("resumo de reparo conta somente livre mesmo quando usado em bundle", async () => {
  tables.commercial_bundle_components.push({bundle_id:bundleId,item_id:id(7),configuration_id:null,quantity_per_bundle:1});
  tables.bundle_stock_balances[0].quantity = 3;
  tables.stock_balances[6].quantity = 0;
  tables.items[6].minimum_stock = 1;
  const { data } = await loadInventoryData();
  const repair = data.physicalItems.find(item => item.id === id(7));
  assert.deepEqual([repair.looseQuantity, repair.embeddedQuantity, repair.totalQuantity, repair.state], [0, 3, 3, "ZERO"]);
  assertMainQuantity(physicalRow(data, 7), 0);
  assert.equal(data.summary.repairKitTotal, 0);
  assert.equal(data.summary.outOfStockItems, 1);
  assert.equal(data.bundles[0].maximumAssemblable, 0);
});

test("ordenação por quantidade e filtros usam livre, não total físico", async () => {
  tables.bundle_stock_balances[0].quantity = 100;
  tables.stock_balances[2].quantity = 0;
  tables.stock_balances[3].quantity = 4;
  tables.stock_balances[4].quantity = 2;
  tables.stock_balances[5].quantity = 5;
  tables.items[2].minimum_stock = 1;
  const { data } = await loadInventoryData();
  globalThis.__NK72_SORT__ = "quantity";
  const html = renderToStaticMarkup(createElement(InventoryWorkspace, {inventory:data,initialTarget:{kind:"item",id:id(3)}}));
  const order = [...html.matchAll(/id="inventory-item-([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(order, [id(6), id(4), id(5), id(3)]);
  assert.ok(data.physicalItems.find(item => item.id === id(3)).totalQuantity > 0);
  assert.equal(physicalRow(data, 3, "with-stock"), "");
  assert.ok(physicalRow(data, 3, "zero"));
  assert.ok(physicalRow(data, 3, "attention"));
  tables.items[2].minimum_stock = 0;
  const withoutMinimum = (await loadInventoryData()).data;
  assert.equal(physicalRow(withoutMinimum, 3, "zero"), "");
  assert.match(physicalRow(withoutMinimum, 3), /Sem saldo/);
});

test("base livre do resumo é opt-in e preserva os consumidores físicos existentes", () => {
  const items = [{ id: id(1), itemType: "SERVO", minimumStock: 1, isActive: true },
    { id: id(3), itemType: "LOOSE_PART", minimumStock: 2, isActive: true }];
  const loose = [{ itemId: id(1), quantity: 0 }, { itemId: id(3), quantity: 2 }];
  const configurations = [{ id: configurationId, servoId: id(1), installationKitId: id(2), minimumStock: 1, isActive: true }];
  const mounted = [{ configurationId, quantity: 3 }];
  const embedded = { items: new Map([[id(3), 3]]), configurations: new Map() };
  const physical = calculatePhysicalStockSummary(items, loose, configurations, mounted, embedded);
  const operational = calculatePhysicalStockSummary(items, loose, configurations, mounted, embedded, "loose");
  assert.equal(physical.loosePartTotal, 5);
  assert.equal(physical.lowStockItems, 0);
  assert.equal(physical.outOfStockItems, 0);
  assert.equal(operational.loosePartTotal, 2);
  assert.equal(operational.lowStockItems, 1);
  assert.equal(operational.outOfStockItems, 1);
  assert.equal(physical.completeBoxesTotal, operational.completeBoxesTotal);
});

test("Estoque destaca códigos neutros e valores maiores sem modificar os dados", async () => {
  const { data } = await loadInventoryData();
  const before = JSON.stringify(data);
  globalThis.__NK72_SEARCH__ = "1";
  const html = renderToStaticMarkup(createElement(InventoryWorkspace, { inventory: data }));
  assert.match(html, /class="break-all font-mono text-sm font-black text-text-primary sm:text-base">1<\/span>/);
  assert.match(html, /class="max-w-full break-all rounded-md bg-app-background[^\"]*text-sm font-black text-text-primary sm:text-base">1H<\/span>/);
  assert.match(html, /class="max-w-full break-all font-mono text-base font-black text-text-primary sm:text-lg">1HC<\/span>/);
  assert.match(html, /class="break-all font-mono text-base font-extrabold tabular-nums text-text-primary sm:text-lg">3<\/span>/);
  assert.equal((html.match(/<dd class="break-all font-mono text-lg font-black tabular-nums sm:text-xl">/g) ?? []).length, 3);
  assert.match(html, /bg-violet-100[^\"]*text-violet-900">Conjunto<\/span>/);
  assert.doesNotMatch(html, /class="[^\"]*text-violet-900[^\"]*">(?:1H|1HC)<\/span>/);
  assert.equal((html.match(/w-12 text-center sm:w-\[/g) ?? []).length, 4);
  assert.equal(JSON.stringify(data), before);
  assert.equal(rpcCalls.length, 0);
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
