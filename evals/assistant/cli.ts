import { runAssistantDeterministicEvaluation, writeAssistantEvalArtifacts } from "./run-deterministic";
import { writeAssistantHeldOutArtifacts } from "./run-held-out";
import { resolveAssistantLiveEvalConfig, runAssistantLiveEvaluation } from "./run-live";

const heldOut = process.argv.includes("--held-out");
const live = process.argv.includes("--live");

if (live) {
  const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
  const config = resolveAssistantLiveEvalConfig({
    limit: limitArgument ? limitArgument.slice("--limit=".length) : undefined,
  });
  const report = await runAssistantLiveEvaluation({ config });
  console.log(JSON.stringify({
    status: report.status,
    model: report.model,
    total: report.total,
    availableCases: report.availableCases,
    passed: report.passed,
    failed: report.failed,
    notEvaluatedCases: report.notEvaluatedCases,
    evaluatedCases: report.evaluatedCases,
    semanticEvaluatedCases: report.semanticEvaluatedCases,
    safetyEvaluatedCases: report.safetyEvaluatedCases,
    infrastructureFailures: report.infrastructureFailures,
    evaluationCoveragePercent: report.evaluationCoveragePercent,
    providerSemanticQuality: report.providerSemanticQuality,
    observedProviderSemanticQuality: report.observedProviderSemanticQuality,
    safetyPassRate: report.safetyPassRate,
    configuration: {
      reason: config.reason,
      limit: config.limit,
      minimumIntervalMs: config.minimumIntervalMs,
      timeoutMs: config.timeoutMs,
    },
    results: report.results.map((result) => ({
      id: result.id,
      safety: result.safety,
      outcome: result.outcome,
      failureCodes: result.failureCodes,
      ...(result.providerError ? { providerError: result.providerError } : {}),
    })),
  }, null, 2));
  process.exitCode = report.status === "failed" || report.status === "inconclusive" ? 1 : 0;
} else {
  const report = heldOut
    ? await writeAssistantHeldOutArtifacts()
    : process.argv.includes("--write")
      ? await writeAssistantEvalArtifacts()
      : runAssistantDeterministicEvaluation();

  console.log(JSON.stringify({
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    score: report.score,
    dimensions: report.dimensions,
    providerSemanticQuality: report.providerSemanticQuality,
    failures: report.failures.map((item) => ({ id: item.id, category: item.failureCategory, message: item.message })),
  }, null, 2));

  process.exitCode = report.failed === 0 ? 0 : 1;
}
