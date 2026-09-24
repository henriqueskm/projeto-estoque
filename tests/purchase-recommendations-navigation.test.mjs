import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildPurchaseRecommendations } from "../lib/purchase-recommendation-domain.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function catalogTarget(overrides = {}) {
  return {
    targetKind: "item",
    targetId: "item-1",
    primaryCode: "2",
    aliases: [],
    itemType: "SERVO",
    typeLabel: "Servoembreagem",
    description: "SERVO MBF-025",
    currentStock: 1,
    minimumStock: 4,
    inventoryHref: "/estoque?item=item-1",
    ...overrides,
  };
}

function dependenciesChanged(previous, next) {
  return (
    !previous ||
    previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]))
  );
}

function createHookHarness(component, props) {
  const slots = [];
  let cursor = 0;
  let dirty = true;
  let tree;
  let pendingEffects = [];

  function useState(initialValue) {
    const index = cursor++;
    if (!slots[index]) {
      slots[index] = {
        value:
          typeof initialValue === "function"
            ? initialValue()
            : initialValue,
      };
    }

    const setValue = (nextValue) => {
      const previous = slots[index].value;
      const next =
        typeof nextValue === "function"
          ? nextValue(previous)
          : nextValue;
      if (!Object.is(previous, next)) {
        slots[index].value = next;
        dirty = true;
      }
    };

    return [slots[index].value, setValue];
  }

  function useRef(initialValue) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { current: initialValue };
    return slots[index];
  }

  function useCallback(callback, dependencies) {
    const index = cursor++;
    const slot = slots[index];
    if (!slot || dependenciesChanged(slot.dependencies, dependencies)) {
      slots[index] = { callback, dependencies };
    }
    return slots[index].callback;
  }

  function useEffect(effect, dependencies) {
    const index = cursor++;
    const slot = slots[index];
    if (!slot || dependenciesChanged(slot.dependencies, dependencies)) {
      pendingEffects.push({ effect, index });
      slots[index] = {
        cleanup: slot?.cleanup,
        dependencies,
      };
    }
  }

  function render() {
    cursor = 0;
    pendingEffects = [];
    dirty = false;
    tree = component(props);

    for (const { effect, index } of pendingEffects) {
      slots[index].cleanup?.();
      slots[index].cleanup = effect() ?? undefined;
    }
  }

  return {
    hooks: { useCallback, useEffect, useRef, useState },
    get tree() {
      return tree;
    },
    get dirty() {
      return dirty;
    },
    invalidate() {
      dirty = true;
    },
    render,
  };
}

function createControlledBrowser(initialHref) {
  let now = 1_000;
  let timerSequence = 0;
  let idleSequence = 0;
  let index = 0;
  let routerUrl = new URL(initialHref);
  const timers = new Map();
  const historyCalls = [];
  const internalState = {
    __NA: true,
    __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}],
  };
  const entries = [{ url: new URL(initialHref), state: internalState }];

  function currentEntry() {
    return entries[index];
  }

  function copyNextInternals(data) {
    const nextState = data == null ? {} : data;
    if (currentEntry().state?.__NA) nextState.__NA = true;
    if (currentEntry().state?.__PRIVATE_NEXTJS_INTERNALS_TREE) {
      nextState.__PRIVATE_NEXTJS_INTERNALS_TREE =
        currentEntry().state.__PRIVATE_NEXTJS_INTERNALS_TREE;
    }
    return nextState;
  }

  function applyHistory(kind, data, url) {
    const nextUrl = new URL(url, currentEntry().url);
    historyCalls.push({
      kind,
      suppliedData: data == null ? data : { ...data },
    });

    let nextState = data;
    if (!data?.__NA && !data?._N) {
      routerUrl = nextUrl;
      nextState = copyNextInternals(data);
    }

    if (kind === "push") {
      entries.splice(index + 1);
      entries.push({ url: nextUrl, state: nextState });
      index += 1;
    } else {
      entries[index] = { url: nextUrl, state: nextState };
    }
  }

  const controlledWindow = {
    location: {
      get href() {
        return currentEntry().url.href;
      },
    },
    history: {
      get state() {
        return currentEntry().state;
      },
      pushState(data, _unused, url) {
        applyHistory("push", data, url);
      },
      replaceState(data, _unused, url) {
        applyHistory("replace", data, url);
      },
      back() {
        if (index === 0) return;
        index -= 1;
        if (currentEntry().state?.__NA) {
          routerUrl = new URL(currentEntry().url);
        }
      },
      forward() {
        if (index >= entries.length - 1) return;
        index += 1;
        if (currentEntry().state?.__NA) {
          routerUrl = new URL(currentEntry().url);
        }
      },
    },
    setTimeout(callback, delay = 0) {
      const id = ++timerSequence;
      timers.set(id, { callback, dueAt: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestIdleCallback() {
      return ++idleSequence;
    },
    cancelIdleCallback() {},
    addEventListener() {},
    removeEventListener() {},
  };

  return {
    window: controlledWindow,
    historyCalls,
    get now() {
      return now;
    },
    set now(value) {
      now = value;
    },
    get routerUrl() {
      return routerUrl;
    },
    runDueTimers() {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort((first, second) => first[1].dueAt - second[1].dueAt);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
      return due.length > 0;
    },
  };
}

function compileLauncher(hooks, getSearchParams) {
  const source = read("components/purchase-recommendation-launcher.tsx");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const compiledModule = { exports: {} };
  const panelType = function PurchaseRecommendationPanel() {};
  const jsx = (type, props, key) => ({
    type,
    props: key === undefined ? props : { ...props, key },
  });
  const requireMock = (specifier) => {
    if (specifier === "react") return hooks;
    if (specifier === "react/jsx-runtime") {
      return { Fragment: Symbol.for("react.fragment"), jsx, jsxs: jsx };
    }
    if (specifier === "next/navigation") {
      return { useSearchParams: getSearchParams };
    }
    if (specifier === "@/components/purchase-recommendation-panel") {
      return { PurchaseRecommendationPanel: panelType };
    }
    if (specifier === "@/lib/inventory-ui-events") {
      return { inventoryDataChangedEvent: "nk:inventory-data-changed" };
    }
    throw new Error(`Unexpected launcher import: ${specifier}`);
  };

  new Function("require", "module", "exports", output)(
    requireMock,
    compiledModule,
    compiledModule.exports,
  );

  return {
    Launcher: compiledModule.exports.PurchaseRecommendationLauncher,
    panelType,
  };
}

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;

  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

async function flushHarness(harness, browser) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let progressed = false;
    if (harness.dirty || !harness.tree) {
      harness.render();
      progressed = true;
    }
    if (browser.runDueTimers()) progressed = true;
    await Promise.resolve();
    if (!progressed && !harness.dirty) return;
  }
  throw new Error("Launcher harness did not settle.");
}

