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
  | "semanticContract"
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
  providerLive: "not_configured" | "not_run";
};
