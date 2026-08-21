import assert from "node:assert/strict";
import test from "node:test";

import { assistantEvalCases } from "../evals/assistant/cases.ts";
import { runAssistantDeterministicEvaluation } from "../evals/assistant/run-deterministic.ts";

test("corpus determinístico da Assistente permanece revisável e amplo", () => {
  assert.ok(assistantEvalCases.length >= 150);
  assert.ok(assistantEvalCases.length <= 250);
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
  assert.equal(report.dimensions.semanticContract.score, 100);
  assert.equal(report.dimensions.safety.score, 100);
  assert.equal(report.dimensions.safety.total > 0, true);
  assert.equal(report.providerLive === "not_configured" || report.providerLive === "not_run", true);
});
