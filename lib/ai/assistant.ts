import "server-only";

import { ApiError, GoogleGenAI, type Interactions } from "@google/genai";
import {
  AssistantDataError,
  consultAssistantCatalogMedia,
  consultAssistantInventoryItemSummary,
  consultAssistantItem,
  consultAssistantLowStock,
  consultAssistantStockSummary,
} from "@/lib/assistant-data";
import { consultAssistantSupplierOrders } from "@/lib/assistant-supplier-orders";
import {
  consultAssistantPurchaseRecommendations,
  createPurchaseRecommendationClarificationBlock,
} from "@/lib/assistant-purchase-recommendations";
import {
  classifyAssistantIntent,
  extractCatalogMediaCode,
  extractExplicitItemQuery,
  getExplicitGreeting,
  getStandaloneGreeting,
  isItemFollowUpMessage,
  isItemToSupplierOrdersFollowUp,
  normalizeAssistantText,
  routeAssistantClarification,
  routeInventoryItemSummaryQuestion,
} from "@/lib/ai/assistant-routing";
import { routeSupplierOrderQuestion } from "@/lib/ai/supplier-order-routing";
import { routePurchaseRecommendationQuestion } from "@/lib/ai/purchase-recommendation-routing";
import type {
  AssistantClarificationBlock,
  AssistantClarificationOption,
  AssistantChatSuccess,
  AssistantCommercialConfigurationResult,
  AssistantItemLookupResult,
  AssistantPhysicalItemResult,
  AssistantStockSummaryResult,
} from "@/lib/assistant-types";

type AssistantServiceErrorCode =
  | "CONFIGURATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TOOL"
  | "EMPTY_RESPONSE"
  | "UNAVAILABLE"
  | "UPSTREAM";

export class AssistantServiceError extends Error {
  constructor(public readonly code: AssistantServiceErrorCode) {
    super(`Assistant service failed: ${code}.`);
    this.name = "AssistantServiceError";
  }
}

const defaultGeminiModel = "gemini-3.6-flash";
const providerTimeoutMs = 20_000;
const requestTimeoutMs = 30_000;
const unsupportedWriteResponse =
  "Essa operação ainda não está habilitada pelo Assistente. No momento posso apenas consultar informações do estoque. Nenhuma operação foi executada.";
const clarificationFallbackText =
  "Posso ajudar com consultas de Estoque, Pedidos, fotos e reposição. Exemplos: “Quantos 1H tenho?”, “Mostre o pedido Teste 04” ou “Quais itens estão zerados?”";

const assistantInstructions = `Você é o Assistente IA do Negócios K.

Responda em português do Brasil com tom educado, profissional, natural e objetivo.
Cada requisição é independente: você não recebe nem deve supor histórico de conversa.

Regras obrigatórias:
- Nunca invente códigos, relações, quantidades ou contexto anterior.
- Nunca afirme que alterou estoque ou executou uma operação.
- Não mencione Gemini, OpenAI, function calling, ferramentas ou detalhes internos.
- Para conversa geral, seja breve e não afirme dados operacionais.
- Para consulta de item, use exclusivamente os dados atuais fornecidos na requisição.
- Uma configuração pode ter aliases, mas possui um único saldo físico.
- Em configuração comercial, informe primeiro caixas completas montadas; depois, quando relevante, servo avulso, kit avulso e capacidade de montagem.
- Diferencie caixas completas, servos avulsos, kits avulsos, unidades montadas e total físico.
- Se houver vários dados, use Markdown e uma lista curta.
- Não repita a pergunta nem acrescente encerramentos genéricos.
- Responda a cumprimentos explícitos de forma breve. Use o primeiro nome somente se ele estiver confirmado nas instruções da requisição.`;

