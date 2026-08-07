import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  maximumReadyQuantity,
  readinessLabel,
} from "../lib/safisa-portal-readiness.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const actions = read("app/safisa/actions.ts");
const proxy = read("lib/supabase/proxy.ts");
const portal = read("components/safisa-portal.tsx");
const auth = read("lib/safisa-auth.ts");

test("portal uses a separate server-side membership guard", () => {
  assert.match(auth, /listSafisaOrders\(supabase\)/);
  assert.doesNotMatch(auth, /requireActiveProfile/);
  assert.doesNotMatch(auth, /\.eq\("is_active", true\)/);
  assert.match(proxy, /pathname\.startsWith\("\/safisa"\)/);
  assert.match(proxy, /"\/safisa\/login"/);
});

test("mutations call only the two fixed Safisa readiness RPCs", () => {
  assert.equal((actions.match(/\.rpc\("increment_safisa_ready_quantity"/g) ?? []).length, 2);
  assert.equal((actions.match(/\.rpc\("correct_safisa_ready_quantity"/g) ?? []).length, 1);
  assert.doesNotMatch(actions, /rpcName|tableName|service_role|SUPABASE_SERVICE/);
  assert.match(portal, /crypto\.randomUUID\(\)/);
  assert.match(actions, /p_idempotency_key: input\.idempotencyKey/);
});

test("mark remaining reloads official order and calculates a delta", () => {
  const section = actions.slice(actions.indexOf("export async function markSafisaRemainingReady"), actions.indexOf("export async function correctSafisaReadyQuantity"));
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
  assert.match(portal, /Informar como pronto/);
  assert.match(portal, /Corrigir quantidade pronta/);
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
