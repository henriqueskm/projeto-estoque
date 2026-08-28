import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  maximumReadyQuantity,
  readinessLabel,
} from "../lib/safisa-portal-readiness.ts";
import { mapSafisaMutationError } from "../lib/safisa-action-errors.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const actions = read("app/safisa/actions.ts");
const proxy = read("lib/supabase/proxy.ts");
const portal = read("components/safisa-portal.tsx");
const auth = read("lib/safisa-auth.ts");
const page = read("app/safisa/page.tsx");
const markAllReadyMigration = read(
  "supabase/migrations/20260827140000_safisa_mark_all_order_ready.sql",
);
const automaticLifecycleMigration = read(
  "supabase/migrations/20260807235900_automatic_safisa_order_lifecycle.sql",
);
const markAllReadyLifecycleFix = read(
  "supabase/migrations/20260828234000_safisa_mark_all_ready_automatic_lifecycle.sql",
);

test("portal uses a separate server-side membership guard", () => {
  assert.match(auth, /listSafisaOrders\(supabase\)/);
  assert.doesNotMatch(auth, /requireActiveProfile/);
  assert.doesNotMatch(auth, /\.eq\("is_active", true\)/);
  assert.match(proxy, /pathname\.startsWith\("\/safisa"\)/);
  assert.match(proxy, /"\/safisa\/login"/);
});

