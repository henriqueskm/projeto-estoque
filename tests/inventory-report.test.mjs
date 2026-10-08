import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildInventoryReport, compareReportCodes, createInventoryReportCsv, inventoryReportCategories, inventoryReportFileDate, isInventoryReportOrder, moveReportCategory, orderedReportGroups } from "../lib/inventory-report.ts";
import { loadInventoryReportSettings } from "../lib/inventory-report-data.ts";
import { saveInventoryReportOrder } from "../app/(authenticated)/relatorio-estoque/actions.ts";
import { InventoryReportWorkspace } from "../app/(authenticated)/relatorio-estoque/report-workspace.tsx";
import { normalizeWorkspaceData } from "../lib/workspace-state.ts";
import { safeWorkspaceHref } from "../lib/workspace-href.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const order = [...inventoryReportCategories];
const item = (id, code, itemType, looseQuantity, mountedQuantity = 0, embeddedQuantity = 0) => ({ id, code, itemType, looseQuantity, mountedQuantity, embeddedQuantity, totalQuantity: looseQuantity + mountedQuantity + embeddedQuantity });
const aliases = codes => codes.map((code, i) => ({ id: String(i), code, isActive: true }));
function fixture() { return {
  physicalItems: [item("servo", "MBF-015", "SERVO", 2, 3, 1), item("kit", "KT-18", "INSTALLATION_KIT", 1, 3, 1), item("repair", "RP-01", "REPAIR_KIT", 4), item("loose", "CIL", "LOOSE_PART", 2, 0, 3)],
  configurations: [{ id: "config", codes: ["1D", "1B"], aliases: aliases(["1D", "1B"]), assembledQuantity: 3, embeddedInBundlesQuantity: 1, totalPhysicalQuantity: 4 }],
  bundles: [{ id: "bundle", codes: ["1HC"], aliases: aliases(["1HC"]), readyQuantity: 1, maximumAssemblable: 5 }],
}; }
const settings = { categoryOrder: order, available: true, notice: null };
let writes;
beforeEach(() => {
  writes = [];
  globalThis.__NK86_ACTIVE__ = true;
  globalThis.__NK72_PATHS__ = [];
  globalThis.__NK72_CLIENT__ = { from(table) {
    assert.equal(table, "inventory_report_settings");
    return { update(payload) { writes.push(payload); return this; }, eq(column, value) { assert.equal(column, "singleton"); assert.equal(value, true); return this; }, select(columns) { assert.equal(columns, "category_order"); return this; },
      async maybeSingle() { return globalThis.__NK86_RESULT__ ?? { data: { category_order: order }, error: null }; },
      async single() { return globalThis.__NK86_RESULT__ ?? { data: { category_order: writes.at(-1).category_order }, error: null }; },
    };
  }};
  globalThis.__NK86_RESULT__ = null;
});

