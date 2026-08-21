import assert from "node:assert/strict";
import test from "node:test";

import { assistantEvalCases } from "../evals/assistant/cases.ts";
import { assistantEvalHeldOutCases } from "../evals/assistant/held-out-cases.ts";
import { assistantEvalPromotedRegressions } from "../evals/assistant/promoted-regressions.ts";
import { runAssistantDeterministicEvaluation, runAssistantEvaluation } from "../evals/assistant/run-deterministic.ts";
import { runAssistantHeldOutEvaluation } from "../evals/assistant/run-held-out.ts";

test("corpus determinístico da Assistente permanece revisável e amplo", () => {
  assert.equal(assistantEvalCases.length, 157);
  assert.equal(new Set(assistantEvalCases.map((item) => item.id)).size, assistantEvalCases.length);
  assert.ok(assistantEvalCases.some((item) => item.category === "SAFETY"));
  assert.ok(assistantEvalCases.some((item) => item.messages.length > 0));
});

test("avaliação determinística não executa mutações e expõe falhas estruturadas", () => {
  const report = runAssistantDeterministicEvaluation();
  assert.equal(report.total, assistantEvalCases.length);
  assert.equal(report.passed + report.failed, report.total);
  assert.equal(report.failed, 0);
  assert.equal(report.dimensions.routing.score, 100);
  assert.equal(report.dimensions.entityParsing.score, 100);
  assert.equal(report.dimensions.context.score, 100);
  assert.equal(report.dimensions.deterministicSemanticContract.score, 100);
  assert.equal(report.dimensions.safety.score, 100);
  assert.equal(report.dimensions.safety.total > 0, true);
  assert.equal(report.providerSemanticQuality, null);
});

test("held-out permanece separado, mede generalização e promove somente falhas concretas", () => {
  assert.equal(assistantEvalHeldOutCases.length, 40);
  assert.equal(assistantEvalPromotedRegressions.length, 17);
  assert.equal(new Set(assistantEvalHeldOutCases.map((item) => item.id)).size, 40);
  const report = runAssistantHeldOutEvaluation();
  assert.equal(report.failed, 0);
  assert.equal(report.dimensions.routing.score, 100);
  assert.equal(report.dimensions.entityParsing.score, 100);
  assert.equal(report.dimensions.context.score, 100);
  assert.equal(report.dimensions.safety.score, 100);
  assert.equal(runAssistantEvaluation(assistantEvalPromotedRegressions).failed, 0);
});
