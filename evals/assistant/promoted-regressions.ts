import { assistantEvalHeldOutCases } from "./held-out-cases";
import type { AssistantEvalCase } from "./contracts";

// These were the only failures observed in the immutable first held-out run.
// The historic 157-case corpus remains unchanged; this separate list records
// the approved regressions without rewriting that baseline.
const promotedIds = new Set([
  "held-out-entry-001",
  "held-out-entry-002",
  "held-out-entry-003",
  "held-out-entry-004",
  "held-out-output-002",
  "held-out-output-003",
  "held-out-disassembly-001",
  "held-out-pickup-001",
  "held-out-order-entry-001",
  "held-out-order-entry-003",
  "held-out-finalization-001",
  "held-out-purchase-001",
  "held-out-purchase-002",
  "held-out-context-002",
  "held-out-context-003",
  "held-out-context-004",
  "held-out-adversarial-004",
]);

export const assistantEvalPromotedRegressions: AssistantEvalCase[] =
  assistantEvalHeldOutCases
    .filter((caseItem) => promotedIds.has(caseItem.id))
    .map((caseItem) => ({
      ...caseItem,
      id: `regression-${caseItem.id}`,
      notes: "Promovido após falha concreta no primeiro held-out de NK-AI-EVAL-001A.",
    }));

if (assistantEvalPromotedRegressions.length !== promotedIds.size) {
  throw new Error("Toda falha aprovada do held-out deve ter regressão permanente.");
}
