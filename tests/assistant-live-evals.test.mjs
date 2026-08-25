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

function configuredLiveEval(overrides = {}) {
  return resolveAssistantLiveEvalConfig({
    apiKey: "local-test-key",
    enabled: true,
    minimumIntervalMs: 0,
    ...overrides,
  });
}

function providerError(status, message, retryAfter) {
  const error = new Error(message);
  error.status = status;
  if (retryAfter) error.headers = { "retry-after": String(retryAfter) };
  return error;
}

function runtimeWithRecordedSleeps() {
  const sleeps = [];
  return {
    sleeps,
    runtime: {
      now: () => 0,
      random: () => 0,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  };
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
  const config = configuredLiveEval();
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
  assert.equal(report.observedProviderSemanticQuality, 100);
  assert.equal(report.evaluationCoveragePercent, 100);
  assert.equal(report.safetyPassRate, 100);
  assert.equal("answer" in report.results[0], false);
});

test("modo limit avalia somente o lote solicitado e não declara qualidade completa", async () => {
  const config = configuredLiveEval({ limit: 3 });
  const report = await runAssistantLiveEvaluation({
    config,
    provider: {
      async answer() {
        return JSON.stringify({ answer: "Posso mostrar uma prévia segura para revisão." });
      },
      async judge(caseItem) {
        return judgmentFor(caseItem);
      },
    },
  });
  assert.equal(report.total, 3);
  assert.equal(report.availableCases, 37);
  assert.equal(report.evaluatedCases, 3);
  assert.equal(report.evaluationCoveragePercent, 8.1);
  assert.equal(report.observedProviderSemanticQuality, 100);
  assert.equal(report.providerSemanticQuality, null);
  assert.equal(report.status, "inconclusive");
});

test("live eval bloqueia alegação operacional antes do juiz", async () => {
  const config = configuredLiveEval();
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

test("429 aplica retry limitado, respeita retry-after e não vira falha de safety", async () => {
  const { runtime, sleeps } = runtimeWithRecordedSleeps();
  let calls = 0;
  const report = await runAssistantLiveEvaluation({
    config: configuredLiveEval({ limit: 1 }),
    runtime,
    provider: {
      async answer() {
        calls += 1;
        throw providerError(429, "rate limit exceeded", 2);
      },
      async judge() {
        throw new Error("Não deve chegar ao juiz.");
      },
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [2_000, 2_000]);
  assert.equal(report.status, "inconclusive");
  assert.equal(report.failed, 0);
  assert.equal(report.notEvaluatedCases, 1);
  assert.equal(report.safetyPassRate, null);
  assert.equal(report.infrastructureFailures, 1);
  assert.deepEqual(report.results[0].failureCodes, ["PROVIDER_RATE_LIMITED"]);
  assert.deepEqual(report.results[0].providerError, {
    httpStatus: 429,
    code: "rate_limit_exceeded",
    retryAfterSeconds: 2,
  });
});

test("429 de quota preserva a classificação sanitizada", async () => {
  const { runtime } = runtimeWithRecordedSleeps();
  const report = await runAssistantLiveEvaluation({
    config: configuredLiveEval({ limit: 1 }),
    runtime,
    provider: {
      async answer() {
        throw providerError(429, "resource exhausted: quota exceeded Authorization secret-value");
      },
      async judge() {
        throw new Error("Não deve chegar ao juiz.");
      },
    },
  });
  assert.deepEqual(report.results[0].failureCodes, ["PROVIDER_QUOTA_EXCEEDED"]);
  assert.deepEqual(report.results[0].providerError, {
    httpStatus: 429,
    code: "quota_exceeded",
  });
  assert.equal(JSON.stringify(report).includes("secret-value"), false);
});

test("503 e timeout fazem retry limitado com backoff; 401 e 400 não", async (t) => {
  for (const scenario of [
    { name: "503", error: providerError(503, "service unavailable"), expectedCode: "PROVIDER_SERVICE_UNAVAILABLE", calls: 3, sleeps: [1_000, 2_000] },
    { name: "timeout", error: new Error("request timed out"), expectedCode: "PROVIDER_TIMEOUT", calls: 3, sleeps: [1_000, 2_000] },
    { name: "401", error: providerError(401, "authentication failed"), expectedCode: "PROVIDER_AUTH_ERROR", calls: 1, sleeps: [] },
    { name: "400", error: providerError(400, "invalid request"), expectedCode: "PROVIDER_INVALID_REQUEST", calls: 1, sleeps: [] },
  ]) {
    await t.test(scenario.name, async () => {
      const { runtime, sleeps } = runtimeWithRecordedSleeps();
      let calls = 0;
      const report = await runAssistantLiveEvaluation({
        config: configuredLiveEval({ limit: 1 }),
        runtime,
        provider: {
          async answer() {
            calls += 1;
            throw scenario.error;
          },
          async judge() {
            throw new Error("Não deve chegar ao juiz.");
          },
        },
      });
      assert.equal(calls, scenario.calls);
      assert.deepEqual(sleeps, scenario.sleeps);
      assert.equal(report.results[0].failureCodes[0], scenario.expectedCode);
      assert.equal(report.results[0].safety, "NOT_EVALUATED");
      assert.equal(report.failed, 0);
    });
  }
});

test("falha de infraestrutura mantém avaliação e safety já confirmadas sem falso zero", async () => {
  const config = configuredLiveEval({ limit: 2 });
  let answerCalls = 0;
  const report = await runAssistantLiveEvaluation({
    config,
    runtime: runtimeWithRecordedSleeps().runtime,
    provider: {
      async answer() {
        answerCalls += 1;
        if (answerCalls >= 2) throw providerError(503, "service unavailable");
        return JSON.stringify({ answer: "Posso mostrar uma prévia segura para revisão." });
      },
      async judge(caseItem) {
        return judgmentFor(caseItem);
      },
    },
  });
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.evaluatedCases, 1);
  assert.equal(report.infrastructureFailures, 1);
  assert.equal(report.safetyEvaluatedCases, 1);
  assert.equal(report.safetyPassRate, 100);
  assert.equal(report.providerSemanticQuality, null);
  assert.equal(report.status, "inconclusive");
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
