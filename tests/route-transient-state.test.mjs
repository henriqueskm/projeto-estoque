import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attachRouteVisit, createRouteMutationGate, createRouteVisit, startRouteMutation } from "../lib/route-transient-state.ts";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

for (const state of ["Venda", "Ajuste", "Montagem", "Desmontagem", "Estoque mínimo", "Novo pedido", "Editar pedido", "Finalizar pedido", "Cancelar pedido", "Entrada do pedido"]) {
  test(`${state}: Activity cleanup clears transient UI, not useful workspace state`, () => {
    const visit = createRouteVisit();
    const target = new EventTarget();
    const workspace = { query: "MBF015", filter: "low", sort: "quantity", selectedOrderId: "safe-order", scroll: 812 };
    const expected = { ...workspace };
    let dialog = state;
    const cleanup = attachRouteVisit(visit, () => { dialog = null; }, target);
    const oldVisit = visit.capture();
    cleanup(); // The exact cleanup returned to useLayoutEffect, without a click.
    const cleanupAgain = attachRouteVisit(visit, () => { dialog = null; }, target);
    assert.equal(dialog, null);
    assert.equal(oldVisit(), false);
    assert.deepEqual(workspace, expected);
    cleanupAgain();
  });
}

for (const event of ["nk:workspace:before-navigation", "popstate", "pagehide"]) {
  test(`${event} resets a confirmation and invalidates late callbacks`, () => {
    const visit = createRouteVisit(); const target = new EventTarget();
    let confirmation = true; let resets = 0;
    const cleanup = attachRouteVisit(visit, () => { confirmation = false; resets += 1; }, target);
    const previous = visit.capture();
    target.dispatchEvent(new Event(event));
    assert.equal(confirmation, false); assert.equal(previous(), false);
    cleanup(); const count = resets;
    target.dispatchEvent(new Event(event)); assert.equal(resets, count);
  });
}

for (const mode of ["entrada", "saida"]) {
  test(`${mode}: review and idempotency key survive hide, receipt does not`, async () => {
    const visit = createRouteVisit(); const target = new EventTarget();
    const draft = { step: "review", lines: [{ code: "1H", quantity: 1 }], idempotencyKey: "same-key" };
    const expected = structuredClone(draft); let receipt = "old-completed-result";
    const cleanup = attachRouteVisit(visit, () => { receipt = null; }, target);
    const isCurrent = visit.capture(); cleanup();
    const cleanupAgain = attachRouteVisit(visit, () => { receipt = null; }, target);
    await Promise.resolve(); if (isCurrent()) receipt = "late-result";
    assert.equal(receipt, null); assert.deepEqual(draft, expected);
    cleanupAgain();
    const source = read(`app/(authenticated)/${mode}/${mode === "entrada" ? "inbound" : "outbound"}-entry-flow.tsx`);
    const reset = source.slice(source.indexOf("const visit = useRouteTransientCleanup"), source.indexOf("const selectedKeys"));
    assert.match(reset, /setReceipt\(null\)/);
    assert.doesNotMatch(reset, /workspace.clear\(|rotateIdempotencyKey\(|submissionInFlight.current = false/);
    assert.match(source, /workspace.clear\(\);\s*if \(!isCurrentVisit\(\)\) return;/);
    assert.match(source, /isPending \|\| submissionInFlight.current/);
  });
}

test("pending mutation lock survives dialog disposal and Activity reactivation", async () => {
  const gate = createRouteMutationGate(); const visit = createRouteVisit(); const target = new EventTarget();
  const cleanup = attachRouteVisit(visit, () => {}, target); const result = deferred();
  let pending; let calls = 0; let receipt = null; let invalidations = 0;
  const transition = action => { pending = action(); };
  startRouteMutation(gate, visit, transition, async current => { calls += 1; await result.promise; if (current()) receipt = "success"; }, () => { invalidations += 1; });
  cleanup(); const cleanupAgain = attachRouteVisit(visit, () => {}, target);
  startRouteMutation(gate, visit, transition, async () => { calls += 1; });
  assert.equal(gate.isPending(), true); assert.equal(calls, 1);
  result.resolve(); await pending;
  assert.equal(receipt, null); assert.equal(gate.isPending(), false); assert.equal(invalidations, 1);
  cleanupAgain();
});

test("failed mutation releases its gate; repeated release never unlocks a newer attempt", async () => {
  const gate = createRouteMutationGate(); const visit = createRouteVisit(); visit.activate(); let pending;
  startRouteMutation(gate, visit, action => { pending = action(); }, async () => { throw new Error("network"); });
  await assert.rejects(pending, /network/); assert.equal(gate.isPending(), false);
  const first = gate.acquire(); first(); const second = gate.acquire(); first();
  assert.equal(gate.isPending(), true); second();
});

test("production hooks use layout cleanup, route-owned locks and no persistent reset", () => {
  const hooks = read("components/route-transient-state.tsx");
  assert.match(hooks, /useLayoutEffect\(/); assert.match(hooks, /attachRouteVisit\(visit, \(\) => resetTransient\(\), window\)/);
  assert.doesNotMatch(hooks, /usePathname|sessionStorage|localStorage|crypto|router\./);
  const inventory = read("components/inventory-row-actions.tsx");
  for (const setter of ["setIsOpen(false)", "setActiveDialog(null)", "setFeedback(null)"]) assert.ok(inventory.includes(setter));
  assert.match(read("app/(authenticated)/estoque/page.tsx"), /RouteMutationBoundary><InventoryWorkspace/);
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  for (const setter of ["setEditingOrderId(null)", "setCreatingOrder(false)", "setConfirmation(null)", "setFinalizing(false)", "setStockEntryOpen(false)"]) assert.ok(orders.includes(setter));
  assert.match(orders, /<RouteMutationBoundary>/);
  assert.match(orders, /isCurrentVisit\(\) && attemptSequence === attemptSequenceRef.current/);
  assert.equal((orders.match(/runMutation\(async/g) ?? []).length, 4);
  assert.equal((read("components/inventory-action-dialogs.tsx").match(/runMutation\(async/g) ?? []).length, 4);
  assert.match(read("components/inventory-sale-dialog.tsx"), /runMutation\(async[\s\S]*if \(!isCurrentVisit\(\)\) return;/);
});