test("six categories count each inventory state once, without embedded components", () => {
  const report = buildInventoryReport(fixture());
  assert.equal(report.codeCount, 6); assert.equal(report.unitCount, 13);
  assert.deepEqual(Object.fromEntries(report.lines.map(line => [line.code, line.quantity])), { "1B": 3, "1HC": 1, CIL: 2, "KT-18": 1, "MBF-015": 2, "RP-01": 4 });
});
test("servo loose zero never reports its mounted or embedded units", () => {
  const data = fixture(); data.physicalItems[0] = item("servo", "MBF-015", "SERVO", 0, 3, 1);
  assert.ok(!buildInventoryReport(data).lines.some(line => line.code === "MBF-015"));
});
test("configuration uses only assembled, not embedded or potential assembly", () => {
  const data = fixture(); data.configurations[0].assembledQuantity = 0;
  assert.ok(!buildInventoryReport(data).lines.some(line => line.category === "SERVO_WITH_KIT"));
});
test("bundle capacity never inflates ready stock", () => {
  const data = fixture(); data.bundles[0].readyQuantity = 0;
  assert.ok(!buildInventoryReport(data).lines.some(line => line.category === "BUNDLE"));
});
test("duplicate target does not double count, conflicting duplicate fails closed", () => {
  const data = fixture(); data.configurations.push({ ...data.configurations[0] });
  assert.equal(buildInventoryReport(data).unitCount, 13);
  data.configurations[1].assembledQuantity = 9;
  assert.throws(() => buildInventoryReport(data), /inconsistente/);
});
test("canonical aliases use first active natural code for both target kinds", () => {
  const data = fixture(); data.configurations[0].aliases = [{ code: "1A", isActive: false }, ...aliases(["11A", "2A", "10A"])];
  data.bundles[0].aliases = aliases(["11HC", "2HC"]);
  assert.equal(buildInventoryReport(data).lines.find(line => line.category === "SERVO_WITH_KIT").code, "2A");
  assert.equal(buildInventoryReport(data).lines.find(line => line.category === "BUNDLE").code, "2HC");
});
test("retired codes do not hide remaining physical stock", () => {
  const data = fixture(); data.configurations[0].aliases.forEach(alias => { alias.isActive = false; });
  assert.equal(buildInventoryReport(data).lines.find(line => line.category === "SERVO_WITH_KIT").code, "1B");
});
for (const codes of [["11A", "2B", "10A", "1B", "2A", "6C"], ["KT-100", "KT-18", "KT-02", "KT-50"], ["MBF-100", "MBF-025", "MBF-015"]]) {
  test(`natural sort ${codes.join(", ")}`, () => {
    const expected = codes.length === 6 ? ["1B", "2A", "2B", "6C", "10A", "11A"] : codes.length === 4 ? ["KT-02", "KT-18", "KT-50", "KT-100"] : ["MBF-015", "MBF-025", "MBF-100"];
    assert.deepEqual(codes.map(code => ({ code, identity: code })).sort(compareReportCodes).map(x => x.code), expected);
  });
}
test("natural comparator ties use original code then identity deterministically", () => {
  const values = [{ code: "1b", identity: "2" }, { code: "1B", identity: "2" }, { code: "1B", identity: "1" }];
  assert.deepEqual([...values].sort(compareReportCodes), [...values].reverse().sort(compareReportCodes));
  assert.equal(compareReportCodes({ code: "1B", identity: "1" }, { code: "1B", identity: "2" }), -1);
});
test("only positive integers accepted, empty summary is exact", () => {
  assert.deepEqual(buildInventoryReport({ physicalItems: [], configurations: [], bundles: [] }), { lines: [], codeCount: 0, unitCount: 0 });
  for (const bad of [-1, NaN, 1.5]) { const data = fixture(); data.physicalItems[0].looseQuantity = bad; assert.throws(() => buildInventoryReport(data), /inválido/); }
});
test("all six categories exactly once, reject duplicates/missing/foreign values", () => {
  assert.equal(isInventoryReportOrder(order), true);
  for (const invalid of [null, [], [...order.slice(1), order[1]], [...order.slice(1), "FOREIGN"], [...order, "BUNDLE"]]) assert.equal(isInventoryReportOrder(invalid), false);
});
test("up/down and restore default never mutate official current order", () => {
  const moved = moveReportCategory(order, 2, -1);
  assert.equal(moved[1], "INSTALLATION_KIT"); assert.equal(order[1], "SERVO_LOOSE");
  assert.deepEqual(moveReportCategory(moved, 1, 1), order);
  assert.deepEqual(moveReportCategory(order, 0, -1), order);
  assert.deepEqual([...inventoryReportCategories], order);
});
for (const query of ["MBF015", "MBF-015", "mbf 015", "MBF_015", "MBF.015"]) test(`code search ${query}`, () => {
  assert.deepEqual(orderedReportGroups(buildInventoryReport(fixture()), order, query).flatMap(group => group.lines).map(line => line.code), ["MBF-015"]);
});
test("search does not mutate full dataset or CSV; same custom group order", () => {
  const report = buildInventoryReport(fixture()), custom = [...order].reverse();
  const before = createInventoryReportCsv(report, custom);
  orderedReportGroups(report, custom, "MBF015");
  assert.equal(createInventoryReportCsv(report, custom), before);
  assert.deepEqual(orderedReportGroups(report, custom).map(group => group.category), custom);
  assert.ok(before.indexOf('"Conjuntos"') < before.indexOf('"Servos com kit"'));
});
test("CSV UTF-8 BOM, Excel pt-BR delimiters, escaped codes and formula protection", () => {
  const report = buildInventoryReport(fixture()); const csv = createInventoryReportCsv(report, order);
  assert.deepEqual([...Buffer.from(csv).subarray(0, 3)], [239, 187, 191]);
  assert.ok(csv.startsWith("\uFEFFCategoria;Código;Quantidade\r\n"));
  assert.ok(csv.includes('"Servos com kit";"1B";3\r\n'));
  const hostile = { lines: [{ identity: "ITEM:x", category: "LOOSE_PART", code: '=HYPERLINK("bad")', quantity: 1 }], codeCount: 1, unitCount: 1 };
  assert.ok(createInventoryReportCsv(hostile, order).includes('"\'=HYPERLINK(""bad"")";1'));
});
test("filename uses Brasília date, not UTC next day", () => assert.equal(inventoryReportFileDate("2026-10-09T01:00:00Z"), "2026-10-08"));
test("settings reader reads singleton and never writes", async () => { assert.deepEqual(await loadInventoryReportSettings(), settings); assert.equal(writes.length, 0); });
test("only missing migration falls back; permission/invalid/missing singleton fail closed", async () => {
  globalThis.__NK86_RESULT__ = { data: null, error: { code: "PGRST205" } };
  assert.equal((await loadInventoryReportSettings()).available, false);
  for (const response of [{ data: null, error: { code: "42501" } }, { data: { category_order: [] }, error: null }, { data: null, error: null }]) {
    globalThis.__NK86_RESULT__ = response; await assert.rejects(loadInventoryReportSettings());
  }
});
test("save validates, uses only normal table UPDATE and revalidates report", async () => {
  assert.equal((await saveInventoryReportOrder([])).success, false); assert.equal(writes.length, 0);
  const custom = [...order].reverse(); assert.equal((await saveInventoryReportOrder(custom)).success, true);
  assert.deepEqual(writes, [{ category_order: custom }]); assert.deepEqual(globalThis.__NK72_PATHS__, ["/relatorio-estoque"]);
});
test("inactive action denied and no write on zero-row RLS response", async () => {
  globalThis.__NK86_ACTIVE__ = false; await assert.rejects(saveInventoryReportOrder(order)); assert.equal(writes.length, 0);
  globalThis.__NK86_ACTIVE__ = true; globalThis.__NK86_RESULT__ = { data: null, error: null };
  assert.equal((await saveInventoryReportOrder(order)).success, false); assert.equal(globalThis.__NK72_PATHS__.length, 0);
});
test("real render contains desktop table and mobile list with code/quantity only", () => {
  const html = renderToStaticMarkup(createElement(InventoryReportWorkspace, { report: buildInventoryReport(fixture()), settings, generatedAt: "2026-10-08T12:00:00Z" }));
  assert.ok(html.includes('<table')); assert.ok(html.includes('<dl')); assert.ok(html.includes("1B"));
  assert.ok(html.includes("6</strong> códigos")); assert.ok(html.includes("13</strong> unidades físicas"));
  assert.ok(!html.includes("Valor unitário")); assert.ok(!html.includes("1D"));
});
test("route blocks operational prerender, static shell and inventory entry point", () => {
  const page = read("app/(authenticated)/relatorio-estoque/page.tsx");
  assert.ok(page.indexOf("await connection()") < page.indexOf("await loadInventoryReportData()"));
  assert.ok(read("app/(authenticated)/relatorio-estoque/loading.tsx").includes('data-nk-perf-shell="/relatorio-estoque"'));
  assert.ok(read("app/(authenticated)/estoque/inventory-workspace.tsx").includes('href="/relatorio-estoque" prefetch={false}'));
});
test("print is full dataset portal, body chrome hidden, A4 and break safety", () => {
  const source = read("app/(authenticated)/relatorio-estoque/report-workspace.tsx"), css = read("app/(authenticated)/relatorio-estoque/report.module.css");
  assert.match(source, /<ReportGroups report=\{report\} order=\{order\} print/);
  assert.match(css, /:global\(body\):has\(\.printReport:not\(\[style\*="display: none"\]\)\) > :not\(\.printReport\)/);
  assert.match(css, /size: A4/); assert.match(css, /break-after: avoid/); assert.match(css, /break-inside: avoid/);
});
test("row highlight is desktop mouse-only, covers code and quantity, and excludes print", () => {
  const css = read("app/(authenticated)/relatorio-estoque/report.module.css");
  assert.match(css, /@media screen and \(min-width: 768px\) and \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.table tbody tr:hover\s*\{ background-color: color-mix\(in srgb, var\(--brand-charcoal\) 5%, transparent\); \}\s*\}/);
  assert.equal((css.match(/tr:hover/g) ?? []).length, 1);
});

