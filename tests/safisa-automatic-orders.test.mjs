import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20260807235900_automatic_safisa_order_lifecycle.sql");
const portal = read("components/safisa-portal.tsx");
const data = read("lib/safisa-portal-data.ts");
const actions = read("app/(authenticated)/pedidos/actions.ts");
const workspace = read("app/(authenticated)/pedidos/orders-workspace.tsx");

test("creates semantic Safisa readers without authorization-based visibility", () => {
  assert.match(sql, /create function public\.list_safisa_orders\(/i);
  assert.match(sql, /create function public\.get_safisa_order\(/i);
  const readerSection = sql.slice(0, sql.indexOf("create or replace function public.list_safisa_ready_pickup_alerts"));
  assert.doesNotMatch(readerSection, /join public\.safisa_order_authorizations/i);
  assert.match(readerSection, /summary\.cancelled_at is null/i);
  assert.match(readerSection, /waiting_pickup_quantity > 0/i);
  assert.match(readerSection, /waiting_pickup_quantity = 0/i);
  assert.match(sql, /deprecated compatibility reader/i);
  assert.match(data, /\.rpc\("list_safisa_orders"/);
  assert.match(data, /\.rpc\("get_safisa_order"/);
});

test("makes readiness enforcement universal and preserves canonical safety", () => {
  const pickupSection = sql.slice(sql.indexOf("create or replace function private.set_supplier_order_item_picked_quantity"));
  assert.match(pickupSection, /p_picked_quantity > v_line\.ready_quantity/i);
  assert.match(pickupSection, /set picked_quantity = ready_quantity/i);
  assert.doesNotMatch(pickupSection, /v_is_safisa_managed|greatest\(v_line\.ready_quantity, p_picked_quantity\)/i);
  assert.match(pickupSection, /private\.supplier_order_existing_result/i);
  assert.match(pickupSection, /for update/i);
  assert.match(pickupSection, /insert into public\.supplier_order_events/i);
});

test("keeps legacy authorizations but removes them from alerts", () => {
  const alertSection = sql.slice(
    sql.indexOf("create or replace function public.list_safisa_ready_pickup_alerts"),
    sql.indexOf("-- Replace the temporary legacy compatibility branch"),
  );
  assert.doesNotMatch(alertSection, /safisa_order_authorizations/i);
  assert.match(alertSection, /supplier_order\.cancelled_at is null/i);
  assert.match(alertSection, /ready_quantity > order_item\.picked_quantity/i);
  assert.doesNotMatch(sql, /delete\s+from public\.safisa_order_authorizations/i);
});

test("blocks logical cancellation with ready units awaiting pickup and keeps audit", () => {
  const cancellationSection = sql.slice(sql.indexOf("-- Cancellation is logical"));
  assert.match(cancellationSection, /ready_quantity > picked_quantity/i);
  assert.match(cancellationSection, /A cancellation reason is required/i);
  assert.match(cancellationSection, /insert into public\.supplier_order_events/i);
  assert.match(actions, /unidades informadas como prontas e ainda não retiradas/i);
  assert.match(workspace, /Excluir pedido/);
  assert.match(workspace, /Este pedido será removido das listas ativas e mantido no histórico\./);
});

test("portal exposes active and completed lists while completed orders are read-only", () => {
  assert.match(portal, /Em andamento/);
  assert.match(portal, /Concluídos/);
  assert.match(portal, /selectedOrder\?\.portalState/);
  assert.match(portal, /!selectedOrder\.isReadOnly/);
  assert.match(data, /portal_state/);
});

test("contains no deployment command, remote target, or production identity", () => {
  assert.doesNotMatch(sql, /supabase\s+(db push|migration repair|db reset)/i);
  assert.doesNotMatch(sql, /isdjboconmwaqipjrjvp/i);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});
