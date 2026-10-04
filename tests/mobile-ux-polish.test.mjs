import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { waitForDrawerExit } from "../lib/drawer-exit.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const jsx = (type, props) => ({ type, props });

// Execute the real TSX/functions using the project's existing transpile/hook
// testing approach. No test-only props or fixture routes enter production.
function compile(source, names = [], hooks = {}) {
  const output = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const compiledModule = { exports: {} };
  const requireMock = name => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "react") return {
      useEffect() {}, useRef: () => ({ current: null }), useId: () => "filter-panel",
      useState: value => [value, () => {}], ...hooks,
    };
    if (name === "next/link") return { __esModule: true, default: "a" };
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function("require", "module", "exports", output + names.map(name => `\nexports.${name} = ${name};`).join(""))(requireMock, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
function nodes(tree) {
  if (tree == null || typeof tree === "boolean") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [tree];
  if (typeof tree.type === "function") return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
const text = tree => nodes(tree).filter(node => typeof node !== "object").join("");
const elements = (tree, type) => nodes(tree).filter(node => node.type === type);

test("Stock filters retain a constant accessible name in mobile and desktop", () => {
  const source = read("app/(authenticated)/estoque/inventory-workspace.tsx");
  assert.match(source, /aria-label="Filtros do estoque"\s+aria-expanded=\{areFiltersOpen\}\s+aria-controls="inventory-filter-panel"/);
  assert.match(source, /hidden min-\[430px\]:inline">Filtros/);
});

test("actual CompactQuantityControl preserves bounds, callbacks and disabled for 1/10/999/9999", () => {
  const source = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const ast = ts.createSourceFile("orders.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "CompactQuantityControl");
  const { CompactQuantityControl } = compile(declaration.getText(ast), ["CompactQuantityControl"]);
  for (const value of [1, 10, 999, 9999]) {
    const changed = [];
    const tree = CompactQuantityControl({ label: "Quantidade", value, minimum: 1, maximum: 9999, onChange: next => changed.push(next) });
    const [minus, plus] = elements(tree, "button");
    const [input] = elements(tree, "input");
    assert.match(minus.props.className, /size-11.*sm:size-8/);
    assert.match(input.props.className, /w-16.*text-base.*sm:text-sm/);
    assert.equal(input.props.value, value);
    assert.equal(minus.props.disabled, value === 1);
    assert.equal(plus.props.disabled, value === 9999);
    plus.props.onClick(); minus.props.onClick();
    assert.deepEqual(changed, [Math.min(9999, value + 1), Math.max(1, value - 1)]);
    input.props.onChange({ target: { value: "99999" } });
    assert.equal(changed.at(-1), 9999);
    const before = changed.length;
    input.props.onChange({ target: { value: "1.5" } });
    assert.equal(changed.length, before);
    assert.ok(elements(CompactQuantityControl({ label: "Quantidade", value, minimum: 1, maximum: 9999, disabled: true, onChange() {} }), "button").every(button => button.props.disabled));
  }
});

test("History disclosure is collapsed without filters, expanded with filters, desktop form stays available", () => {
  for (const activeCount of [0, 1, 6]) {
    let open;
    const { HistoryFilterDisclosure } = compile(read("components/history-filter-disclosure.tsx"), [], {
      useState(initial) { open ??= initial; return [open, next => { open = next(open); }]; },
    });
    let tree = HistoryFilterDisclosure({ activeCount, children: "server GET form" });
    const [toggle] = elements(tree, "button");
    assert.equal(toggle.props["aria-expanded"], activeCount > 0);
    assert.match(toggle.props.className, /md:hidden/);
    assert.ok(text(tree).includes(activeCount ? `${activeCount} filtro` : "Nenhum filtro ativo"));
    const panel = elements(tree, "div")[0];
    assert.equal(panel.props.id, toggle.props["aria-controls"]);
    assert.equal(panel.props.className, activeCount ? "block" : "hidden md:block");
    toggle.props.onClick();
    tree = HistoryFilterDisclosure({ activeCount, children: "server GET form" });
    assert.equal(elements(tree, "button")[0].props["aria-expanded"], activeCount === 0);
  }
  const page = read("app/(authenticated)/historico/page.tsx");
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /key=\{createHistoryHref\(filters, 1\)\} activeCount=\{activeFilterCount\}/);
  for (const name of ["tipo", "origem", "dataInicial", "dataFinal", "usuario", "busca"]) assert.ok(page.includes(`name="${name}"`));
  assert.match(page, /action="\/historico"\s+method="get"/);
  assert.match(page, /flex-col items-start gap-3 min-\[430px\]:flex-row/);
  assert.match(page, /overflow-wrap:anywhere.*min-\[430px\]:text-3xl sm:text-4xl/);
});

for (const [flow, id] of [["entrada/inbound", "inbound"], ["saida/outbound", "outbound"]]) {
  test(`${id} cart shortcut only focuses/scrolls the existing cart; no draft/key/step mutation`, () => {
    const source = read(`app/(authenticated)/${flow}-entry-flow.tsx`);
    assert.match(source, new RegExp(`StockFlowCartShortcut count=\\{lines.length\\} headingId="${id}-cart-title"`));
    assert.match(source, new RegExp(`id="${id}-cart-title" tabIndex=\\{-1\\}`));
    const shortcutSource = read("components/stock-flow-cart-shortcut.tsx");
    assert.doesNotMatch(shortcutSource, /workspace\.|idempotency|setStep|submit|randomUUID|fetch|useEffect/);
    const { StockFlowCartShortcut } = compile(shortcutSource);
    assert.equal(StockFlowCartShortcut({ count: 0, headingId: "cart" }), null);
    assert.match(text(StockFlowCartShortcut({ count: 2, headingId: "cart" })), /Ver carrinho \(2\)/);
    assert.equal(StockFlowCartShortcut({ count: 2, headingId: "cart" }).props.type, "button");
  });
}

test("cart focus respects reduced motion and performs no automatic scroll", () => {
  const { focusStockFlowCart } = compile(read("components/stock-flow-cart-shortcut.tsx"));
  const savedWindow = globalThis.window;
  try {
    for (const reduced of [false, true]) {
      globalThis.window = { matchMedia: () => ({ matches: reduced }) };
      const calls = [];
      focusStockFlowCart({ focus: options => calls.push(["focus", options]), scrollIntoView: options => calls.push(["scroll", options]) });
      assert.deepEqual(calls, [["focus", { preventScroll: true }], ["scroll", { behavior: reduced ? "instant" : "smooth", block: "start" }]]);
    }
    focusStockFlowCart(null);
  } finally { globalThis.window = savedWindow; }
});

const recommendationItem = overrides => ({ primaryCode: "1INV", typeLabel: "Servo sem kit", description: "Descrição técnica longa, adequada para identificar a peça e sua aplicação", aliases: ["1INV-ALT", "1INV/REF"], currentStock: 0, minimumStock: 1, shortfall: 1, recommendedQuantity: 1, inventoryHref: "/estoque?item=fixture", pendingPurchaseQuantity: 1, projectedStock: 1, coverage: "SUFFICIENT", relatedOrders: [{ orderId: "fixture", codeSnapshot: "1INV", negotiationNumber: "AUDIT", orderDate: "2026-10-04", closureKind: null, status: "PENDING", pendingQuantity: 1, href: "/pedidos" }], ...overrides });
const panelFunctions = compile(read("components/purchase-recommendation-panel.tsx"), ["RecommendationIdentity", "StockMetrics", "BuyNowCard", "AlreadyOrderedCard", "MissingMinimumCard"]);

test("buy-now has dominant code, exactly three metrics in one strip and a non-button recommendation", () => {
  for (const quantity of [0, 1, 99, 9999]) {
    const item = recommendationItem({ primaryCode: "KIT-CONEXAO-MBB-ESPECIAL-2026", currentStock: quantity, recommendedQuantity: quantity });
    const tree = panelFunctions.BuyNowCard({ item });
    assert.match(elements(tree, "h3")[0].props.className, /font-mono text-xl font-black.*overflow-wrap:anywhere/);
    assert.equal(elements(tree, "dt").length, 3);
    assert.match(elements(tree, "dl")[0].props.className, /grid-cols-3/);
    assert.equal(elements(tree, "button").length, 0);
    assert.match(text(tree), new RegExp(`Comprar ${new Intl.NumberFormat("pt-BR").format(quantity)}`));
    assert.match(text(tree), /Abrir no Estoque/);
    assert.match(text(tree), /Falta para o mínimo/);
  }
});

test("already ordered keeps four separate metrics, order status/date and links; missing minimum stays simple", () => {
  const tree = panelFunctions.AlreadyOrderedCard({ item: recommendationItem({ currentStock: 0, pendingPurchaseQuantity: 99, projectedStock: 99 }) });
  assert.equal(elements(tree, "dt").length, 4);
  assert.match(elements(tree, "dl")[0].props.className, /grid-cols-2/);
  assert.match(text(tree), /Compra pendente/);
  assert.match(text(tree), /Pendente · 04\/10\/2026/);
  assert.deepEqual(elements(tree, "a").map(link => link.props.href), ["/pedidos", "/estoque?item=fixture"]);
  const missing = panelFunctions.MissingMinimumCard({ item: recommendationItem({ minimumStock: null }) });
  assert.equal(elements(missing, "dl").length, 0);
  assert.match(text(missing), /Estoque mínimo não definido/);
});

test("recommendation header drops duplicate summary, tabs keep counts and copy/close semantics", () => {
  const source = read("components/purchase-recommendation-panel.tsx");
  const { PurchaseRecommendationPanel } = panelFunctions;
  const item = recommendationItem();
  const tree = PurchaseRecommendationPanel({ data: { buyNow: [item], alreadyOrdered: [], missingMinimum: [], summary: { buyNowCount: 1, alreadyOrderedCount: 0, missingMinimumCount: 0 } }, isLoading: false, isRefreshing: false, error: null, refreshError: null, onClose() {}, onRetry() {} });
  assert.equal(elements(elements(tree, "header")[0], "strong").length, 0);
  const tabs = nodes(tree).filter(node => node.props?.role === "tab");
  assert.deepEqual(tabs.map(text), ["Comprar agora (1)", "Já comprados (0)", "Sem mínimo (0)"]);
  assert.match(source, /Cód\. \$\{item.primaryCode\} — \$\{quantity\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /Lista copiada\./);
  assert.equal(source.match(/onClick=\{onClose\}/g).length, 2);
});

function drawerFixture(reduced = false, style = {}) {
  const listeners = new Map(), preferences = new Map(), timers = new Map();
  const media = { matches: reduced, addEventListener: (name, fn) => preferences.set(name, fn), removeEventListener: name => preferences.delete(name) };
  const view = { matchMedia: () => media, getComputedStyle: () => ({ animationDuration: "0.24s", animationDelay: "0s", transitionDuration: "0s", transitionDelay: "0s", ...style }), setTimeout(fn, delay) { timers.set(1, { fn, delay }); return 1; }, clearTimeout: id => timers.delete(id) };
  const element = { ownerDocument: { defaultView: view }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  return { element, listeners, preferences, timers, media, emit(type, target = element) { listeners.get(type)?.({ type, target }); }, preferReduce() { media.matches = true; preferences.get("change")?.(); } };
}

test("reduced motion exit completes without a timer and detaches listeners", () => {
  const fixture = drawerFixture(true); let count = 0;
  waitForDrawerExit(fixture.element, () => count++);
  assert.equal(count, 1); assert.equal(fixture.timers.size, 0); assert.equal(fixture.listeners.size, 0);
});
test("normal drawer exit follows its own animationend, ignores child events and completes once", () => {
  const fixture = drawerFixture(); let count = 0;
  waitForDrawerExit(fixture.element, () => count++);
  assert.equal(count, 0);
  fixture.emit("animationend", {}); assert.equal(count, 0);
  fixture.emit("animationend"); fixture.emit("animationend");
  assert.equal(count, 1); assert.equal(fixture.timers.size, 0); assert.equal(fixture.preferences.size, 0);
});
test("drawer fallback comes from CSS timeline and cancellation prevents stale close on reopen", () => {
  const fixture = drawerFixture(false, { animationDuration: "120ms", animationDelay: "20ms" }); let count = 0;
  const cancel = waitForDrawerExit(fixture.element, () => count++);
  const fallback = [...fixture.timers.values()][0]; assert.equal(fallback.delay, 190);
  cancel(); fallback.fn(); fixture.emit("animationend"); assert.equal(count, 0);
  waitForDrawerExit(fixture.element, () => count++); fixture.preferReduce();
  assert.equal(count, 1); assert.equal(fixture.timers.size, 0);
});
test("drawer transitionend and fallback both release lifecycle if animation is absent/interrupted", () => {
  for (const event of ["transitionend", "fallback"]) {
    const fixture = drawerFixture(false, { animationDuration: "0s", transitionDuration: "0.2s" }); let count = 0;
    waitForDrawerExit(fixture.element, () => count++);
    if (event === "fallback") [...fixture.timers.values()][0].fn(); else fixture.emit(event);
    assert.equal(count, 1); assert.equal(fixture.listeners.size, 0);
  }
  const sidebar = read("components/app-sidebar.tsx");
  assert.match(sidebar, /waitForDrawerExit\(drawerRef.current, finishDrawerClose\)/);
  assert.match(sidebar, /requestAnimationFrame[\s\S]*menuButtonRef.current\?\.focus\(\)/);
  assert.match(sidebar, /cancelAnimationFrame\(drawerFocusFrameRef.current\)/);
  assert.match(sidebar, /useDocumentScrollLock\(isDrawerOpen\)/);
});

test("Statistics adapts only the long label in narrow viewports", () => {
  const source = read("app/(authenticated)/estatisticas/page.tsx");
  assert.match(source, /label === "Desmontagens" \? "tracking-normal \[overflow-wrap:anywhere\] sm:tracking-\[0.12em\]"/);
  assert.match(source, /label="Desmontagens"/);
});