test("organization uses semantic transient/pending and Activity cleanup, no history listener", () => {
  const source = read("app/(authenticated)/relatorio-estoque/report-workspace.tsx");
  assert.match(source, /useSemanticTransient\(true, onClose, pending\)/); assert.match(source, /useRouteTransientCleanup/);
  assert.match(source, /min-h-11/); assert.match(source, /size-11/); assert.match(source, /Mover .* para cima/);
  assert.ok(!source.includes('addEventListener("popstate"')); assert.ok(!source.includes("localStorage"));
});
test("print portal is on demand and native print listeners disconnect with Activity", () => {
  const source = read("app/(authenticated)/relatorio-estoque/report-workspace.tsx");
  assert.match(source, /hydrated && printing && createPortal/);
  assert.match(source, /addEventListener\("beforeprint", prepare\)/);
  assert.match(source, /removeEventListener\("beforeprint", prepare\)/);
  assert.match(source, /removeEventListener\("afterprint", finish\)/);
  assert.match(source, /flushSync\(\(\) => setPrinting\(true\)\)/);
});
test("organization overlay belongs to route DOM so Activity hides it immediately", () => {
  const source = read("app/(authenticated)/relatorio-estoque/report-workspace.tsx");
  const dialog = source.slice(source.indexOf("export function InventoryReportOrderDialog"), source.indexOf("export function InventoryReportWorkspace"));
  assert.ok(!dialog.includes("createPortal("));
  assert.match(dialog, /return <div className=\{styles.overlay\}/);
});
test("workspace v1 preserves only query/scroll, never shared order/dataset/transaction", () => {
  assert.deepEqual(normalizeWorkspaceData("relatorio-estoque", { query: "1B", categoryOrder: order, receipt: {}, lines: [] }), { query: "1B" });
  assert.equal(safeWorkspaceHref("/relatorio-estoque", "/relatorio-estoque"), "/relatorio-estoque");
});