function ensureExplicitGreeting(
  answer: string,
  message: string,
  firstName: string | null,
) {
  const greeting = getExplicitGreeting(message);

  if (!greeting) {
    return answer;
  }

  const normalizedAnswerOpening = normalizeAssistantText(
    answer.replace(/^[\s*_#>-]+/, ""),
  );

  if (/^(bom dia|boa tarde|boa noite|ola|oi)\b/.test(normalizedAnswerOpening)) {
    return answer;
  }

  return `${greeting}${firstName ? `, ${firstName}` : ""}.\n\n${answer}`;
}

function clarificationOption(
  id: string,
  label: string,
  prompt: string,
  category: AssistantClarificationOption["category"],
): AssistantClarificationOption {
  return { id, label, prompt, category };
}

function createGenericClarificationBlock(): AssistantClarificationBlock {
  return {
    kind: "assistant_clarification",
    title: "Como posso ajudar?",
    message: "Escolha uma pergunta ou escreva algo parecido.",
    options: [
      clarificationOption(
        "inventory-balance",
        "Consultar saldo",
        "Quantos 1H tenho?",
        "inventory",
      ),
      clarificationOption(
        "inventory-status",
        "Ver situação",
        "O 3A está zerado?",
        "inventory",
      ),
      clarificationOption(
        "supplier-order-number",
        "Buscar negociação",
        "Mostre o pedido Teste 04",
        "supplier_orders",
      ),
      clarificationOption(
        "supplier-order-partial",
        "Ver Pedidos parciais",
        "Quais pedidos estão parciais?",
        "supplier_orders",
      ),
      clarificationOption(
        "catalog-photo",
        "Consultar foto",
        "Quero ver a foto do 1B",
        "media",
      ),
      clarificationOption(
        "inventory-replenishment",
        "Ver reposição",
        "Quais itens precisam de reposição?",
        "replenishment",
      ),
    ],
    fallbackText: clarificationFallbackText,
  };
}

function createSupplierOrderClarificationBlock(
  contextual: boolean,
): AssistantClarificationBlock {
  if (contextual) {
    return {
      kind: "assistant_clarification",
      title: "O que você quer consultar neste Pedido?",
      message: "Escolha uma continuação para a consulta atual.",
      options: [
        clarificationOption(
          "current-order-pickup",
          "Ver retirada pendente",
          "Quais itens ainda faltam retirar?",
          "supplier_orders",
        ),
        clarificationOption(
          "current-order-stock",
          "Ver entrada pendente",
          "Quanto falta entrar no estoque?",
          "supplier_orders",
        ),
        clarificationOption(
          "current-order-open",
          "Abrir este Pedido",
          "Abra esse pedido",
          "supplier_orders",
        ),
      ],
      fallbackText:
        "Posso mostrar os itens que faltam retirar, a quantidade que falta entrar no estoque ou abrir o Pedido atual.",
    };
  }

  return {
    kind: "assistant_clarification",
    title: "Qual Pedido você deseja consultar?",
    message: "Escolha uma opção ou informe o número da negociação.",
    options: [
      clarificationOption(
        "order-negotiation",
        "Buscar por negociação",
        "Mostre o pedido Teste 04",
        "supplier_orders",
      ),
      clarificationOption(
        "order-partial",
        "Ver Pedidos parciais",
        "Quais pedidos estão parciais?",
        "supplier_orders",
      ),
      clarificationOption(
        "order-pending",
        "Ver Pedidos pendentes",
        "Quais pedidos estão pendentes?",
        "supplier_orders",
      ),
      clarificationOption(
        "order-stock-pending",
        "Ver entrada pendente",
        "Quais pedidos têm entrada pendente no estoque?",
        "supplier_orders",
      ),
      clarificationOption(
        "order-code",
        "Buscar código",
        "Quais pedidos têm o código 1H?",
        "supplier_orders",
      ),
    ],
    fallbackText:
      "Posso buscar Pedidos por negociação, situação, retirada pendente, entrada pendente ou código do item.",
  };
}

async function createCatalogCodeClarificationBlock(
  code: string,
): Promise<AssistantClarificationBlock> {
  const summary = await executeStockQuery(() =>
    consultAssistantInventoryItemSummary(code, "STOCK"),
  );
  const hasCatalogResult = summary.results.length > 0;
  const hasMedia = summary.results.some(
    (result) => result.mediaDescriptor !== null,
  );
  const hasComposition = summary.results.some(
    (result) => result.composition !== undefined,
  );
  const options: AssistantClarificationOption[] = [];

  if (hasCatalogResult) {
    options.push(
      clarificationOption(
        "code-inventory",
        "Ver saldo no Estoque",
        `Quantos ${code} tenho?`,
        "inventory",
      ),
    );
  }

  options.push(
    clarificationOption(
      "code-supplier-orders",
      "Ver nos Pedidos",
      `Tenho ${code} nos pedidos?`,
      "supplier_orders",
    ),
  );

  if (hasMedia) {
    options.push(
      clarificationOption(
        "code-photo",
        "Ver foto",
        `Quero ver a foto do ${code}`,
        "media",
      ),
    );
  }

  if (hasComposition) {
    options.push(
      clarificationOption(
        "code-composition",
        "Ver composição",
        `Qual servo e kit formam o ${code}?`,
        "inventory",
      ),
    );
  }

  return {
    kind: "assistant_clarification",
    title: `O que você quer consultar sobre o Cód. ${code}?`,
    message: hasCatalogResult
      ? "Escolha uma opção para continuar."
      : "Não encontrei esse código no catálogo atual. Ainda posso procurá-lo nos Pedidos.",
    options,
    fallbackText: `Escolha onde deseja consultar o Cód. ${code}: Estoque, Pedidos${hasMedia ? ", foto" : ""}${hasComposition ? " ou composição" : ""}.`,
  };
}

function getGeminiConfiguration() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new AssistantServiceError("CONFIGURATION");
  }

  return {
    apiKey,
    model: process.env.GEMINI_MODEL?.trim() || defaultGeminiModel,
  };
}

