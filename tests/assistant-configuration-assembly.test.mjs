import assert from "node:assert/strict";
import test from "node:test";

import { routeConfigurationAssemblyAction } from "../lib/ai/configuration-assembly-routing.ts";
import {
  createConfigurationAssemblyProposalToken,
  verifyConfigurationAssemblyProposalToken,
} from "../lib/ai/configuration-assembly-action-token.ts";
import {
  ASSISTANT_CONFIGURATION_ASSEMBLY_DESCRIPTION,
  calculateConfigurationAssemblyProjection,
  configurationAssemblyProfileHasName,
} from "../lib/ai/configuration-assembly-contract.ts";
import { createManualStockOutputProposalToken } from "../lib/ai/manual-stock-output-action-token.ts";
import { expireStockEntryPreview } from "../lib/ai/assistant-action-persistence.ts";
import { handleStockEntryActionRequest } from "../lib/ai/stock-entry-http-contract.ts";

const secret = "local-test-secret-with-at-least-thirty-two-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const codeId = "22222222-2222-4222-8222-222222222222";
const configurationId = "33333333-3333-4333-8333-333333333333";
const key = "77777777-7777-4777-8777-777777777777";
const now = new Date("2026-08-04T12:00:00.000Z");

test("roteia montagens determinísticas sem incluir qualificadores no alvo", () => {
  const cases = [
    ["Monte 2 do Cód. 1H.", "1H", 2],
    ["Monte 1 Servo com kit Cód. 1H.", "1H", 1],
    ["Monte 3 Servos com kit, 1B.", "1B", 3],
    ["Faça a montagem de 4 unidades do código 2A.", "2A", 4],
    ["Realize a montagem de 1 caixa completa 1D.", "1D", 1],
  ];
  for (const [phrase, targetQuery, quantity] of cases) {
    const route = routeConfigurationAssemblyAction(phrase);
    assert.equal(route.kind, "ACTION", phrase);
    assert.equal(route.request.targetQuery, targetQuery, phrase);
    assert.equal(route.request.quantity, quantity, phrase);
  }
});

test("montagem rejeita quantidade inválida e não intercepta desmontagem", () => {
  assert.equal(routeConfigurationAssemblyAction("Monte 0 unidades do 1H.").kind, "INVALID");
  assert.equal(routeConfigurationAssemblyAction("Monte -2 unidades do 1H.").kind, "INVALID");
  assert.equal(routeConfigurationAssemblyAction("Desmonte 1 do Cód. 1H.").kind, "NOT_CONFIGURATION_ASSEMBLY");
});

test("texto de confirmação e cancelamento nunca executam", () => {
  for (const phrase of ["sim", "confirme", "pode montar", "execute", "ok"]) {
    assert.equal(routeConfigurationAssemblyAction(phrase).kind, "BUTTON_CONFIRMATION_TEXT", phrase);
  }
  assert.equal(routeConfigurationAssemblyAction("Cancelar esta montagem.").kind, "CANCEL");
});

test("token é estrito, assinado, vinculado ao usuário e expira", () => {
  const signed = createConfigurationAssemblyProposalToken({ userId, commercialCodeId: codeId,
    configurationId, quantity: 2, idempotencyKey: key }, secret, now);
  assert.ok(signed);
  assert.equal(signed.payload.action, "configuration_assembly");
  assert.equal(verifyConfigurationAssemblyProposalToken(signed.token, secret, userId, now).ok, true);
  assert.equal(verifyConfigurationAssemblyProposalToken(signed.token, secret, codeId, now).reason, "user_mismatch");
  assert.equal(verifyConfigurationAssemblyProposalToken(`${signed.token}x`, secret, userId, now).reason, "invalid");
  assert.equal(verifyConfigurationAssemblyProposalToken(signed.token, secret, userId,
    new Date(now.getTime() + 601_000)).reason, "expired");
});

test("token de saída não é aceito como token de montagem", () => {
  const output = createManualStockOutputProposalToken({ userId, idempotencyKey: key,
    lines: [{ kind: "COMMERCIAL_CODE", targetId: codeId, quantity: 1 }] }, secret, now);
  assert.ok(output);
  assert.equal(verifyConfigurationAssemblyProposalToken(output.token, secret, userId, now).reason, "invalid");
});

test("descrição é constante server-side e perfil exige nome", () => {
  assert.equal(ASSISTANT_CONFIGURATION_ASSEMBLY_DESCRIPTION, "Montagem confirmada pela Assistente NK.");
  assert.equal(configurationAssemblyProfileHasName("Henrique"), true);
  assert.equal(configurationAssemblyProfileHasName("   "), false);
  assert.equal(configurationAssemblyProfileHasName(null), false);
});

test("projeção consome um Servo e um Kit por montagem", () => {
  assert.deepEqual(calculateConfigurationAssemblyProjection(4, 3, 5, 2), {
    capacity: 3, sufficient: true, mountedStockAfter: 6, servoStockAfter: 1, installationKitStockAfter: 3,
  });
  assert.equal(calculateConfigurationAssemblyProjection(4, 1, 5, 2).sufficient, false);
  assert.equal(calculateConfigurationAssemblyProjection(2_147_483_647, 1, 1, 1).sufficient, false);
});

test("handler chama exatamente uma confirmação e preserva sucesso com warning", async () => {
  let confirms = 0;
  const response = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/configuration-assembly", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def" }),
  }), {
    confirm: async () => { confirms += 1; return { block: { outcome: "success", refreshWarning: false } }; },
    revalidate: async () => { throw new Error("refresh"); }, isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: (result) => ({ ...result, block: { ...result.block, refreshWarning: true } }),
    fallback: () => ({ block: { outcome: "error", refreshWarning: false } }),
  });
  assert.equal(confirms, 1);
  assert.equal((await response.json()).block.refreshWarning, true);
});

test("body com campos operacionais extras é rejeitado antes da confirmação", async () => {
  let confirms = 0;
  const response = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/configuration-assembly", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def", rpcName: "assemble_commercial_configuration" }),
  }), { confirm: async () => { confirms += 1; return {}; }, revalidate: () => {}, isSuccess: () => false,
    addRefreshWarning: (value) => value, fallback: () => ({}) });
  assert.equal(response.status, 400);
  assert.equal(confirms, 0);
});

test("prévia persistida expira e perde o token", () => {
  const component = { id: codeId, code: "1", description: "SERVO MBF-015", currentStock: 3 };
  const target = { commercialCodeId: codeId, configurationId, displayCode: "1H", aliases: ["1H"],
    description: "SERVO MBF-015 Deslocado + KT-29", currentStock: 4, capacity: 3,
    servo: component, installationKit: { ...component, id: key, code: "KT-29", description: "KIT KT-29" } };
  const block = { kind: "configuration_assembly_preview", action: "configuration_assembly", state: "pending",
    title: "Confirmar montagem", message: "Revalidar.", proposalToken: "abc.def", expiresAt: now.toISOString(),
    target, quantity: 2, mountedStockAfter: 6, servoStockAfter: 1, installationKitStockAfter: 1,
    totalQuantity: 2, confirmLabel: "Confirmar montagem", cancelLabel: "Cancelar", regeneratePrompt: "Monte 2 do Cód. 1H." };
  const expired = expireStockEntryPreview(block);
  assert.equal(expired.state, "expired");
  assert.equal(expired.proposalToken, null);
  assert.equal(expired.expiresAt, null);
});
