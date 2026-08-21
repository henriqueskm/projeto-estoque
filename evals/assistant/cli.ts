import { runAssistantDeterministicEvaluation, writeAssistantEvalArtifacts } from "./run-deterministic";
import { writeAssistantHeldOutArtifacts } from "./run-held-out";
import { runAssistantLiveEvaluation } from "./run-live";

const heldOut = process.argv.includes("--held-out");
const live = process.argv.includes("--live");

if (live) {
  const report = await runAssistantLiveEvaluation();
  console.log(JSON.stringify({
    status: report.status,
    model: report.model,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    providerSemanticQuality: report.providerSemanticQuality,
    safetyPassRate: report.safetyPassRate,
    results: report.results.map((result) => ({
      id: result.id,
      safety: result.safety,
      outcome: result.outcome,
      failureCodes: result.failureCodes,
    })),
  }, null, 2));
  process.exitCode = report.status === "failed" ? 1 : 0;
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
