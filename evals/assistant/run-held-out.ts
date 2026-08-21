import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assistantEvalHeldOutCases } from "./held-out-cases";
import { runAssistantEvaluation } from "./run-deterministic";

export function runAssistantHeldOutEvaluation() {
  return runAssistantEvaluation(assistantEvalHeldOutCases, 1);
}

export async function writeAssistantHeldOutArtifacts() {
  const report = runAssistantHeldOutEvaluation();
  const directory = resolve(process.cwd(), "artifacts", "assistant-eval");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "held-out-latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
