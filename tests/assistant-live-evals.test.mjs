import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assistantLiveEvalCases } from "../evals/assistant/live-cases.ts";
import {
  resolveAssistantLiveEvalConfig,
  runAssistantLiveEvaluation,
} from "../evals/assistant/run-live.ts";

function judgmentFor(caseItem) {
  const scores = Object.fromEntries([
    "correctness",
    "context",
    "clarity",
    "naturalness",
    "conciseness",
    "nonHallucination",
  ].map((dimension) => [
    dimension,
    dimension === "context" && caseItem.contextRequirement === "NOT_APPLICABLE"
      ? null
      : { score: 5, rationale: "A resposta atende ao contrato sintético." },
  ]));
  return JSON.stringify({ safety: "PASS", scores, failureCodes: [] });
}

test("live eval sem chave ou ativação explícita não chama provider", async () => {
  const missing = resolveAssistantLiveEvalConfig({ apiKey: null, enabled: true });
  assert.equal(missing.reason, "missing_api_key");
  const missingReport = await runAssistantLiveEvaluation({ config: missing });
  assert.equal(missingReport.status, "not_configured");
  assert.equal(missingReport.results.length, 0);

  const disabled = resolveAssistantLiveEvalConfig({ apiKey: "local-test-key", enabled: false });
  assert.equal(disabled.reason, "explicit_activation_required");
  const disabledReport = await runAssistantLiveEvaluation({ config: disabled });
  assert.equal(disabledReport.status, "not_configured");
});

test("live eval usa fixture sintética, score separado e não armazena respostas cruas", async () => {
  const config = resolveAssistantLiveEvalConfig({ apiKey: "local-test-key", enabled: true });
  let answerCalls = 0;
  let judgeCalls = 0;
  const report = await runAssistantLiveEvaluation({
    config,
    provider: {
      async answer() {
        answerCalls += 1;
        return JSON.stringify({ answer: "Há uma prévia para revisão. Use o botão Confirmar quando estiver pronto." });
      },
      async judge(caseItem) {
        judgeCalls += 1;
        return judgmentFor(caseItem);
      },
    },
  });
  assert.equal(assistantLiveEvalCases.length, 37);
  assert.equal(answerCalls, 37);
  assert.equal(judgeCalls, 37);
  assert.equal(report.status, "passed");
  assert.equal(report.providerSemanticQuality, 100);
  assert.equal(report.safetyPassRate, 100);
  assert.equal("answer" in report.results[0], false);
});

test("live eval bloqueia alegação operacional antes do juiz", async () => {
  const config = resolveAssistantLiveEvalConfig({ apiKey: "local-test-key", enabled: true });
  const report = await runAssistantLiveEvaluation({
    config,
    provider: {
      async answer() {
        return JSON.stringify({ answer: "A entrada foi concluída." });
      },
      async judge() {
        throw new Error("O juiz não pode ser chamado após uma alegação insegura.");
      },
    },
  });
  assert.equal(report.status, "failed");
  assert.equal(report.safetyPassRate, 0);
  assert.equal(report.results.every((result) => result.failureCodes.includes("UNSAFE_PROVIDER_OUTPUT")), true);
});

test("runner live fica isolado de handlers, Supabase e ações operacionais", async () => {
  const runner = await readFile(new URL("../evals/assistant/run-live.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "app/api/assistant",
    "lib/ai/assistant.ts",
    "createClient",
    ".rpc(",
    "createProposalToken",
    "confirmAssistant",
    "supabase",
  ]) {
    assert.equal(runner.includes(forbidden), false, `${forbidden} não pode entrar no runner live.`);
  }
  assert.equal(runner.includes('store: false'), true);
  assert.equal(runner.includes('tool_choice: "none"'), true);
  assert.equal(runner.includes("maxRetries: 0"), true);
});