function mapProviderError(error: unknown): AssistantServiceError {
  if (error instanceof AssistantServiceError) {
    return error;
  }

  const providerStatus =
    error instanceof ApiError
      ? error.status
      : error &&
          typeof error === "object" &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
        ? error.statusCode
        : error &&
            typeof error === "object" &&
            "status" in error &&
            typeof error.status === "number"
          ? error.status
          : null;

  if (providerStatus !== null) {
    if ([400, 401, 403, 404].includes(providerStatus)) {
      return new AssistantServiceError("CONFIGURATION");
    }

    if (providerStatus === 408 || providerStatus === 504) {
      return new AssistantServiceError("TIMEOUT");
    }

    if (providerStatus === 429) {
      return new AssistantServiceError("RATE_LIMIT");
    }

    if ([500, 502, 503].includes(providerStatus)) {
      return new AssistantServiceError("UNAVAILABLE");
    }
  }

  if (error && typeof error === "object") {
    const name = "name" in error ? error.name : null;
    const code = "code" in error ? error.code : null;

    if (
      name === "AbortError" ||
      name === "TimeoutError" ||
      name === "RequestTimeoutError" ||
      name === "APIConnectionTimeoutError" ||
      name === "APIUserAbortError" ||
      code === "ABORT_ERR" ||
      code === "ETIMEDOUT"
    ) {
      return new AssistantServiceError("TIMEOUT");
    }
  }

  return new AssistantServiceError("UPSTREAM");
}

async function executeStockQuery<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AssistantDataError) {
      throw new AssistantServiceError("TOOL");
    }

    throw error;
  }
}

function buildRequestInstructions(firstName: string | null) {
  const nameInstruction = firstName
    ? `O primeiro nome confirmado pelo servidor é ${JSON.stringify(firstName)}. Use-o somente ao responder um cumprimento explícito e com moderação.`
    : "Nenhum primeiro nome confirmado está disponível. Não invente um nome.";

  return `${assistantInstructions}\n\n${nameInstruction}`;
}

