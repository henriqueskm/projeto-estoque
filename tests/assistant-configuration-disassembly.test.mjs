import assert from "node:assert/strict";
import test from "node:test";

import { routeConfigurationDisassemblyAction } from "../lib/ai/configuration-disassembly-routing.ts";
import {
  createConfigurationDisassemblyProposalToken,
  verifyConfigurationDisassemblyProposalToken,
} from "../lib/ai/configuration-disassembly-action-token.ts";
import {
  ASSISTANT_CONFIGURATION_DISASSEMBLY_DESCRIPTION,
  calculateConfigurationDisassemblyProjection,
  configurationDisassemblyProfileHasName,
} from "../lib/ai/configuration-disassembly-contract.ts";
import { createConfigurationAssemblyProposalToken } from "../lib/ai/configuration-assembly-action-token.ts";
import { expireStockEntryPreview } from "../lib/ai/assistant-action-persistence.ts";
import { handleStockEntryActionRequest } from "../lib/ai/stock-entry-http-contract.ts";

const secret = "local-test-secret-with-at-least-thirty-two-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const codeId = "22222222-2222-4222-8222-222222222222";
const configurationId = "33333333-3333-4333-8333-333333333333";
const key = "77777777-7777-4777-8777-777777777777";
const now = new Date("2026-08-08T12:00:00.000Z");

test("roteia desmontagem e preserva somente o alvo comercial", () => {
  for (const [phrase, targetQuery, quantity] of [
    ["Desmonte 2 do 11E", "11E", 2],
    ["Desmontar 1 Servo com kit Cód. 11A", "11A", 1],
    ["Quero desmontar 3 unidades do código X", "X", 3],
    ["Desmonte uma unidade do Cód. 1H", "1H", 1],
  ]) {
    const route = routeConfigurationDisassemblyAction(phrase);
    assert.equal(route.kind, "ACTION", phrase);
    assert.equal(route.request.targetQuery, targetQuery, phrase);
    assert.equal(route.request.quantity, quantity, phrase);
  }
});

test("referência contextual fica marcada para resolução server-side", () => {
  const route = routeConfigurationDisassemblyAction("Desmonte uma unidade dessa configuração");
  assert.equal(route.kind, "ACTION");
  assert.equal(route.request.contextual, true);
  assert.equal(route.request.targetQuery, "");
});

test("não confunde montar com desmontar e texto não executa", () => {
  assert.equal(routeConfigurationDisassemblyAction("Monte 1 do Cód. 1H").kind, "NOT_CONFIGURATION_DISASSEMBLY");
  assert.equal(routeConfigurationDisassemblyAction("Desmonte 0 unidades do 1H").kind, "INVALID");
  for (const phrase of ["sim", "confirme", "pode desmontar", "execute", "ok"]) {
    assert.equal(routeConfigurationDisassemblyAction(phrase).kind, "BUTTON_CONFIRMATION_TEXT", phrase);
  }
  assert.equal(routeConfigurationDisassemblyAction("Cancelar esta desmontagem.").kind, "CANCEL");
});

test("token é estrito, assinado, vinculado ao usuário e expira", () => {
  const signed = createConfigurationDisassemblyProposalToken({ userId, commercialCodeId: codeId,
    configurationId, quantity: 2, idempotencyKey: key }, secret, now);
  assert.ok(signed);
  assert.equal(signed.payload.action, "configuration_disassembly");
  assert.equal(verifyConfigurationDisassemblyProposalToken(signed.token, secret, userId, now).ok, true);
  assert.equal(verifyConfigurationDisassemblyProposalToken(signed.token, secret, codeId, now).reason, "user_mismatch");
  assert.equal(verifyConfigurationDisassemblyProposalToken(`${signed.token}x`, secret, userId, now).reason, "invalid");
  assert.equal(verifyConfigurationDisassemblyProposalToken(signed.token, secret, userId,
    new Date(now.getTime() + 601_000)).reason, "expired");
});

test("token de montagem não é aceito como desmontagem", () => {
  const assembly = createConfigurationAssemblyProposalToken({ userId, commercialCodeId: codeId,
    configurationId, quantity: 1, idempotencyKey: key }, secret, now);
  assert.ok(assembly);
  assert.equal(verifyConfigurationDisassemblyProposalToken(assembly.token, secret, userId, now).reason, "invalid");
});

test("descrição fixa, perfil e projeção preservam o contrato", () => {
  assert.equal(ASSISTANT_CONFIGURATION_DISASSEMBLY_DESCRIPTION, "Desmontagem confirmada pela Assistente NK.");
  assert.equal(configurationDisassemblyProfileHasName("Henrique"), true);
  assert.equal(configurationDisassemblyProfileHasName("   "), false);
  assert.deepEqual(calculateConfigurationDisassemblyProjection(5, 3, 4, 2), {
    sufficient: true, mountedStockAfter: 3, servoStockAfter: 5, installationKitStockAfter: 6,
  });
  assert.equal(calculateConfigurationDisassemblyProjection(1, 3, 4, 2).sufficient, false);
});

test("handler confirma uma vez, preserva sucesso com warning e rejeita payload livre", async () => {
  let confirms = 0;
  const success = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/configuration-disassembly", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def" }),
  }), {
    confirm: async () => { confirms += 1; return { block: { outcome: "success", refreshWarning: false } }; },
    revalidate: async () => { throw new Error("refresh"); }, isSuccess: (result) => result.block.outcome === "success",
    addRefreshWarning: (result) => ({ ...result, block: { ...result.block, refreshWarning: true } }), fallback: () => ({ block: { outcome: "error" } }),
  });
  assert.equal(confirms, 1);
  assert.equal((await success.json()).block.refreshWarning, true);
  const invalid = await handleStockEntryActionRequest(new Request("https://nk.local/api/assistant/actions/configuration-disassembly", {
    method: "POST", headers: { Origin: "https://nk.local", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ proposalToken: "abc.def", rpcName: "disassemble_commercial_configuration" }),
  }), { confirm: async () => { confirms += 1; return {}; }, revalidate: () => {}, isSuccess: () => false, addRefreshWarning: (value) => value, fallback: () => ({}) });
  assert.equal(invalid.status, 400);
  assert.equal(confirms, 1);
});

test("prévia persistida expira e não mantém token", () => {
  const component = { id: codeId, code: "11", description: "SERVO AL-10", currentStock: 3 };
  const target = { commercialCodeId: codeId, configurationId, displayCode: "11E", aliases: ["11E"],
    description: "SERVO AL-10 + KT-11E", currentStock: 4, capacity: 3,
    servo: component, installationKit: { ...component, id: key, code: "KT-11E", description: "KIT KT-11E" } };
  const block = { kind: "configuration_disassembly_preview", action: "configuration_disassembly", state: "pending",
    title: "Confirmar desmontagem", message: "Revalidar.", proposalToken: "abc.def", expiresAt: now.toISOString(), target,
    quantity: 2, mountedStockAfter: 2, servoStockAfter: 5, installationKitStockAfter: 5, totalQuantity: 2,
    confirmLabel: "Confirmar desmontagem", cancelLabel: "Cancelar", regeneratePrompt: "Desmonte 2 do Cód. 11E." };
  const expired = expireStockEntryPreview(block);
  assert.equal(expired.state, "expired");
  assert.equal(expired.proposalToken, null);
  assert.equal(expired.expiresAt, null);
});
