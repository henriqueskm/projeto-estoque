export type AssistantEvalCategory =
  | "INVENTORY"
  | "SERVO_MODEL"
  | "COMMERCIAL_CODE"
  | "ALIASES"
  | "MINIMUM_STOCK"
  | "PURCHASE_RECOMMENDATION"
  | "MANUAL_STOCK_ENTRY"
  | "MANUAL_STOCK_OUTPUT"
  | "CONFIGURATION_ASSEMBLY"
  | "CONFIGURATION_DISASSEMBLY"
  | "SUPPLIER_ORDERS"
  | "SUPPLIER_ORDER_PICKUP"
  | "SUPPLIER_ORDER_STOCK_ENTRY"
  | "SUPPLIER_ORDER_FINALIZATION"
  | "STATISTICS"
  | "ORDER_PHOTO"
  | "FOLLOW_UP"
  | "CLARIFICATION"
  | "GENERAL_CONVERSATION"
  | "SAFETY"
  | "AMBIGUOUS"
  | "MALFORMED_LANGUAGE";

export type AssistantEvalDimension =
  | "routing"
  | "entityParsing"
  | "context"
  | "deterministicSemanticContract"
  | "safety";

export type AssistantEvalExpectation = {
  evaluator:
    | "manualEntry"
    | "manualOutput"
    | "assembly"
    | "disassembly"
    | "pickup"
    | "supplierEntry"
    | "finalization"
    | "inventoryCode"
    | "servoModel"
    | "purchase"
    | "statistics"
    | "supplierOrder"
    | "inventoryContext"
    | "servoContext"
    | "supplierOrderContext"
    | "statisticsContext"
    | "mainIntent"
    | "clarification"
    | "textConfirmation";
  kind?: string | null;
  intent?: string;
  quantity?: number | null;
  target?: string | null;
  targetKind?: "ITEM" | "COMMERCIAL_CODE" | null;
  negotiation?: string | null;
  metric?: string;
  mode?: string;
  period?: number;
  view?: string;
  shouldPrepareMutation?: boolean;
  shouldExecuteMutation?: false;
  usesPreviousContext?: boolean;
};

export type AssistantEvalCase = {
  id: string;
  category: AssistantEvalCategory;
  messages: string[];
  dimensions: AssistantEvalDimension[];
  expected: AssistantEvalExpectation;
  notes?: string;
};

export type AssistantEvalFailure = {
  id: string;
  category: AssistantEvalCategory;
  dimensions: AssistantEvalDimension[];
  failureCategory:
    | "ROUTING"
    | "PARSING"
    | "ENTITY_RESOLUTION"
    | "CONTEXT"
    | "CLARIFICATION"
    | "STRUCTURED_BLOCK"
    | "SAFETY"
    | "COPY"
    | "TEST_EXPECTATION";
  message: string;
  expected: AssistantEvalExpectation;
  actual: unknown;
};

export type AssistantEvalReport = {
  corpusVersion: number;
  total: number;
  passed: number;
  failed: number;
  score: number;
  dimensions: Record<AssistantEvalDimension, { total: number; passed: number; score: number }>;
  failures: AssistantEvalFailure[];
  providerSemanticQuality: null;
};

export type AssistantLiveOutcome =
  | "ANSWER"
  | "CLARIFY"
  | "PREVIEW_ONLY"
  | "TEXT_CONFIRMATION_BLOCKED";

export type AssistantLiveEvalCase = {
  id: string;
  category: AssistantEvalCategory;
  messages: string[];
  allowedFacts: string[];
  requiredConcepts: string[];
  forbiddenConcepts: string[];
  contextRequirement: "REQUIRED" | "MUST_NOT_ASSUME" | "NOT_APPLICABLE";
  expectedOutcome: AssistantLiveOutcome;
  maxResponseStyle: "SHORT" | "NORMAL";
  shouldPrepareMutation: false;
  shouldExecuteMutation: false;
};

export type AssistantProviderSemanticDimension =
  | "correctness"
  | "context"
  | "clarity"
  | "naturalness"
  | "conciseness"
  | "nonHallucination";

export type AssistantProviderSemanticScore = {
  score: 0 | 1 | 2 | 3 | 4 | 5;
  rationale: string;
};

export type AssistantProviderLiveCaseResult = {
  id: string;
  safety: "PASS" | "FAIL" | "NOT_EVALUATED";
  outcome: "PASS" | "FAIL" | "NEEDS_HUMAN_REVIEW";
  dimensions: Record<AssistantProviderSemanticDimension, AssistantProviderSemanticScore | null>;
  failureCodes: string[];
  providerError?: {
    httpStatus?: number;
    code: string;
    retryAfterSeconds?: number;
  };
};

export type AssistantProviderLiveReport = {
  status: "not_configured" | "passed" | "failed" | "inconclusive";
  model: string | null;
  total: number;
  availableCases: number;
  passed: number;
  failed: number;
  notEvaluatedCases: number;
  evaluatedCases: number;
  semanticEvaluatedCases: number;
  safetyEvaluatedCases: number;
  infrastructureFailures: number;
  evaluationCoveragePercent: number;
  providerSemanticQuality: number | null;
  observedProviderSemanticQuality: number | null;
  safetyPassRate: number | null;
  results: AssistantProviderLiveCaseResult[];
};
