import type { PhysicalStockItemType } from "@/lib/stock-calculations";

export const assistantMessageMaxLength = 2000;
export const assistantQueryMaxLength = 120;
export const assistantHistoryMaxMessages = 16;
export const assistantRequestMaxCharacters = 80_000;

export type AssistantConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantChatRequest = {
  message: string;
  history: AssistantConversationMessage[];
};

export type AssistantChatSuccess = {
  message: string;
};

export type AssistantChatError = {
  error: string;
};

export type AssistantPhysicalItemResult = {
  kind: PhysicalStockItemType;
  item_id: string;
  code: string;
  description: string;
  minimum_stock: number;
  loose_quantity: number;
  mounted_quantity?: number;
  total_quantity?: number;
  model?: string | null;
  compatible_servos?: Array<{
    code: string;
    description: string;
    model: string | null;
  }>;
};

export type AssistantCommercialConfigurationResult = {
  kind: "COMMERCIAL_CONFIGURATION";
  configuration_id: string;
  matched_commercial_code: string;
  aliases: string[];
  description: string;
  servo: {
    code: string;
    description: string;
    model: string | null;
    loose_quantity: number;
  };
  installation_kit: {
    code: string;
    description: string;
    loose_quantity: number;
  };
  assembled_quantity: number;
  maximum_assemblable: number;
  minimum_stock: number;
};

export type AssistantItemLookupResult = {
  query: string;
  exact_code_match: boolean;
  results: Array<
    AssistantPhysicalItemResult | AssistantCommercialConfigurationResult
  >;
};

export type AssistantStockSummaryResult = {
  complete_boxes: number;
  loose_servos: number;
  loose_installation_kits: number;
  repair_kits: number;
  loose_parts: number;
  low_stock: number;
  out_of_stock: number;
};

export type AssistantStockAttentionItem = {
  type:
    | PhysicalStockItemType
    | "COMMERCIAL_CONFIGURATION";
  code: string;
  aliases?: string[];
  description: string;
  current_quantity: number;
  minimum_stock: number;
  status: "LOW" | "ZERO";
};

export type AssistantLowStockResult = {
  count: number;
  items: AssistantStockAttentionItem[];
};