async function flushPromises() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

test("reader domain remains the only recommendation calculation", () => {
  const result = buildPurchaseRecommendations(
    [catalogTarget()],
    [],
  );

  assert.equal(result.buyNow.length, 1);
  assert.equal(result.buyNow[0].recommendedQuantity, 3);
  assert.equal(result.summary.buyNowCount, 1);

  const route = read("app/api/purchase-recommendations/route.ts");
  const launcher = read("components/purchase-recommendation-launcher.tsx");
  assert.match(route, /loadPurchaseRecommendations\(supabase\)/);
  assert.doesNotMatch(launcher, /buildPurchaseRecommendations|minimumStock\s*-/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /getClaims\(\)/);
  assert.match(route, /\.eq\("is_active", true\)/);
});

test("inventory page no longer waits for recommendations", () => {
  const page = read("app/(authenticated)/estoque/page.tsx");
  const workspace = read(
    "app/(authenticated)/estoque/inventory-workspace.tsx",
  );

  assert.doesNotMatch(page, /loadPurchaseRecommendations/);
  assert.doesNotMatch(page, /purchaseRecommendationsResult/);
  assert.match(page, /loadInventoryData\(\)/);
  assert.match(workspace, /<PurchaseRecommendationLauncher/);
});

test("native history keeps URL, modal state, and stale revalidation coherent", async () => {
  const browser = createControlledBrowser("https://example.test/estoque");
  const fetchRequests = [];
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  globalThis.window = browser.window;
  globalThis.fetch = (...arguments_) =>
    new Promise((resolve) => {
      fetchRequests.push({ arguments_, resolve });
    });
  Date.now = () => browser.now;

  let harness;

  try {
    const searchParams = () => ({
      get: (key) => browser.routerUrl.searchParams.get(key),
    });
    const placeholderHarness = createHookHarness(() => null, {});
    const { Launcher, panelType } = compileLauncher(
      placeholderHarness.hooks,
      searchParams,
    );
    harness = createHookHarness(Launcher, { initiallyOpen: false });
    Object.assign(placeholderHarness.hooks, harness.hooks);
    await flushHarness(harness, browser);

    const trigger = findElement(
      harness.tree,
      (node) => node.type === "a",
    );
    let defaultPrevented = false;
    trigger.props.onClick({
      preventDefault() {
        defaultPrevented = true;
      },
    });
    await flushHarness(harness, browser);

    assert.equal(defaultPrevented, true);
    assert.equal(
      new URL(browser.window.location.href).searchParams.get("view"),
      "purchase-recommendations",
    );
    assert.equal(
      browser.routerUrl.searchParams.get("view"),
      "purchase-recommendations",
    );
    assert.deepEqual(browser.historyCalls[0], {
      kind: "push",
      suppliedData: { nkPurchaseRecommendations: true },
    });
    assert.equal(browser.window.history.state.__NA, true);
    assert.equal(fetchRequests.length, 1);

    let panel = findElement(
      harness.tree,
      (node) => node.type === panelType,
    );
    assert.equal(panel.props.isLoading, true);
    assert.equal(panel.props.data, null);

    const firstData = {
      buyNow: [],
      alreadyOrdered: [],
      missingMinimum: [],
      summary: {
        buyNowCount: 0,
        alreadyOrderedCount: 0,
        missingMinimumCount: 0,
      },
    };
    fetchRequests[0].resolve({
      ok: true,
      json: async () => firstData,
    });
    await flushPromises();
    await flushHarness(harness, browser);

    panel = findElement(harness.tree, (node) => node.type === panelType);
    assert.deepEqual(panel.props.data, firstData);
    assert.equal(panel.props.isRefreshing, false);

    browser.now += 15_001;
    panel.props.onClose();
    await flushHarness(harness, browser);
    assert.equal(fetchRequests.length, 1, "close must not fetch");
    assert.equal(
      browser.routerUrl.searchParams.get("view"),
      null,
    );
    assert.equal(
      findElement(harness.tree, (node) => node.type === panelType),
      null,
    );

    browser.window.history.forward();
    harness.invalidate();
    await flushHarness(harness, browser);

    assert.equal(
      browser.routerUrl.searchParams.get("view"),
      "purchase-recommendations",
    );
    assert.equal(fetchRequests.length, 2);
    panel = findElement(harness.tree, (node) => node.type === panelType);
    assert.deepEqual(panel.props.data, firstData);
    assert.equal(panel.props.isRefreshing, true);

    await flushHarness(harness, browser);
    assert.equal(fetchRequests.length, 2, "reopen must reuse in-flight fetch");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("closing a direct deep link replaces URL without forwarding Next internals", async () => {
  const browser = createControlledBrowser(
    "https://example.test/estoque?view=purchase-recommendations",
  );
  const fetchRequests = [];
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  globalThis.window = browser.window;
  globalThis.fetch = (...arguments_) =>
    new Promise((resolve) => {
      fetchRequests.push({ arguments_, resolve });
    });
  Date.now = () => browser.now;

  try {
    const searchParams = () => ({
      get: (key) => browser.routerUrl.searchParams.get(key),
    });
    const placeholderHarness = createHookHarness(() => null, {});
    const { Launcher, panelType } = compileLauncher(
      placeholderHarness.hooks,
      searchParams,
    );
    const harness = createHookHarness(Launcher, { initiallyOpen: true });
    Object.assign(placeholderHarness.hooks, harness.hooks);
    await flushHarness(harness, browser);

    const panel = findElement(
      harness.tree,
      (node) => node.type === panelType,
    );
    assert.ok(panel);
    assert.equal(fetchRequests.length, 1);

    panel.props.onClose();
    await flushHarness(harness, browser);

    assert.equal(fetchRequests.length, 1, "close must not fetch");
    assert.deepEqual(browser.historyCalls.at(-1), {
      kind: "replace",
      suppliedData: null,
    });
    assert.equal(browser.routerUrl.searchParams.get("view"), null);
    assert.equal(browser.window.history.state.__NA, true);
    assert.equal(
      findElement(harness.tree, (node) => node.type === panelType),
      null,
    );
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("modal accessibility and local close handlers remain intact", () => {
  const panel = read("components/purchase-recommendation-panel.tsx");
  assert.doesNotMatch(panel, /useRouter|router\.(?:push|replace|refresh)/);
  assert.equal(panel.match(/onClick=\{onClose\}/g)?.length, 2);
  assert.match(panel, /event\.key === "Escape"/);
  assert.match(panel, /document\.body\.style\.overflow = "hidden"/);
  assert.match(panel, /previousFocus\?\.focus\(\)/);
  assert.match(panel, /event\.key !== "Tab"/);
});

test("warm and click share one in-flight request and expose loading/error states", () => {
  const launcher = read("components/purchase-recommendation-launcher.tsx");
  const panel = read("components/purchase-recommendation-panel.tsx");

  assert.match(launcher, /requestInFlightRef\.current/);
  assert.match(
    launcher,
    /if \(requestInFlightRef\.current\)[\s\S]*return requestInFlightRef\.current/,
  );
  assert.match(launcher, /requestIdleCallback/);
  assert.match(launcher, /onPointerEnter/);
  assert.match(launcher, /onFocus/);
  assert.match(launcher, /cache: "no-store"/);
  assert.match(launcher, /inventoryDataChangedEvent/);
  assert.match(panel, /Carregando lista recomendada/);
  assert.match(panel, /Tentar novamente/);
  assert.match(panel, /última lista confirmada continua visível/);
});
