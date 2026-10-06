import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createSemanticBackHistory, readSemanticMarker } from "../lib/semantic-back-history.ts";
import { createRouteMutationGate } from "../lib/route-transient-state.ts";

function browser(url = "/estoque", standalone = false) {
  let index = 0; let counter = 0; let exitCount = 0; let popCount = 0; let exitOpen = false;
  const traversals = [];
  const stack = [{ url, state: { __NA: true, nextTree: "untouched" } }];
  const history = {
    get state() { return stack[index].state; },
    pushState(state, _, route) { stack.splice(index + 1); stack.push({ state: structuredClone(state), url: route ?? stack[index].url }); index += 1; },
    replaceState(state, _, route) { stack[index] = { state: structuredClone(state), url: route ?? stack[index].url }; },
    go(delta) {
      traversals.push(delta);
      const target = index + delta;
      if (target < 0 || target >= stack.length) return;
      index = target;
      coordinator.pop(history.state);
    },
  };
  const coordinator = createSemanticBackHistory({ history, href: () => stack[index].url, standalone: () => standalone,
    exit: open => { exitOpen = open; if (open) exitCount += 1; }, beforePop: () => { popCount += 1; }, id: () => `entry-${++counter}` });
  coordinator.ensure();
  return { coordinator, history, stack, traversals, back: () => history.go(-1), forward: () => history.go(1),
    get url() { return stack[index].url; }, get exitCount() { return exitCount; }, get exitOpen() { return exitOpen; }, get popCount() { return popCount; } };
}
function participant(browser, key, initial, restoreGuard = () => true) {
  let value = initial;
  let detach;
  function attach() { detach = browser.coordinator.register(key, { route: browser.url.split(/[?#]/)[0], read: () => value,
    restore: next => { if (restoreGuard(next)) value = next; } }); }
  attach();
  return { get value() { return value; }, change(next, replace = false) { browser.coordinator.commit(key, value, next, replace); value = next; }, attach, detach: () => detach(), reset(next) { value = next; } };
}

test("Pedidos: filter → read-only order → Back closes detail → Back restores filter", () => {
  const b = browser("/pedidos"); const state = participant(b, "pedidos:active", { search: "40959", statusFilter: "ALL", selectedOrderId: null });
  state.change({ ...state.value, statusFilter: "PARTIAL" });
  state.change({ ...state.value, selectedOrderId: "safe-order-id" });
  b.back(); assert.equal(state.value.selectedOrderId, null); assert.equal(state.value.statusFilter, "PARTIAL"); assert.equal(state.value.search, "40959");
  b.back(); assert.equal(state.value.statusFilter, "ALL");
  b.forward(); b.forward(); assert.equal(state.value.selectedOrderId, "safe-order-id");
});

for (const modal of ["Novo pedido", "Editar", "Finalizar", "Cancelar", "Entrada vinculada", "Venda", "Ajuste", "Montagem", "Mínimo", "drawer"]) {
  test(`${modal}: Back closes; Forward cannot resurrect a transaction`, () => {
    const b = browser(); let open = true;
    b.coordinator.openTransient(modal, () => { open = false; }, () => false);
    b.back(); assert.equal(open, false); assert.equal(b.url, "/estoque");
    b.forward(); assert.equal(open, false);
  });
}

test("pending mutation cannot cause a navigation loop or acquire a second submission", () => {
  const b = browser(); let closes = 0;
  b.coordinator.openTransient("mutation", () => { closes += 1; }, () => true);
  b.back(); assert.equal(closes, 0); assert.equal(b.stack.length, 2); assert.equal(b.popCount, 0);
});

for (const kind of ["MARK_ALL", "CANCEL", "CANCEL_REMAINING"]) {
  test(`ConfirmationDialog ${kind}: Back closes only confirmation, next Back closes order, Forward is safe`, () => {
    const b = browser("/pedidos");
    const state = participant(b, "pedidos:active", { search: "40959", statusFilter: "PARTIAL", sort: "OLDEST", selectedOrderId: null });
    state.change({ ...state.value, selectedOrderId: "safe-order-id" });
    const detail = structuredClone(state.value);
    let confirmation = true;
    b.coordinator.openTransient(kind, () => { confirmation = false; }, () => false);
    b.back();
    assert.equal(confirmation, false);
    assert.deepEqual(state.value, detail, "selected order, search, filters and sort stay unchanged");
    b.back(); assert.equal(state.value.selectedOrderId, null);
    b.forward(); assert.equal(state.value.selectedOrderId, "safe-order-id");
    b.forward(); assert.equal(confirmation, false, "transaction confirmation is not restorable");
    assert.deepEqual(state.value, detail);
  });
  test(`ConfirmationDialog ${kind}: pending Back retains modal/detail and the #78 submission gate`, () => {
    const b = browser("/pedidos");
    const state = participant(b, "pedidos:active", { selectedOrderId: null, search: "kept" });
    state.change({ ...state.value, selectedOrderId: "safe-order-id" });
    const gate = createRouteMutationGate();
    const release = gate.acquire();
    let confirmation = true;
    b.coordinator.openTransient(kind, () => { confirmation = false; }, gate.isPending);
    const entryId = readSemanticMarker(b.history.state).id;
    const length = b.stack.length;
    const popsBefore = b.popCount;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      b.back(); assert.equal(gate.acquire(), null, "second submit cannot acquire the in-flight gate");
      assert.equal(readSemanticMarker(b.history.state).id, entryId);
      assert.equal(confirmation, true); assert.equal(state.value.selectedOrderId, "safe-order-id");
    }
    assert.equal(b.popCount, popsBefore, "no route cleanup/restore while mutation is pending");
    assert.equal(b.stack.length, length);
    release(); b.back(); assert.equal(confirmation, false); assert.equal(state.value.selectedOrderId, "safe-order-id");
  });
}

test("order confirmation/finalization/stock entry use exactly the DialogShell default transient registration", () => {
  const source = readFileSync(new URL("../app/(authenticated)/pedidos/orders-workspace.tsx", import.meta.url), "utf8");
  for (const [name, next] of [["ConfirmationDialog", "FinalizationDialog"], ["FinalizationDialog", "StockEntryDialog"], ["StockEntryDialog", "OrderDetailsDialog"]]) {
    const component = source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
    assert.equal((component.match(/<DialogShell\b/g) ?? []).length, 1);
    assert.match(component, /isPending=\{isPending\}/);
    assert.doesNotMatch(component, /semanticTransient=|useSemanticTransient\(/, "no opt-out or duplicate registration");
  }
  const shell = source.slice(source.indexOf("function DialogShell("), source.indexOf("function DialogShell(") + 1000);
  assert.match(shell, /semanticTransient = true/);
  assert.equal((shell.match(/useSemanticTransient\(semanticTransient, onClose, isPending\)/g) ?? []).length, 1);
});

test("Estoque: filter, group, family unwind in exact reverse order", () => {
  const b = browser(); const state = participant(b, "estoque", { statusFilter: "all", openPhysicalGroups: [], openFamilies: [] });
  state.change({ ...state.value, statusFilter: "low" });
  state.change({ ...state.value, openPhysicalGroups: ["SERVO"] });
  state.change({ ...state.value, openFamilies: ["MBF-015"] });
  b.back(); assert.deepEqual(state.value.openFamilies, []); assert.deepEqual(state.value.openPhysicalGroups, ["SERVO"]);
  b.back(); assert.deepEqual(state.value.openPhysicalGroups, []); assert.equal(state.value.statusFilter, "low");
  b.back(); assert.equal(state.value.statusFilter, "all");
});

for (const mode of ["entrada", "saida"]) {
  test(`${mode}: Review Back/Forward cooperates with the same draft/key; completion is terminal`, () => {
    const b = browser(`/${mode}`); const draft = { lines: [{ code: "1H", quantity: 3 }], idempotencyKey: "same-key", step: "editing" };
    const state = participant(b, `${mode}:review`, { step: "editing", draftIdentity: draft.idempotencyKey }, next => next.draftIdentity === draft.idempotencyKey);
    state.change({ ...state.value, step: "review" });
    b.back(); assert.equal(state.value.step, "editing"); assert.equal(draft.idempotencyKey, "same-key"); assert.equal(draft.lines.length, 1);
    b.forward(); assert.equal(state.value.step, "review");
    b.coordinator.invalidate(`${mode}:review`); draft.lines = []; draft.step = "editing"; state.reset({ step: "editing", draftIdentity: null });
    b.back(); b.forward(); assert.equal(state.value.step, "editing"); assert.equal(draft.lines.length, 0);
  });
  test(`${mode}: a changed payload rejects an older review identity`, () => {
    const b = browser(`/${mode}`); let identity = "first-key";
    const state = participant(b, `${mode}:review`, { step: "editing", draftIdentity: identity }, value => value.draftIdentity === identity);
    state.change({ step: "review", draftIdentity: identity }); b.back(); identity = "changed-key";
    b.forward(); assert.equal(state.value.step, "editing");
  });
}

test("search uses replace/coalescing, not an entry per letter", () => {
  const b = browser(); const state = participant(b, "estoque", { query: "" });
  for (const query of ["M", "MB", "MBF", "MBF0", "MBF01", "MBF015"]) state.change({ query }, true);
  assert.equal(b.stack.length, 1); assert.equal(state.value.query, "MBF015");
});

test("recommended list: tab Back, modal Back, and explicit close skips its tab checkpoints", () => {
  const b = browser();
  b.coordinator.commit("recommendations", { open: false }, { open: true }, false, "/estoque?view=purchase-recommendations");
  const tab = participant(b, "recommendation-tab", { tab: "buy-now" }); tab.change({ tab: "already-ordered" });
  b.back(); assert.equal(tab.value.tab, "buy-now"); b.back(); assert.equal(b.url, "/estoque");
  b.forward(); b.forward(); assert.equal(tab.value.tab, "already-ordered");
  assert.equal(b.coordinator.closeRecommendations(), true); assert.equal(b.url, "/estoque");
});

test("recommended list deep link adds a close checkpoint without default Home navigation", () => {
  const b = browser("/estoque?view=purchase-recommendations"); b.coordinator.seedRecommendations();
  b.back(); assert.equal(b.url, "/estoque"); b.forward(); assert.equal(b.url, "/estoque?view=purchase-recommendations");
});

test("direct order: first Back closes it; next Back opens standalone exit confirmation", () => {
  const b = browser("/pedidos?order=real-order", true);
  b.coordinator.seedOrder("pedidos:active", "real-order", { selectedOrderId: "real-order", search: "kept" });
  const state = participant(b, "pedidos:active", { selectedOrderId: "real-order", search: "kept" });
  b.back(); assert.equal(state.value.selectedOrderId, null); assert.equal(b.url, "/pedidos"); assert.equal(b.exitCount, 0);
  b.back(); assert.equal(b.url, "/pedidos"); assert.equal(b.exitCount, 1);
  b.coordinator.continueInApp(); b.back(); assert.equal(b.exitCount, 2);
  const length = b.stack.length; b.coordinator.leaveApp(); b.back(); assert.equal(b.exitCount, 2); assert.equal(b.stack.length, length);
});

test("ordinary browser has no sentinel/exit trap", () => {
  const b = browser("/pedidos"); assert.equal(b.stack.length, 1); b.back(); assert.equal(b.exitCount, 0);
});

test("standalone exit: Back cancels, another Back reopens, Continue/Escape and Exit keep a single boundary", () => {
  const b = browser("/pedidos", true);
  const state = participant(b, "pedidos:active", { search: "kept", statusFilter: "PARTIAL", selectedOrderId: null });
  const original = structuredClone(state.value);
  const length = b.stack.length;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    b.back(); assert.equal(b.exitOpen, true);
    b.back(); assert.equal(b.exitOpen, false);
    assert.equal(b.url, "/pedidos"); assert.deepEqual(state.value, original);
    assert.equal(b.stack.length, length);
  }
  b.back(); assert.equal(b.exitOpen, true);
  b.coordinator.continueInApp(); assert.equal(b.exitOpen, false);
  b.back(); assert.equal(b.exitOpen, true, "Continue re-arms the same boundary");
  assert.equal(b.stack.filter(entry => readSemanticMarker(entry.state)?.kind === "EXIT_BOUNDARY").length, 1);
  assert.equal(b.popCount, 0, "exit attempts never restore/clear useful Workspace state");
  assert.equal(b.traversals.length, 28, "each Back has only one bounded forward bounce");
  const traversalsBeforeExit = b.traversals.length;
  b.coordinator.leaveApp(); assert.equal(b.exitOpen, false);
  assert.equal(b.traversals.length, traversalsBeforeExit, "Exit releases the guard without navigating to an older URL");
  const attempts = b.exitCount;
  b.back(); assert.equal(b.exitCount, attempts, "released boundary no longer traps Back");
  assert.equal(b.stack.length, length);
});

test("StrictMode transient effect probe does not duplicate history", () => {
  const b = browser(); const first = b.coordinator.openTransient("same-hook", () => {}, () => false);
  b.coordinator.retireTransient(first);
  assert.equal(b.coordinator.openTransient("same-hook", () => {}, () => false), first);
  b.coordinator.consumeRetiredTransient(first); assert.equal(b.stack.length, 2); assert.equal(readSemanticMarker(b.history.state).id, first);
});

test("manual dialog close consumes its checkpoint but Activity departure never traverses", () => {
  const b = browser(); const first = b.coordinator.openTransient("modal", () => {}, () => false);
  b.coordinator.retireTransient(first); b.coordinator.consumeRetiredTransient(first);
  assert.equal(readSemanticMarker(b.history.state).kind, "ROUTE");
  const second = b.coordinator.openTransient("modal", () => {}, () => false);
  b.history.pushState({ __NA: true }, "", "/pedidos"); b.coordinator.ensure();
  b.coordinator.retireTransient(second); b.coordinator.consumeRetiredTransient(second);
  assert.equal(b.url, "/pedidos");
});

test("GET route filters and period navigation retain their own native entries", () => {
  const b = browser("/historico");
  b.history.pushState({ __NA: true, nextTree: "new" }, "", "/historico?type=OUTBOUND"); b.coordinator.ensure();
  const initialLength = b.stack.length; b.coordinator.ensure(); assert.equal(b.stack.length, initialLength);
  b.history.pushState({ __NA: true }, "", "/historico?type=OUTBOUND&period=30"); b.coordinator.ensure();
  b.back(); assert.equal(b.url, "/historico?type=OUTBOUND"); b.back(); assert.equal(b.url, "/historico");
});

test("Activity detach/attach restores safe projection and never registers hidden route handlers", () => {
  const b = browser(); const state = participant(b, "estoque", { statusFilter: "all" });
  state.change({ statusFilter: "low" }); state.detach();
  b.history.pushState({ __NA: true }, "", "/pedidos"); b.coordinator.ensure();
  b.back(); state.attach(); assert.equal(state.value.statusFilter, "low");
  b.back(); assert.equal(state.value.statusFilter, "all");
});

test("every History write preserves Next state and serializes only minimal identity", () => {
  const b = browser(); const state = participant(b, "estoque", { query: "sensitive-not-in-history", statusFilter: "all" }); state.change({ ...state.value, statusFilter: "low" });
  for (const entry of b.stack) {
    assert.equal(entry.state.__NA, true); assert.equal(entry.state.nextTree, "untouched");
    assert.equal(JSON.stringify(entry.state).includes("sensitive-not-in-history"), false);
    assert.equal(readSemanticMarker(entry.state).version, 1);
  }
  assert.equal(readSemanticMarker({ __nkSemanticBack: { version: 99 } }), null);
});

test("standalone reload reuses its boundary instead of accumulating sentinels", () => {
  const b = browser("/estoque", true); const length = b.stack.length;
  const reloaded = createSemanticBackHistory({ history: b.history, href: () => b.url, standalone: () => true, exit: () => {}, beforePop: () => {}, id: () => "reload" });
  reloaded.ensure(); assert.equal(b.stack.length, length);
});

for (const cleanup of ["manual", "effect"]) {
  test(`slow Minha Conta navigation: ${cleanup} drawer cleanup cannot cancel the pending route`, () => {
    const b = browser("/");
    const state = participant(b, "home", { search: "preserved" });
    let open = true;
    const drawer = b.coordinator.openTransient("drawer", () => { open = false; }, () => false);
    const nextState = structuredClone(b.history.state);
    b.coordinator.beforeNavigation();
    assert.equal(b.url, "/", "Next has not committed the destination yet");
    b.coordinator.retireTransient(drawer, cleanup === "manual");
    b.coordinator.consumeRetiredTransient(drawer);
    open = false;
    assert.deepEqual(b.traversals, [], "cleanup must not call Back while Next is pending");
    assert.deepEqual(b.history.state, nextState, "Next's history state is untouched");
    b.history.pushState(nextState, "", "/minha-conta");
    b.coordinator.ensure();
    assert.equal(b.url, "/minha-conta");
    b.back(); assert.equal(b.url, "/"); assert.equal(open, false);
    assert.equal(state.value.search, "preserved");
    b.forward(); assert.equal(b.url, "/minha-conta"); assert.equal(open, false);
  });
}

test("an abandoned navigation does not suppress closing a newly opened drawer", () => {
  const b = browser("/");
  const old = b.coordinator.openTransient("drawer", () => {}, () => false);
  b.coordinator.beforeNavigation();
  b.coordinator.retireTransient(old, true);
  b.coordinator.consumeRetiredTransient(old);
  assert.deepEqual(b.traversals, []);
  const fresh = b.coordinator.openTransient("drawer", () => {}, () => false);
  assert.notEqual(fresh, old, "departure is scoped to the old checkpoint, not a global flag");
  b.coordinator.retireTransient(fresh, true);
  assert.deepEqual(b.traversals, [-1]);
});

test("navigation intent does not weaken the pending mutation Back gate", () => {
  const b = browser("/pedidos"); let closed = false;
  b.coordinator.openTransient("pending", () => { closed = true; }, () => true);
  b.coordinator.beforeNavigation();
  b.back(); assert.equal(closed, false); assert.equal(b.popCount, 0);
  assert.deepEqual(b.traversals, [-1, 1]);
});

test("route departure is registered centrally using the existing Workspace navigation event", () => {
  const source = readFileSync(new URL("../components/semantic-back-provider.tsx", import.meta.url), "utf8");
  assert.match(source, /coordinator.beforeNavigation\(\)/);
  assert.match(source, /addEventListener\("nk:workspace:before-navigation", navigate\)/);
  assert.match(source, /removeEventListener\("nk:workspace:before-navigation", navigate\)/);
  assert.equal((source.match(/addEventListener\("popstate"/g) ?? []).length, 1);
});

test("source integration leaves Workspace v1 and all transactional writers untouched", () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const hook = read("components/semantic-back-provider.tsx");
  assert.match(hook, /isStandaloneMode/); assert.match(hook, /useLayoutEffect/); assert.match(hook, /aria-modal="true"/);
  assert.match(hook, /nk-exit-title/); assert.match(hook, /event.key === "Escape"/); assert.match(hook, /event.key === "Tab"/);
  assert.match(hook, /event.key === "Escape"\) \{ event.preventDefault\(\); onContinue\(\);/);
  assert.match(hook, /onContinue=\{\(\) => coordinator.continueInApp\(\)\}/);
  assert.doesNotMatch(hook, /window.confirm|window.close|about:blank|router.refresh|\.rpc\(/);
  assert.equal((hook.match(/addEventListener\("popstate"/g) ?? []).length, 1);
  for (const mode of ["entrada", "saida"]) {
    const flow = read(`app/(authenticated)/${mode}/${mode === "entrada" ? "inbound" : "outbound"}-entry-flow.tsx`);
    assert.match(flow, /value.draftIdentity !== workspace.state.idempotencyKey/);
    assert.match(flow, /reviewHistory.invalidate\(\);\s*workspace.clear\(\);/);
    assert.match(flow, /submissionInFlight.current/);
  }
});
