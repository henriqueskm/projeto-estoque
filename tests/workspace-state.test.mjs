import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createWorkspaceStore, inventoryWorkspaceDefaults, orderWorkspaceDefaults, stockFlowWorkspaceDefaults, parseWorkspaceSnapshot, normalizeWorkspaceData, parseStockDraftLine, workspaceDebounceMs, maximumWorkspaceBytes } from "../lib/workspace-state.ts";
import { safeWorkspaceHref } from "../lib/workspace-href.ts";
import { parseHistoryFilters, createHistoryHref } from "../lib/history-query.ts";
import { parseStatisticsPeriod } from "../lib/statistics-types.ts";
import { reconcileStockFlowLines, serializeStockFlowLines } from "../lib/workspace-stock-draft.ts";
import { buildOutboundPreview } from "../lib/outbound-preview.ts";
import { buildInboundPreview } from "../lib/inbound-preview.ts";
import { WorkspaceStateProvider } from "../components/workspace-state-provider.tsx";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function storage() {
  const values = new Map(); const writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); writes.push(key); }, removeItem: key => values.delete(key) };
}
function storeFor(user = id(100), medium = storage()) {
  const store = createWorkspaceStore(user, safeWorkspaceHref); store.hydrate(medium); return { store, medium };
}
function catalog(balance = 5) {
  return {
    physicalItems: [{ kind: "ITEM", id: id(1), code: "1", description: "SERVO MBF-015", itemType: "SERVO", model: "MBF-015", balance }, { kind: "ITEM", id: id(2), code: "CIL", description: "Cilindro Primário", itemType: "LOOSE_PART", model: null, balance }],
    commercialCodes: [{ kind: "COMMERCIAL_CODE", commercialCodeId: id(3), configurationId: id(4), code: "1H", description: "Servo com kit", hasImage: false, assembledBalance: balance, aliases: ["1H"], servo: { id: id(1), code: "1", description: "Servo", model: "MBF-015", balance: 0 }, installationKit: { id: id(5), code: "KT-29", description: "Kit", balance: 0 } }],
    bundleCodes: [{ kind: "BUNDLE_CODE", bundleCodeId: id(6), bundleId: id(7), code: "1HC", description: "Conjunto", readyBalance: balance, aliases: ["1HC"] }],
  };
}
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("serialize/deserialize restores inventory UI, arrays and scroll after store remount", () => {
  const { store, medium } = storeFor();
  const state = { ...inventoryWorkspaceDefaults, query: "MBF015", statusFilter: "low", sort: "quantity", areFiltersOpen: true, openPhysicalGroups: ["SERVO"], openFamilies: ["MBF-015"] };
  store.set("estoque", state); store.scroll("estoque", 812, state); store.flush();
  const restored = storeFor(id(100), medium).store;
  assert.deepEqual(restored.read("estoque"), { data: state, scrollTop: 812 });
  assert.deepEqual([...new Set(restored.read("estoque").data.openPhysicalGroups)], ["SERVO"]);
});
for (const [label, raw] of [["invalid JSON", "{"], ["old version", '{"version":0,"workspaces":{},"hrefs":{}}'], ["missing version", '{"workspaces":{},"hrefs":{}}'], ["incomplete envelope", '{"version":1}'], ["array", "[]"], ["null", "null"]]) {
  test(`storage ignores ${label}`, () => assert.equal(parseWorkspaceSnapshot(raw, safeWorkspaceHref), null));
}
test("incomplete workspace, unknown key and invalid scroll are dropped independently", () => {
  const raw = JSON.stringify({ version: 1, workspaces: { estoque: { data: { query: "MBF015" }, scrollTop: 1 }, unknown: { data: {}, scrollTop: 0 }, historico: { data: {}, scrollTop: -1 }, estatisticas: { data: {}, scrollTop: 20 } }, hrefs: {} });
  assert.deepEqual(Object.keys(parseWorkspaceSnapshot(raw, safeWorkspaceHref).workspaces), ["estatisticas"]);
});
test("oversized JSON is ignored", () => assert.equal(parseWorkspaceSnapshot(" ".repeat(maximumWorkspaceBytes + 1), safeWorkspaceHref), null));
test("storage denied or quota full does not break memory state", () => {
  const denied = { getItem() { throw Error("denied"); }, setItem() { throw Error("full"); }, removeItem() { throw Error("denied"); } };
  const { store } = storeFor(id(100), denied);
  store.set("estoque", { ...inventoryWorkspaceDefaults, query: "MBF015" });
  assert.doesNotThrow(() => store.flush()); assert.equal(store.read("estoque").data.query, "MBF015");
  assert.doesNotThrow(() => store.logout()); assert.equal(store.read("estoque"), undefined);
});
test("missing storage stays usable", () => {
  const store = createWorkspaceStore(id(100), safeWorkspaceHref); store.hydrate(null);
  store.set("historico", {}); store.flush(); assert.equal(store.isHydrated(), true);
});
test("memory updates immediately, storage debounces typing to one write", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, medium } = storeFor();
  store.set("estoque", { ...inventoryWorkspaceDefaults, query: "M" });
  t.mock.timers.tick(200); store.set("estoque", { ...inventoryWorkspaceDefaults, query: "MBF015" });
  assert.equal(store.read("estoque").data.query, "MBF015"); assert.equal(medium.writes.length, 0);
  t.mock.timers.tick(workspaceDebounceMs - 1); assert.equal(medium.writes.length, 0);
  t.mock.timers.tick(1); assert.equal(medium.writes.length, 1);
});
test("flush writes immediately before navigation/pagehide", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const { store, medium } = storeFor();
  store.set("estoque", inventoryWorkspaceDefaults); store.flush();
  assert.equal(medium.writes.length, 1); t.mock.timers.tick(1000); assert.equal(medium.writes.length, 1);
});
test("different users and workspaces never share state", () => {
  const medium = storage(); const a = storeFor(id(100), medium).store;
  a.set("estoque", { ...inventoryWorkspaceDefaults, query: "A" }); a.set("entrada", { ...stockFlowWorkspaceDefaults, search: "CIL" }); a.flush();
  const b = storeFor(id(101), medium).store;
  assert.notEqual(a.storageKey, b.storageKey); assert.equal(b.read("estoque"), undefined);
  assert.equal(a.read("estoque").data.query, "A"); assert.equal(a.read("entrada").data.search, "CIL");
});
test("logout clears all user state and suppresses timers/late updates", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const { store, medium } = storeFor();
  for (const key of ["entrada", "saida"]) store.set(key, { ...stockFlowWorkspaceDefaults, lines: [{ kind: "ITEM", itemId: id(1), quantity: "2" }] });
  store.set("estoque", inventoryWorkspaceDefaults); store.set("pedidos:active", orderWorkspaceDefaults); store.flush(); store.logout();
  store.set("estoque", inventoryWorkspaceDefaults); store.scroll("estoque", 300, inventoryWorkspaceDefaults); store.remember("/pedidos", "/pedidos?view=history"); t.mock.timers.tick(1000);
  assert.equal(medium.values.has(store.storageKey), false); assert.equal(store.read("estoque"), undefined); assert.equal(store.href("/pedidos"), undefined);
});
test("successful clear cannot be resurrected by old scroll cleanup", () => {
  const { store, medium } = storeFor(); store.set("entrada", stockFlowWorkspaceDefaults); store.clear("entrada"); store.scroll("entrada", 200, stockFlowWorkspaceDefaults); store.flush();
  assert.equal(store.read("entrada"), undefined); assert.equal(JSON.parse(medium.getItem(store.storageKey)).workspaces.entrada, undefined);
  store.set("entrada", stockFlowWorkspaceDefaults); assert.equal(store.read("entrada").data.lines.length, 0);
});
for (const mode of ["entrada", "saida"]) {
  test(`${mode}: DTO contains identities/quantities only, restores fresh catalog and review`, () => {
    const old = catalog(5), current = catalog(1); current.commercialCodes[0].description = "Descrição oficial atual";
    const dtos = serializeStockFlowLines([{ option: old.physicalItems[0], quantity: "2" }, { option: old.commercialCodes[0], quantity: "3" }, { option: old.bundleCodes[0], quantity: "1" }]);
    const { store, medium } = storeFor(); const draft = { ...stockFlowWorkspaceDefaults, step: "review", search: "MBF015", lines: dtos, description: "Observação", idempotencyKey: id(20) };
    store.set(mode, draft); store.scroll(mode, 531, draft); store.flush();
    const restored = storeFor(id(100), medium).store.read(mode);
    assert.deepEqual(restored.data, draft); assert.equal(restored.scrollTop, 531);
    const reconciled = reconcileStockFlowLines(restored.data.lines, current, mode);
    assert.equal(reconciled.changed, false); assert.equal(reconciled.lines[1].option.assembledBalance, 1);
    assert.equal(reconciled.lines[1].option.description, "Descrição oficial atual"); assert.equal(restored.data.idempotencyKey, id(20));
    assert.doesNotMatch(JSON.stringify(dtos), /balance|description|assembled|ready|capacity|aliases/i);
    if (mode === "saida") { const preview = buildOutboundPreview(reconciled.lines.map(x => ({ ...x, quantity: Number(x.quantity) }))); assert.equal(preview.isValid, false); assert.equal(preview.commercialLines[0].option.assembledBalance, 1); }
    else { const preview = buildInboundPreview(reconciled.lines.map(x => ({ ...x, quantity: Number(x.quantity) }))); assert.equal(preview.commercialLines[0].option.assembledBalance, 1); }
  });
  test(`${mode}: removed/inactive identity is removed, not replaced by another code`, () => {
    const current = catalog(); current.commercialCodes = [];
    const lines = [{ kind: "ITEM", itemId: id(1), quantity: "2" }, { kind: "COMMERCIAL_CODE", commercialCodeId: id(3), quantity: "3" }];
    const result = reconcileStockFlowLines(lines, current, mode);
    assert.equal(result.changed, true); assert.equal(result.lines.length, 1); assert.equal(result.lines[0].option.id, id(1));
  });
}
test("bundle draft uses fresh ready balance, never component capacity", () => {
  const current = catalog(1); const restored = reconcileStockFlowLines([{ kind: "BUNDLE_CODE", bundleCodeId: id(6), quantity: "3" }], current, "saida");
  const preview = buildOutboundPreview(restored.lines.map(x => ({ ...x, quantity: 3 })));
  assert.equal(preview.isValid, false); assert.equal(preview.bundleLines[0].currentBalance, 1);
});
test("duplicate saved identities are reconciled without duplicate lines", () => {
  const line = { kind: "ITEM", itemId: id(1), quantity: "3" };
  const result = reconcileStockFlowLines([line, line], catalog(), "saida"); assert.equal(result.changed, true); assert.equal(result.lines.length, 1);
});
test("new loose part draft keeps user input, rejects official namespace collisions", () => {
  const valid = { kind: "NEW_LOOSE_PART", code: "NEW-1", description: "Peça nova", quantity: "2" };
  assert.deepEqual(serializeStockFlowLines(reconcileStockFlowLines([valid], catalog(), "entrada").lines), [valid]);
  assert.equal(reconcileStockFlowLines([{ ...valid, code: "1HC" }], catalog(), "entrada").lines.length, 0);
  assert.equal(reconcileStockFlowLines([valid], catalog(), "saida").lines.length, 0);
});
test("minimal line decoder rejects bad identities, receipts and success state", () => {
  assert.equal(parseStockDraftLine({ kind: "ITEM", itemId: "invented", quantity: "1" }, true), null);
  assert.equal(parseStockDraftLine({ kind: "NEW_LOOSE_PART", code: "X", description: "X", quantity: "1" }, false), null);
  assert.equal(normalizeWorkspaceData("entrada", { ...stockFlowWorkspaceDefaults, step: "success" }), null);
});
test("interrupted new-loose-part response preserves original payload/key while using fresh balance", () => {
  const current = catalog();
  const line = { kind: "NEW_LOOSE_PART", code: "cil", description: "Cilindro Primário", quantity: "2" };
  const { store, medium } = storeFor();
  store.set("entrada", { ...stockFlowWorkspaceDefaults, lines: [line], step: "review", idempotencyKey: id(20) }); store.flush();
  const restored = storeFor(id(100), medium).store.read("entrada").data;
  const result = reconcileStockFlowLines(restored.lines, current, "entrada");
  assert.equal(result.changed, false); assert.equal(result.lines[0].option.balance, 5);
  assert.deepEqual(serializeStockFlowLines(result.lines), [line]); assert.equal(restored.idempotencyKey, id(20));
  assert.equal(reconcileStockFlowLines([{ ...line, description: "Outro cadastro" }], current, "entrada").changed, true);
});
test("explicit status=all gets a separate mount from resumable inventory state", () => {
  assert.match(read("app/(authenticated)/estoque/page.tsx"), /resolvedSearchParams.status !== undefined \? "explicit" : "resume"/);
  assert.match(read("components/workspace-state-provider.tsx"), /if \(hydrated\) store\?\.remember/);
});
test("schema strips secrets, stale balances, receipt and mutation dialog flags", () => {
  const data = normalizeWorkspaceData("entrada", { ...stockFlowWorkspaceDefaults, access_token: "forbidden", receipt: {}, isPending: true, balance: 5, lines: [{ kind: "ITEM", itemId: id(1), quantity: "1", balance: 55, option: {} }] });
  assert.deepEqual(data.lines, [{ kind: "ITEM", itemId: id(1), quantity: "1" }]); assert.equal(data.access_token, undefined); assert.equal(data.receipt, undefined);
  const order = normalizeWorkspaceData("pedidos:active", { ...orderWorkspaceDefaults, editingOrderId: id(1), creatingOrder: true, confirmationKind: "FINALIZE", stockEntryOpen: true, feedback: "old" });
  assert.deepEqual(order, orderWorkspaceDefaults);
});
test("Pedidos active/history keep independent filters and selected detail IDs", () => {
  const { store, medium } = storeFor();
  const active = { ...orderWorkspaceDefaults, search: "12345", statusFilter: "PARTIAL", periodFilter: "30", sort: "OLDEST", filtersOpen: true, selectedOrderId: id(22) };
  const history = { ...orderWorkspaceDefaults, search: "98765", closureFilter: "FINALIZED", periodFilter: "7", sort: "CLOSED_OLDEST", selectedOrderId: id(23) };
  store.set("pedidos:active", active); store.set("pedidos:history", history); store.flush();
  const restored = storeFor(id(100), medium).store;
  assert.deepEqual(restored.read("pedidos:active").data, active); assert.deepEqual(restored.read("pedidos:history").data, history);
});
test("Aplicações keeps brand-specific query/category/scroll", () => {
  const { store, medium } = storeFor(); store.set("aplicacoes:mercedes-benz", { query: "atego", category: "TRUCK" }); store.scroll("aplicacoes:mercedes-benz", 350, {});
  store.set("aplicacoes:volvo", { query: "fh", category: "BUS" }); store.flush();
  const restored = storeFor(id(100), medium).store;
  assert.deepEqual(restored.read("aplicacoes:mercedes-benz"), { data: { query: "atego", category: "TRUCK" }, scrollTop: 350 }); assert.equal(restored.read("aplicacoes:volvo").data.query, "fh");
});
for (const [section, href, expected] of [
  ["/pedidos", `/pedidos?view=history&order=${id(1)}&evil=1`, "/pedidos?view=history"],
  ["/pedidos", "/pedidos?view=active", "/pedidos?view=active"],
  ["/estatisticas", "/estatisticas?periodo=30&evil=1", "/estatisticas?periodo=30"],
  ["/estatisticas", "/estatisticas?periodo=90", "/estatisticas?periodo=90"],
  ["/estatisticas", "/estatisticas?periodo=999", "/estatisticas?periodo=90"],
  ["/historico", "/historico?tipo=OUTBOUND&origem=MANUAL&dataInicial=2026-09-01&dataFinal=2026-09-30&usuario=Nome&busca=Venda&pagina=3&evil=1", "/historico?tipo=OUTBOUND&origem=MANUAL&dataInicial=2026-09-01&dataFinal=2026-09-30&usuario=Nome&busca=Venda&pagina=3"],
  ["/aplicacoes", "/aplicacoes/mercedes-benz", "/aplicacoes/mercedes-benz"],
  ["/estoque", "/estoque?status=low", "/estoque"],
  ["/entrada", "/entrada", "/entrada"], ["/saida", "/saida", "/saida"], ["/", "/", "/"],
]) test(`resume ${href} uses safe href ${expected}`, () => assert.equal(safeWorkspaceHref(section, href), expected));
for (const href of ["https://evil.invalid/historico", "//evil.invalid", "javascript:alert(1)", "/pedidos", "/historico/../entrada", "/historico#arbitrary", "/\\evil.invalid", "/historico/detail"]) {
  test(`resume rejects unsafe/wrong-section ${href}`, () => assert.equal(safeWorkspaceHref("/historico", href), null));
}
test("unvisited/unknown application slug is rejected", () => assert.equal(safeWorkspaceHref("/aplicacoes", "/aplicacoes/evil"), null));
test("official parsers preserve defaults, calendar validation, bounds and first duplicate param", () => {
  assert.equal(parseStatisticsPeriod({ periodo: ["7", "30"] }), 7);
  const parsed = parseHistoryFilters({ tipo: "invalid", dataInicial: "2026-02-30", pagina: "999999999", busca: " texto " });
  assert.equal(parsed.type, "ALL"); assert.equal(parsed.dateFrom, ""); assert.equal(parsed.page, 1000000); assert.equal(parsed.query, "texto");
  assert.equal(safeWorkspaceHref("/historico", "/historico?tipo=OUTBOUND&tipo=INBOUND"), "/historico?tipo=OUTBOUND");
  assert.equal(createHistoryHref(parseHistoryFilters({ tipo: "OUTBOUND", pagina: "3" })), "/historico?tipo=OUTBOUND&pagina=3");
});
test("remembered hrefs survive store remount and remain section scoped", () => {
  const { store, medium } = storeFor(); store.remember("/pedidos", "/pedidos?view=history"); store.remember("/estatisticas", "/estatisticas?periodo=30"); store.remember("/aplicacoes", "/aplicacoes/volvo"); store.flush();
  const restored = storeFor(id(100), medium).store;
  assert.equal(restored.href("/pedidos"), "/pedidos?view=history"); assert.equal(restored.href("/estatisticas"), "/estatisticas?periodo=30"); assert.equal(restored.href("/aplicacoes"), "/aplicacoes/volvo");
});
test("SSR provider renders children without touching browser storage", () => {
  assert.match(renderToStaticMarkup(createElement(WorkspaceStateProvider, { userId: id(100) }, createElement("main", null, "UI"))), /<main>UI<\/main>/);
});
test("provider is user-keyed; Assistant persistence is not duplicated; logout signal is reused", () => {
  const layout = read("app/(authenticated)/layout.tsx"), provider = read("components/workspace-state-provider.tsx");
  assert.match(layout, /WorkspaceStateProvider key=\{profile.id\} userId=\{profile.id\}/);
  assert.match(layout, /AssistantConversationProvider/); assert.match(provider, /data-assistant-session-logout/);
  assert.doesNotMatch(provider, /localStorage|createClient|fetch\(|conversationId|messages|receipt/);
  assert.match(provider, /pagehide/); assert.match(provider, /nk:workspace:before-navigation/);
});
test("stock flows persist key before awaiting writer and clear only on success/new operation", () => {
  for (const [path, writer, reset] of [["entrada/inbound-entry-flow.tsx", "submitStockInbound", "startNewEntry"], ["saida/outbound-entry-flow.tsx", "submitStockOutbound", "startNewOutbound"]]) {
    const flow = read(`app/(authenticated)/${path}`);
    assert.match(flow, /workspace\.state\.idempotencyKey \?\?/); assert.match(flow, /workspace\.setField\("idempotencyKey", key\);\s*workspace\.persistNow\(\)/);
    assert.match(flow, new RegExp(`if \\(!result.ok\\) \\{[\\s\\S]*?return;[\\s\\S]*?workspace.clear\\(\\)`));
    assert.match(flow, new RegExp(`function ${reset}\\(\\) \\{\\s*workspace.clear\\(\\)`));
    assert.match(flow, new RegExp(`await ${writer}\\(`)); assert.doesNotMatch(flow, /useState<DraftLine/);
    assert.match(flow, /function markPayloadChanged\(\) \{\s*rotateIdempotencyKey\(\)/);
  }
  const hook = read("components/use-stock-flow-workspace.ts");
  assert.match(hook, /reconciled.changed/); assert.match(hook, /step: "editing", idempotencyKey: crypto.randomUUID\(\)/);
});
test("scroll restoration is bounded/cancellable and deep links/cards have priority", () => {
  const provider = read("components/workspace-state-provider.tsx"), inventory = read("app/(authenticated)/estoque/inventory-workspace.tsx");
  assert.match(provider, /attempts >= 60/); assert.match(provider, /max >= saved/); assert.match(provider, /cancelAnimationFrame/);
  assert.match(inventory, /!initialTarget && !isPurchaseRecommendationsInitiallyOpen/); assert.match(inventory, /cancelScrollRestore\(\);\s*setScrollRequest/);
  assert.match(inventory, /hasExplicitStatusFilter \? \{ statusFilter: initialStatusFilter/);
});
test("native sidebar prefetch preserves resolved workspace hrefs", () => {
  const sidebar = read("components/app-sidebar.tsx");
  assert.match(sidebar, /const resumeHref = useWorkspaceResumeHref\(href\)/);
  assert.match(sidebar, /href=\{resumeHref\}/);
  assert.doesNotMatch(sidebar, /prefetch=|router\.prefetch|prefetchedRoutesRef|scheduleNext|onIntent/);
});
test("scroll cancellation does not leak into a retained route's next activation", () => {
  assert.match(read("components/workspace-state-provider.tsx"), /removeEventListener\("pagehide", navigate\);[\s\S]*?cancelled.current = false/);
});
test("inventory preserves the existing with-minimum filter too", () => {
  const { store, medium } = storeFor();
  store.set("estoque", { ...inventoryWorkspaceDefaults, statusFilter: "with-minimum" }); store.flush();
  assert.equal(storeFor(id(100), medium).store.read("estoque").data.statusFilter, "with-minimum");
});
test("route reset cannot overwrite scroll captured before navigation", () => {
  const source = read("components/workspace-state-provider.tsx");
  assert.match(source, /!restoring && !departing/);
  assert.match(source, /cancel\(\); save\(\); departing = true; store.flush\(\)/);
  assert.match(source, /link.origin === window.location.origin/);
  assert.match(source, /addEventListener\("popstate", navigate\)/);
});
