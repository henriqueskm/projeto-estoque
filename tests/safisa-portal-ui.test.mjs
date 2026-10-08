import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { SafisaPortal } from "../components/safisa-portal.tsx";
import { SafisaPortalDialog } from "../components/safisa-portal-dialog.tsx";
import { fixtureUserId, fixtureOrders, partialOrder, readyOrder, historyOrder, extremeOrder, asSummary } from "./safisa-portal-ui-fixtures.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const source = read("components/safisa-portal.tsx"), shell = read("components/safisa-portal-dialog.tsx");
const base = "90581f55ed3ac5a7b84b49c4be5ec3dba27e95ca";
const baseline = path => execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
const render = (selectedOrder = null, activeOrders = fixtureOrders.filter(order => !order.isReadOnly).map(asSummary)) => renderToStaticMarkup(createElement(SafisaPortal, {
  userId: fixtureUserId, displayName: "Operador de teste", activeOrders,
  completedOrders: [asSummary(historyOrder)], selectedOrder,
}));
const detail = html => html.slice(html.indexOf('role="dialog"'));

test("full-width list has compact table, accessible rows and no persistent side detail", () => {
  const html = render();
  assert.match(html, /<table class="w-full table-fixed/);
  for (const label of ["Data", "Nº do pedido", "Total de itens", "Status", "Progresso", "Em andamento", "Histórico"]) assert.ok(html.includes(label));
  assert.equal((html.match(/role="button" tabindex="0"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /role="dialog"|Selecione um pedido/);
  assert.match(source, /event\.key === "Enter" \|\| event\.key === " "/);
});

test("selected detail uses the blue dialog and production, not pickup, as progress", () => {
  const html = detail(render(partialOrder));
  for (const label of ["Pedido 40959", "Progresso da produção", "Ordem de produção", "Descrição dos Produtos", "Qtde.", "Pronto"]) assert.ok(html.includes(label));
  assert.match(html, /aria-valuemax="8" aria-valuenow="5"/);
  assert.ok(html.includes("63%"));
  assert.ok(html.includes("Retirado:")); assert.ok(html.includes("Pronto para retirar:"));
  assert.doesNotMatch(html, /<dl/);
});

test("partial line retains quantity constraints, correction version and all canonical actions", () => {
  const html = detail(render(partialOrder));
  for (const label of ["Informar quantidade", "Concluir este item (3)", "Corrigir quantidade pronta", "Novo total pronto", "Justificativa", "Revisar correção"]) assert.ok(html.includes(label));
  assert.match(html, /type="number" inputMode="numeric" min="1" max="3"[^>]*name="quantity"/);
  assert.match(source, /min=\{line\.pickedQuantity\}/);
  assert.match(source, /max=\{maximumReadyQuantity\(line\.readyQuantity, line\.waitingReadyQuantity\)\}/);
  assert.match(source, /expectedUpdatedAt: confirmation\.line\.updatedAt/);
  for (const action of ["incrementSafisaReadyQuantity", "markSafisaRemainingReady", "markSafisaOrderRemainingReady", "correctSafisaReadyQuantity", "safisaLogout"]) assert.ok(source.includes(action));
});

test("whole-order action is at the end of the real rendered detail, not a top metric card", () => {
  const html = detail(render(partialOrder));
  assert.ok(html.lastIndexOf("Dar todo o Pedido como pronto") > html.indexOf("Concluir este item"));
  assert.equal((html.match(/Dar todo o Pedido como pronto/g) ?? []).length, 1);
});

test("completely ready and history use the same detail without mutation controls", () => {
  for (const order of [readyOrder, historyOrder]) {
    const html = detail(render(order));
    assert.match(html, /role="dialog"/); assert.ok(html.includes("100%"));
    assert.doesNotMatch(html, /Informar quantidade|Concluir este item|Revisar correção|Dar todo o Pedido como pronto/);
  }
  assert.ok(detail(render(historyOrder)).includes("Pedido encerrado: informações disponíveis somente para consulta."));
});

test("empty state and sanitized extreme codes/quantities are rendered without truncating data", () => {
  assert.ok(render(null, []).includes("Nenhum pedido em andamento no momento."));
  const html = detail(render(extremeOrder));
  assert.ok(html.includes(extremeOrder.lines[0].code)); assert.ok(html.includes("9.999"));
  assert.match(source, /minmax\(0,2\.5fr\)/); assert.match(source, /break-all/); assert.match(source, /break-words/);
});

test("dialog has associated labels, safe areas, focus trap, Escape and pending/covered gates", () => {
  const html = renderToStaticMarkup(createElement(SafisaPortalDialog, {
    titleId: "title", descriptionId: "description", title: "Confirmação", pending: true, onClose() {},
  }));
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="description"/);
  assert.match(html, /disabled=""/);
  for (const contract of [/event\.key === "Escape"/, /event\.key !== "Tab"/, /latest\.current\.covered/, /!latest\.current\.pending/, /previousFocus\.focus\(\{ preventScroll: true \}\)/, /--openDialogs === 0/, /safe-area-inset-bottom/]) assert.match(shell, contract);
  assert.doesNotMatch(shell, /addEventListener\("popstate"|app\/.*actions|supabase/);
});

test("URL deep links and native Back retain the list without logout or a history loop", () => {
  assert.match(source, /router\.push\(orderHref\(order\.supplierOrderId\), \{ scroll: false \}\)/);
  assert.match(source, /if \(openedFromList\.current\) router\.back\(\)/);
  assert.match(source, /else router\.replace\("\/safisa", \{ scroll: false \}\)/);
  assert.match(source, /if \(isPending \|\| operationLock\.current \|\| confirmation\) return/);
  assert.match(source, /if \(!operationLock\.current\) setConfirmation\(null\)/);
  assert.doesNotMatch(source, /history\.go|popstate|app\/\(authenticated\)\/pedidos|brand-gold/);
});

test("logical attempts and action execution are byte-equivalent to main", () => {
  const old = baseline("components/safisa-portal.tsx");
  for (const [start, end] of [["function attemptTargetId", "function Metric"], ["  function persistAttempt", "  function warmOrder"]]) {
    const currentEnd = end === "function Metric" ? "function ProductionProgress" : end;
    assert.equal(source.slice(source.indexOf(start), source.indexOf(currentEnd)), old.slice(old.indexOf(start), old.indexOf(end)));
  }
  for (const name of ["prepareSafisaLogicalAttempt", "restoreSafisaLogicalAttempt", "serializeSafisaLogicalAttempt", "RESULT_UNKNOWN", "idempotencyKey", "RECONCILE_UNKNOWN"]) assert.ok(source.includes(name));
});

test("all Safisa server contracts, notifications, migrations and internal NK actions are unchanged", () => {
  const paths = [
    "app/safisa/actions.ts", "app/safisa/page.tsx", "lib/safisa-portal-data.ts", "lib/safisa-portal-types.ts",
    "lib/safisa-logical-attempt.ts", "lib/safisa-portal-readiness.ts", "lib/safisa-push-dispatch.ts",
    "lib/firebase-push-client.ts", "public/sw.js", "app/(authenticated)/pedidos/actions.ts",
    "supabase/migrations/20261006104415_safisa_item_ready_push_notifications.sql",
  ];
  for (const path of paths) assert.equal(read(path), baseline(path), path);
  const sqlDiff = execFileSync("git", ["diff", base, "--", "supabase/migrations"], { encoding: "utf8" });
  assert.equal(sqlDiff, "");
});