async function callGemini({
  firstName,
  itemContext,
  message,
}: {
  firstName: string | null;
  itemContext?: unknown;
  message: string;
}) {
  const { apiKey, model } = getGeminiConfiguration();
  const client = new GoogleGenAI({ apiKey });
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs);
  const inputText =
    itemContext === undefined
      ? `Mensagem atual:\n${message}`
      : `Mensagem atual:\n${message}\n\nDados atuais autorizados do item:\n${JSON.stringify(itemContext)}`;
  const input: Interactions.Step[] = [
    {
      type: "user_input",
      content: [{ type: "text", text: inputText }],
    },
  ];

  try {
    const response = await client.interactions.create(
      {
        model,
        store: false,
        system_instruction: buildRequestInstructions(firstName),
        input,
        generation_config: {
          max_output_tokens: itemContext === undefined ? 300 : 700,
          tool_choice: "none",
        },
      },
      {
        timeout: providerTimeoutMs,
        maxRetries: 0,
        fetchOptions: { signal: abortController.signal },
      },
    );
    const answer = response.output_text?.trim() ?? "";

    if (!answer) {
      throw new AssistantServiceError("EMPTY_RESPONSE");
    }

    return ensureExplicitGreeting(answer, message, firstName);
  } catch (error) {
    throw mapProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function formatStockSummary(result: AssistantStockSummaryResult) {
  return `**Resumo do estoque**

- Caixas completas: ${result.complete_boxes}
- Servos avulsos: ${result.loose_servos}
- Kits avulsos: ${result.loose_installation_kits}
- Reparos: ${result.repair_kits}
- Peças avulsas: ${result.loose_parts}

**Alertas**

- Estoque baixo: ${result.low_stock}
- Estoque zerado: ${result.out_of_stock}`;
}

function compactPhysicalItem(item: AssistantPhysicalItemResult) {
  return {
    kind: item.kind,
    code: item.code,
    description: item.description,
    model: item.model ?? undefined,
    loose_quantity: item.loose_quantity,
    mounted_quantity: item.mounted_quantity,
    total_quantity: item.total_quantity,
    minimum_stock: item.minimum_stock,
    compatible_servos: item.compatible_servos?.map((servo) => ({
      code: servo.code,
      model: servo.model,
    })),
  };
}

function compactConfiguration(
  configuration: AssistantCommercialConfigurationResult,
) {
  return {
    kind: "COMMERCIAL_CONFIGURATION",
    code: configuration.matched_commercial_code,
    aliases: configuration.aliases,
    description: configuration.description,
    assembled_quantity: configuration.assembled_quantity,
    minimum_stock: configuration.minimum_stock,
    maximum_assemblable: configuration.maximum_assemblable,
    servo: {
      code: configuration.servo.code,
      model:
        configuration.servo.model ?? configuration.servo.description,
      loose_quantity: configuration.servo.loose_quantity,
    },
    installation_kit: {
      code: configuration.installation_kit.code,
      loose_quantity: configuration.installation_kit.loose_quantity,
    },
  };
}

function compactItemLookup(result: AssistantItemLookupResult) {
  return {
    query: result.query,
    exact_code_match: result.exact_code_match,
    results: result.results.map((item) =>
      item.kind === "COMMERCIAL_CONFIGURATION"
        ? compactConfiguration(item)
        : compactPhysicalItem(item),
    ),
  };
}

function getCanonicalContextItem(result: AssistantItemLookupResult) {
  if (result.results.length !== 1) {
    return null;
  }

  const item = result.results[0];

  return item.kind === "COMMERCIAL_CONFIGURATION"
    ? item.matched_commercial_code
    : item.code;
}

function formatDirectItemAnswer(
  message: string,
  result: AssistantItemLookupResult,
) {
  if (result.results.length !== 1) {
    return null;
  }

  const item = result.results[0];
  const normalizedMessage = normalizeAssistantText(message);
  const asksMinimum = /\bminimo\b/.test(normalizedMessage);
  const asksAssemblyCapacity =
    /\b(montar|montagem|capacidade)\b/.test(normalizedMessage) &&
    /\b(quantas?|quantos?|quanto|consigo|posso|capacidade)\b/.test(
      normalizedMessage,
    );
  const asksMounted =
    /\bmontad[ao]s?\b/.test(normalizedMessage) &&
    /\b(quantas?|quantos?|quanto|tem|tenho|estao)\b/.test(
      normalizedMessage,
    );
  const asksLoose = /\bavuls[ao]s?\b/.test(normalizedMessage);
  const asksSimpleQuantity =
    /\b(quanto|quantos|quanta|quantas|tenho|temos|tem|saldo|quantidade)\b/.test(
      normalizedMessage,
    ) &&
    !/\b(fale|explique|detalhe|sobre|configuracao completa)\b/.test(
      normalizedMessage,
    );

  if (asksMinimum) {
    return `O estoque mínimo de ${item.kind === "COMMERCIAL_CONFIGURATION" ? item.matched_commercial_code : item.code} é ${item.minimum_stock}.`;
  }

  if (asksAssemblyCapacity) {
    if (item.kind !== "COMMERCIAL_CONFIGURATION") {
      return `Para calcular a capacidade de montagem, informe o código comercial da caixa relacionada a ${item.code}.`;
    }

    return `Com os saldos avulsos atuais, você consegue montar ${item.maximum_assemblable} caixa${item.maximum_assemblable === 1 ? "" : "s"} ${item.matched_commercial_code}.`;
  }

  if (asksMounted) {
    const code =
      item.kind === "COMMERCIAL_CONFIGURATION"
        ? item.matched_commercial_code
        : item.code;
    const mountedQuantity =
      item.kind === "COMMERCIAL_CONFIGURATION"
        ? item.assembled_quantity
        : (item.mounted_quantity ?? 0);

    return `Você tem ${mountedQuantity} unidade${mountedQuantity === 1 ? "" : "s"} de ${code} montada${mountedQuantity === 1 ? "" : "s"}.`;
  }

  if (asksLoose) {
    if (item.kind === "COMMERCIAL_CONFIGURATION") {
      return `Para ${item.matched_commercial_code}, há ${item.servo.loose_quantity} servo${item.servo.loose_quantity === 1 ? "" : "s"} ${item.servo.code} avulso${item.servo.loose_quantity === 1 ? "" : "s"} e ${item.installation_kit.loose_quantity} kit${item.installation_kit.loose_quantity === 1 ? "" : "s"} ${item.installation_kit.code} avulso${item.installation_kit.loose_quantity === 1 ? "" : "s"}.`;
    }

    return `Você tem ${item.loose_quantity} unidade${item.loose_quantity === 1 ? "" : "s"} de ${item.code} avulsa${item.loose_quantity === 1 ? "" : "s"}.`;
  }

  if (!asksSimpleQuantity) {
    return null;
  }

  if (item.kind === "COMMERCIAL_CONFIGURATION") {
    return `Você tem ${item.assembled_quantity} caixa${item.assembled_quantity === 1 ? "" : "s"} ${item.matched_commercial_code} montada${item.assembled_quantity === 1 ? "" : "s"}.`;
  }

  if (item.kind === "SERVO") {
    return `Você tem ${item.loose_quantity} servo${item.loose_quantity === 1 ? "" : "s"} ${item.code} avulso${item.loose_quantity === 1 ? "" : "s"}, ${item.mounted_quantity ?? 0} em caixas e ${item.total_quantity ?? item.loose_quantity} no total.`;
  }

  if (item.kind === "INSTALLATION_KIT") {
    return `Você tem ${item.loose_quantity} kit${item.loose_quantity === 1 ? "" : "s"} ${item.code} avulso${item.loose_quantity === 1 ? "" : "s"}, ${item.mounted_quantity ?? 0} em caixas e ${item.total_quantity ?? item.loose_quantity} no total.`;
  }

  return `Você tem ${item.loose_quantity} unidade${item.loose_quantity === 1 ? "" : "s"} de ${item.code}.`;
}

function resolveItemQuery(message: string, lastItemQuery: string | null) {
  const explicitQuery = extractExplicitItemQuery(message);

  if (explicitQuery) {
    return explicitQuery;
  }

  if (lastItemQuery && isItemFollowUpMessage(message)) {
    return lastItemQuery;
  }

  return null;
}

export async function answerAssistantQuestion(
  message: string,
  lastItemQuery: string | null,
  lastSupplierOrderId: string | null,
  lastSupplierOrderCatalogCode: string | null,
  firstName: string | null,
): Promise<AssistantChatSuccess> {
  const purchaseRecommendationRoute =
    routePurchaseRecommendationQuestion(message);
  const intent = classifyAssistantIntent(message);
  const standaloneGreeting = getStandaloneGreeting(message);

  if (standaloneGreeting) {
    return {
      message: `${standaloneGreeting}${firstName ? `, ${firstName}` : ""}. Como posso ajudar?`,
      contextItemQuery: null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (purchaseRecommendationRoute?.kind === "CLARIFICATION") {
    const block = createPurchaseRecommendationClarificationBlock(
      purchaseRecommendationRoute.queryCode,
    );

    return {
      message: block.fallbackText,
      structuredBlock: block,
      contextItemQuery: null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (purchaseRecommendationRoute?.kind === "QUERY") {
    const block = await executeStockQuery(() =>
      consultAssistantPurchaseRecommendations(
        purchaseRecommendationRoute,
      ),
    );

    return {
      message: block.fallbackText,
      structuredBlock: block,
      contextItemQuery:
        block.queryStatus === "FOUND"
          ? (block.items[0]?.primaryCode ?? null)
          : null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (intent === "UNSUPPORTED_WRITE") {
    return {
      message: ensureExplicitGreeting(
        unsupportedWriteResponse,
        message,
        firstName,
      ),
    };
  }

  const clarificationRoute = routeAssistantClarification(
    message,
    Boolean(lastSupplierOrderId),
  );

  if (clarificationRoute?.kind === "CATALOG_CODE") {
    const block = await createCatalogCodeClarificationBlock(
      clarificationRoute.code,
    );

    return {
      message: block.fallbackText,
      structuredBlock: block,
      contextItemQuery: null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (clarificationRoute?.kind === "SUPPLIER_ORDERS") {
    const block = createSupplierOrderClarificationBlock(
      clarificationRoute.contextual,
    );

    return {
      message: block.fallbackText,
      structuredBlock: block,
      ...(clarificationRoute.contextual
        ? {}
        : {
            contextItemQuery: null,
            contextSupplierOrderId: null,
            contextSupplierOrderCatalogCode: null,
          }),
    };
  }

  if (clarificationRoute?.kind === "GENERIC") {
    const block = createGenericClarificationBlock();

    return {
      message: block.fallbackText,
      structuredBlock: block,
      contextItemQuery: null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  const supplierOrderMessage =
    lastItemQuery && isItemToSupplierOrdersFollowUp(message)
      ? `Tenho ${lastItemQuery} nos pedidos?`
      : message;
  const supplierOrderRoute = routeSupplierOrderQuestion(
    supplierOrderMessage,
    lastSupplierOrderId,
    new Date(),
    lastSupplierOrderCatalogCode,
  );

  if (supplierOrderRoute.kind === "NEEDS_ORDER_CONTEXT") {
    const block = createSupplierOrderClarificationBlock(false);

    return {
      message: block.fallbackText,
      structuredBlock: block,
      contextItemQuery: null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (supplierOrderRoute.kind === "ORDER_QUERY") {
    const result = await executeStockQuery(() =>
      consultAssistantSupplierOrders(supplierOrderRoute.query),
    );

    return {
      message: result.block.fallbackText,
      structuredBlock: result.block,
      contextItemQuery: null,
      contextSupplierOrderId: result.contextSupplierOrderId,
      contextSupplierOrderCatalogCode:
        supplierOrderRoute.query.catalogCode,
    };
  }

  const inventoryItemRoute = routeInventoryItemSummaryQuestion(
    message,
    lastItemQuery,
  );

  if (inventoryItemRoute) {
    const summaryBlock = await executeStockQuery(() =>
      consultAssistantInventoryItemSummary(
        inventoryItemRoute.queryCode,
        inventoryItemRoute.metric,
      ),
    );

    return {
      message: summaryBlock.fallbackText,
      structuredBlock: summaryBlock,
      contextItemQuery:
        summaryBlock.status === "FOUND"
          ? (summaryBlock.results[0]?.displayCode ?? null)
          : null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (intent === "AMBIGUOUS") {
    const block = createGenericClarificationBlock();

    return {
      message: block.fallbackText,
      structuredBlock: block,
      contextItemQuery: null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (intent === "SUMMARY") {
    const summary = await executeStockQuery(consultAssistantStockSummary);

    return {
      message: ensureExplicitGreeting(
        formatStockSummary(summary),
        message,
        firstName,
      ),
    };
  }

  if (intent === "ALERTS") {
    const alertsBlock = await executeStockQuery(consultAssistantLowStock);

    return {
      message: alertsBlock.fallbackText,
      structuredBlock: alertsBlock,
    };
  }

  if (intent === "CATALOG_MEDIA") {
    const catalogCode =
      extractCatalogMediaCode(message) ??
      (lastItemQuery && isItemFollowUpMessage(message)
        ? lastItemQuery
        : null);

    if (!catalogCode) {
      return {
        message:
          "Informe um único código para eu localizar a foto no catálogo.",
        contextItemQuery: null,
      };
    }

    const mediaBlock = await executeStockQuery(() =>
      consultAssistantCatalogMedia(catalogCode),
    );

    return {
      message: mediaBlock.fallbackText,
      structuredBlock: mediaBlock,
      contextItemQuery:
        mediaBlock.status === "FOUND"
          ? (mediaBlock.results[0]?.displayCode ?? null)
          : null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  if (intent === "GENERAL_CONVERSATION") {
    return {
      message: await callGemini({ firstName, message }),
    };
  }

  const query = resolveItemQuery(message, lastItemQuery);

  if (!query) {
    const block = createGenericClarificationBlock();

    return {
      message: block.fallbackText,
      structuredBlock: block,
      contextItemQuery: null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  const lookup = await executeStockQuery(() => consultAssistantItem(query));

  if (lookup.results.length === 0) {
    return {
      message: ensureExplicitGreeting(
        `Não encontrei nenhum item com o código ou descrição ${query}.`,
        message,
        firstName,
      ),
      contextItemQuery: null,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  const contextItemQuery = getCanonicalContextItem(lookup);
  const directAnswer = formatDirectItemAnswer(message, lookup);

  if (directAnswer) {
    return {
      message: ensureExplicitGreeting(directAnswer, message, firstName),
      contextItemQuery,
      contextSupplierOrderId: null,
      contextSupplierOrderCatalogCode: null,
    };
  }

  return {
    message: await callGemini({
      firstName,
      itemContext: compactItemLookup(lookup),
      message,
    }),
    contextItemQuery,
    contextSupplierOrderId: null,
    contextSupplierOrderCatalogCode: null,
  };
}