test("mutations call only fixed Safisa readiness RPCs", () => {
  assert.equal((actions.match(/\.rpc\("increment_safisa_ready_quantity"/g) ?? []).length, 2);
  assert.equal((actions.match(/\.rpc\("correct_safisa_ready_quantity"/g) ?? []).length, 1);
  assert.equal((actions.match(/\.rpc\("mark_safisa_order_remaining_ready"/g) ?? []).length, 1);
  assert.doesNotMatch(actions, /rpcName|tableName|service_role|SUPABASE_SERVICE/);
  assert.match(portal, /crypto\.randomUUID\(\)/);
  assert.match(actions, /p_idempotency_key: input\.idempotencyKey/);
});

test("mark remaining reloads official order and calculates a delta", () => {
  const section = actions.slice(
    actions.indexOf("export async function markSafisaRemainingReady"),
    actions.indexOf("export async function markSafisaOrderRemainingReady"),
  );
  assert.match(section, /getSafisaOrder\(supabase, input\.supplierOrderId\)/);
  assert.match(section, /p_increment_quantity: line\.waitingReadyQuantity/);
  assert.doesNotMatch(section, /ready_quantity\s*:/);
});

test("correction validates version, confirmation and justification", () => {
  assert.match(actions, /line\.updatedAt !== input\.expectedUpdatedAt/);
  assert.match(actions, /p_confirmed: true/);
  assert.match(actions, /p_expected_updated_at: line\.updatedAt/);
  assert.match(actions, /input\.justification\.trim\(\)/);
  assert.match(actions, /status: "conflict"/);
});

test("client prevents double submit and exposes accessible states", () => {
  assert.match(portal, /if \(isPending \|\| operationLock\.current\) return/);
  assert.match(portal, /operationLock\.current/);
  assert.match(portal, /disabled=\{isPending\}/);
  assert.match(portal, /aria-live="polite"/);
  assert.match(portal, /role="dialog"/);
  assert.match(portal, /aria-modal="true"/);
  assert.match(portal, /Informar quantidade/);
  assert.match(portal, /Dar todo o Pedido como pronto/);
  assert.match(portal, /Concluir este item/);
  assert.match(portal, /Corrigir quantidade pronta/);
});

test("mobile turns a selected order into a focused operational view", () => {
  assert.match(portal, /selectedOrder && "hidden lg:block"/);
  assert.match(portal, /← Todos os pedidos/);
  assert.match(portal, /lg:grid-cols-\[22rem_minmax\(0,1fr\)\]/);
});

test("order navigation provides immediate feedback and warms the selected detail", () => {
  assert.match(portal, /router\.prefetch\(orderHref\(orderId\)\)/);
  assert.match(portal, /onPointerEnter=\{\(\) => warmOrder/);
  assert.match(portal, /onTouchStart=\{\(\) => warmOrder/);
  assert.match(portal, /openingOrderId/);
});

test("opening a selected order overlaps its detail read with completed-list loading", () => {
  assert.match(page, /const completedOrderListPromise = listSafisaOrders\(supabase, "COMPLETED"\)/);
  assert.match(page, /selectedOrder = await getSafisaOrder\(supabase, pedido\)/);
  assert.match(page, /const completedOrderList = await completedOrderListPromise/);
  assert.match(page, /events: \[\]/);
});

test("mark all ready is a confirmed order-level action above the line controls", () => {
  assert.match(portal, /kind: "order"/);
  assert.match(portal, /Dar todo o Pedido como pronto/);
  assert.match(portal, /Dar todo o Pedido como pronto\?/);
  assert.match(portal, /pendingLineCount/);
  assert.ok(
    portal.indexOf("Dar todo o Pedido como pronto") <
      portal.indexOf("Concluir este item"),
  );
  assert.match(actions, /p_increment_quantity: line\.waitingReadyQuantity/);
  assert.match(actions, /markSafisaOrderRemainingReady/);
  assert.match(actions, /mark_safisa_order_remaining_ready/);
});

test("mark all ready reuses the official order reader before the bulk RPC", () => {
  const section = actions.slice(
    actions.indexOf("export async function markSafisaOrderRemainingReady"),
    actions.indexOf("export async function correctSafisaReadyQuantity"),
  );
  assert.match(section, /getSafisaOrder\(supabase, input\.supplierOrderId\)/);
  assert.match(section, /if \(order\.isReadOnly\)/);
  assert.ok(
    section.indexOf("getSafisaOrder") <
      section.indexOf('.rpc("mark_safisa_order_remaining_ready"'),
  );
});

test("mark all ready is atomic, idempotent, audited, and Safisa-only", () => {
  assert.match(
    markAllReadyMigration,
    /create function private\.mark_safisa_order_remaining_ready\([\s\S]*?security invoker[\s\S]*?set search_path = ''/i,
  );
  assert.match(
    markAllReadyMigration,
    /create function public\.mark_safisa_order_remaining_ready\([\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  );
  assert.match(markAllReadyMigration, /private\.require_active_safisa_member\(\)/);
  assert.match(markAllReadyMigration, /private\.safisa_portal_existing_result\(/);
  assert.match(markAllReadyMigration, /for update;/i);
  assert.match(markAllReadyMigration, /order by order_item\.id[\s\S]*?for update;/i);
  assert.match(
    markAllReadyMigration,
    /update public\.supplier_order_items[\s\S]*?set ready_quantity = ordered_quantity - cancelled_quantity/i,
  );
  assert.match(markAllReadyMigration, /READY_QUANTITIES_ALL_MARKED/);
  assert.match(
    markAllReadyMigration,
    /grant execute on function public\.mark_safisa_order_remaining_ready[\s\S]*?to authenticated/i,
  );
  assert.doesNotMatch(markAllReadyMigration, /service_role|insert into public\.supplier_orders/i);
});

test("bulk readiness follows the automatic lifecycle without a legacy authorization row", () => {
  assert.match(
    automaticLifecycleMigration,
    /membership is still mandatory, but a per-order authorization is no longer[\s\S]*?required to report readiness/i,
  );
  assert.match(
    markAllReadyLifecycleFix,
    /create or replace function private\.mark_safisa_order_remaining_ready\([\s\S]*?security invoker[\s\S]*?set search_path = ''/i,
  );
  assert.doesNotMatch(markAllReadyLifecycleFix, /safisa_order_authorizations/i);
  assert.match(markAllReadyLifecycleFix, /private\.safisa_portal_existing_result\(/);
  assert.match(markAllReadyLifecycleFix, /for update;/i);
  assert.match(markAllReadyLifecycleFix, /order by order_item\.id[\s\S]*?for update;/i);
  assert.match(
    markAllReadyLifecycleFix,
    /update public\.supplier_order_items[\s\S]*?set ready_quantity = ordered_quantity - cancelled_quantity/i,
  );
  assert.match(markAllReadyLifecycleFix, /READY_QUANTITIES_ALL_MARKED/);
  assert.match(markAllReadyLifecycleFix, /A closed supplier order cannot change ready quantities/);
  assert.doesNotMatch(markAllReadyLifecycleFix, /service_role|disable row level security/i);
});

test("Safisa mutation errors distinguish authentication, membership, authorization, and technical denial", () => {
  assert.equal(
    mapSafisaMutationError({ code: "28000" }).message,
    "Sua sessão não está válida. Entre novamente.",
  );
  assert.equal(
    mapSafisaMutationError({
      code: "42501",
      message: "An active Safisa portal membership with a registered name is required.",
    }).message,
    "Seu acesso ao Portal Safisa não está ativo.",
  );
  assert.equal(
    mapSafisaMutationError({
      code: "42501",
      message: "The supplier order is not authorized for the Safisa portal.",
    }).message,
    "Este pedido não está disponível para operação no Portal Safisa.",
  );
  assert.equal(
    mapSafisaMutationError({ code: "42501", message: "permission denied for relation" }).message,
    "Não foi possível autorizar esta operação. Tente novamente.",
  );
  assert.notEqual(
    mapSafisaMutationError({ code: "42501", message: "permission denied for relation" }).message,
    "Seu acesso ao Portal Safisa não está ativo.",
  );
});

test("partially ready lines with all current ready units picked remain partial", () => {
  assert.equal(readinessLabel("PARTIALLY_READY", 3, 3), "Retirada parcial");
  assert.equal(readinessLabel("COMPLETELY_READY", 10, 10), "Retirado");
});

test("a rejected action releases its lock and renders a safe retry message", () => {
  assert.match(portal, /try \{/);
  assert.match(portal, /catch \{/);
  assert.match(portal, /finally \{/);
  assert.match(portal, /Verifique sua conexão e tente novamente/);
  assert.match(portal, /operationLock\.current = false/);
  assert.match(portal, /setActiveLineId\(null\)/);
});

test("correction uses the current non-cancelled ready ceiling", () => {
  assert.equal(maximumReadyQuantity(3, 5), 8);
  assert.match(portal, /max=\{maximumReadyQuantity\(line\.readyQuantity, line\.waitingReadyQuantity\)\}/);
  assert.match(actions, /const maximum = maximumReadyQuantity\(line\.readyQuantity, line\.waitingReadyQuantity\)/);
  assert.match(actions, /entre \$\{line\.pickedQuantity\} e \$\{maximum\}/);
});

test("closed orders remain readable and do not render mutation controls", () => {
  assert.match(portal, /selectedOrder\.isReadOnly/);
  assert.match(portal, /somente para consulta/);
  assert.match(portal, /!selectedOrder\.isReadOnly && line\.waitingReadyQuantity > 0/);
});
