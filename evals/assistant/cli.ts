import { runAssistantDeterministicEvaluation, writeAssistantEvalArtifacts } from "./run-deterministic";

const report = process.argv.includes("--write")
  ? await writeAssistantEvalArtifacts()
  : runAssistantDeterministicEvaluation();

console.log(JSON.stringify({
  total: report.total,
  passed: report.passed,
  failed: report.failed,
  score: report.score,
  dimensions: report.dimensions,
  providerLive: report.providerLive,
  failures: report.failures.map((item) => ({ id: item.id, category: item.failureCategory, message: item.message })),
}, null, 2));

process.exitCode = report.failed === 0 ? 0 : 1;
