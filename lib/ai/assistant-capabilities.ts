export const assistantCapabilityIds = [
  "ASSISTANT_OVERVIEW",
  "INVENTORY_QUERY",
  "INVENTORY_ALERTS",
  "PURCHASE_RECOMMENDATION",
  "MANUAL_STOCK_ENTRY",
  "MANUAL_STOCK_OUTPUT",
  "CONFIGURATION_ASSEMBLY",
  "CONFIGURATION_DISASSEMBLY",
  "SUPPLIER_ORDERS",
  "SUPPLIER_ORDER_PICKUP",
  "SUPPLIER_ORDER_STOCK_ENTRY",
  "SUPPLIER_ORDER_FINALIZATION",
  "SUPPLIER_ORDER_PHOTO",
  "VOICE_DICTATION",
  "STATISTICS",
  "CATALOG_MEDIA",
  "MINIMUM_STOCK_MANAGEMENT",
  "STOCK_ADJUSTMENT",
] as const;

export type AssistantCapabilityId = (typeof assistantCapabilityIds)[number];

export type AssistantCapability = {
  id: AssistantCapabilityId;
  title: string;
  description: string;
  steps: readonly string[];
  examples: readonly string[];
  restrictions: readonly string[];
  page: `/${string}` | null;
  availability: "ASSISTANT" | "PAGE_ONLY" | "INPUT_ONLY";
  featured?: boolean;
};

export const assistantCapabilities: readonly AssistantCapability[] = [
  {
    id: "ASSISTANT_OVERVIEW",
    title: "Visão geral da Assistente",
    description: "Resume as principais consultas e operações realmente disponíveis na Assistente NK.",
    steps: ["Peça o que a Assistente consegue fazer."],
    examples: ["O que você consegue fazer?"],
    restrictions: ["A lista inclui somente capacidades implementadas no produto."],
    page: "/",
    availability: "ASSISTANT",
  },
  {
    id: "INVENTORY_QUERY",
    title: "Consultar Estoque",
    description: "Consulta saldo, mínimo, situação, descrição e composição de códigos ou modelos com dados atuais do servidor.",
    steps: ["Informe o código ou modelo e o que deseja consultar."],
    examples: ["Quanto tenho do 1B?", "Qual é o mínimo do KT-18?"],
    restrictions: ["A Assistente não inventa saldo nem códigos."],
    page: "/estoque",
    availability: "ASSISTANT",
    featured: true,
  },
  {
    id: "INVENTORY_ALERTS",
    title: "Ver alertas de estoque",
    description: "Mostra itens baixos, zerados ou abaixo do mínimo com dados reais.",
    steps: ["Pergunte se há algo acabando ou abaixo do mínimo."],
    examples: ["Tem alguma coisa acabando?"],
    restrictions: ["É uma consulta somente leitura."],
    page: "/estoque",
    availability: "ASSISTANT",
  },
  {
    id: "PURCHASE_RECOMMENDATION",
    title: "Preparar reposição",
    description: "Mostra o que comprar considerando estoque, mínimo e compras pendentes em Pedidos.",
    steps: ["Peça a lista do que precisa comprar."],
    examples: ["O que eu preciso comprar?"],
    restrictions: ["A consulta não cria Pedido nem altera estoque."],
    page: "/estoque",
    availability: "ASSISTANT",
    featured: true,
  },
  {
    id: "MANUAL_STOCK_ENTRY",
    title: "Entrada manual",
    description: "Prepara uma entrada de um ou vários itens pelo chat.",
    steps: ["Informe quantidade e código de cada item.", "Revise a prévia.", "Confirme somente pelo botão."],
    examples: ["Entrada 2 do 1B.", "Coloca 2 do 1B e 3 do KT-18 no estoque."],
    restrictions: ["Sem o botão de confirmação, nenhuma entrada acontece."],
    page: "/entrada",
    availability: "ASSISTANT",
    featured: true,
  },
  {
    id: "MANUAL_STOCK_OUTPUT",
    title: "Saída manual",
    description: "Prepara a baixa de um ou vários itens pelo chat.",
    steps: ["Informe quantidade e código de cada item.", "Revise estoque e montagem automática na prévia.", "Confirme somente pelo botão."],
    examples: ["Baixa 2 do 1B.", "Baixa 2 do 1B, 2 do 1E e 1 do 11A."],
    restrictions: ["Sem o botão de confirmação, nenhuma saída acontece."],
    page: "/saida",
    availability: "ASSISTANT",
    featured: true,
  },
  {
    id: "CONFIGURATION_ASSEMBLY",
    title: "Montagem",
    description: "Prepara a montagem de uma configuração comercial usando Servo e kit disponíveis.",
    steps: ["Informe o código comercial e a quantidade.", "Revise e confirme pelo botão."],
    examples: ["Monte 2 do Cód. 1H."],
    restrictions: ["A disponibilidade e a compatibilidade são verificadas pelo servidor."],
    page: "/estoque",
    availability: "ASSISTANT",
  },
  {
    id: "CONFIGURATION_DISASSEMBLY",
    title: "Desmontagem",
    description: "Prepara a desmontagem de uma configuração comercial em Servo e kit avulsos.",
    steps: ["Informe o código comercial e a quantidade.", "Revise e confirme pelo botão."],
    examples: ["Desmonte 1 caixa do Cód. 1H."],
    restrictions: ["A operação só ocorre após confirmação pelo botão."],
    page: "/estoque",
    availability: "ASSISTANT",
  },
  {
    id: "SUPPLIER_ORDERS",
    title: "Consultar Pedidos",
    description: "Consulta Pedidos, negociação, retirada pendente e entrada pendente no estoque.",
    steps: ["Informe a negociação ou descreva o estado que deseja consultar."],
    examples: ["Como está o Pedido 40959?", "O que falta retirar dos Pedidos?"],
    restrictions: ["As consultas usam as views oficiais e não alteram o Pedido."],
    page: "/pedidos",
    availability: "ASSISTANT",
    featured: true,
  },
  {
    id: "SUPPLIER_ORDER_PICKUP",
    title: "Registrar retirada de Pedido",
    description: "Prepara uma retirada vinculada a uma linha real de Pedido.",
    steps: ["Informe Pedido, item e quantidade.", "Revise e confirme pelo botão."],
    examples: ["Retire 1 do 1H no Pedido 40959."],
    restrictions: ["Retirada não é entrada no estoque."],
    page: "/pedidos",
    availability: "ASSISTANT",
  },
  {
    id: "SUPPLIER_ORDER_STOCK_ENTRY",
    title: "Dar entrada pelo Pedido",
    description: "Prepara a entrada no estoque de quantidades já retiradas do fornecedor.",
    steps: ["Informe Pedido, item e quantidade disponível.", "Revise e confirme pelo botão."],
    examples: ["Lance 1 do 1H no estoque pelo Pedido 40959."],
    restrictions: ["Somente quantidade já retirada e ainda não estocada pode entrar."],
    page: "/pedidos",
    availability: "ASSISTANT",
  },
  {
    id: "SUPPLIER_ORDER_FINALIZATION",
    title: "Finalizar Pedido",
    description: "Prepara a finalização de um Pedido sem confundir finalização com entrada no estoque.",
    steps: ["Informe a negociação.", "Revise e confirme pelo botão."],
    examples: ["Finalize o Pedido 40959."],
    restrictions: ["Finalizar encerra a retirada; não lança estoque automaticamente."],
    page: "/pedidos",
    availability: "ASSISTANT",
  },
  {
    id: "SUPPLIER_ORDER_PHOTO",
    title: "Criar Pedido por foto",
    description: "Interpreta uma foto, valida códigos contra o catálogo e apresenta uma prévia revisável.",
    steps: ["Envie ou fotografe o Pedido.", "Revise negociação, códigos e quantidades.", "Confirme a criação somente pelo botão."],
    examples: ["Use o botão de câmera ou anexo no campo da conversa."],
    restrictions: ["O envio da imagem sozinho nunca cria Pedido e a imagem não é persistida."],
    page: "/",
    availability: "INPUT_ONLY",
    featured: true,
  },
  {
    id: "VOICE_DICTATION",
    title: "Ditado por voz",
    description: "Transcreve o áudio para o campo de mensagem antes do envio.",
    steps: ["Toque no microfone.", "Fale a mensagem.", "Revise o texto e envie."],
    examples: ["Dite uma consulta ou uma operação com quantidade e código."],
    restrictions: ["A transcrição não envia, confirma nem executa a mensagem automaticamente."],
    page: "/",
    availability: "INPUT_ONLY",
  },
  {
    id: "STATISTICS",
    title: "Consultar Estatísticas",
    description: "Consulta entradas, saídas externas, rankings e comparações nos períodos suportados.",
    steps: ["Informe a métrica e um período de 7, 30 ou 90 dias."],
    examples: ["Qual configuração mais saiu nos últimos 30 dias?"],
    restrictions: ["Montagens e desmontagens internas não contam como venda."],
    page: "/estatisticas",
    availability: "ASSISTANT",
  },
  {
    id: "CATALOG_MEDIA",
    title: "Ver imagens do catálogo",
    description: "Localiza imagens oficiais de itens e configurações existentes.",
    steps: ["Informe um código e peça a foto ou imagem."],
    examples: ["Mostre a foto do Cód. 2A."],
    restrictions: ["A mídia e os links são resolvidos pelo servidor."],
    page: "/estoque",
    availability: "ASSISTANT",
  },
  {
    id: "MINIMUM_STOCK_MANAGEMENT",
    title: "Alterar estoque mínimo",
    description: "O estoque mínimo pode ser alterado na tela Estoque, mas não pelo chat da Assistente.",
    steps: ["Abra Estoque.", "Localize o item ou configuração.", "Use a ação de estoque mínimo disponível na tela."],
    examples: [],
    restrictions: ["A Assistente pode consultar o mínimo, mas não alterá-lo pelo chat."],
    page: "/estoque",
    availability: "PAGE_ONLY",
  },
  {
    id: "STOCK_ADJUSTMENT",
    title: "Ajustar estoque",
    description: "Permite corrigir um saldo pela tela Estoque usando a ação auditável existente.",
    steps: [
      "Abra Estoque.",
      "Localize o item ou configuração.",
      "Abra as ações.",
      "Escolha “Ajustar estoque”.",
      "Informe o novo ajuste conforme o fluxo atual.",
    ],
    examples: ["Errei o estoque, como corrijo?", "Como faço um ajuste de estoque?"],
    restrictions: ["A Assistente não executa ajuste de saldo pelo chat."],
    page: "/estoque",
    availability: "PAGE_ONLY",
  },
] as const;

const capabilityById = new Map(
  assistantCapabilities.map((capability) => [capability.id, capability]),
);

export function isAssistantCapabilityId(value: unknown): value is AssistantCapabilityId {
  return typeof value === "string" && capabilityById.has(value as AssistantCapabilityId);
}

export function getAssistantCapabilityRouterSummary() {
  return assistantCapabilities.map(({ id, title, description, availability }) => ({
    id,
    title,
    description,
    availability,
  }));
}

function formatCapability(capability: AssistantCapability) {
  const steps = capability.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const examples = capability.examples.length
    ? `\n\nExemplo: ${capability.examples.map((example) => `“${example}”`).join(" ou ")}`
    : "";
  const restrictions = capability.restrictions.length
    ? `\n\n${capability.restrictions.join(" ")}`
    : "";
  const page = capability.page ? `\n\nTela relacionada: ${capability.page}` : "";

  return `**${capability.title}**\n\n${capability.description}\n\n${steps}${examples}${restrictions}${page}`;
}

export function buildAssistantCapabilityHelp(ids: readonly AssistantCapabilityId[]) {
  if (ids.includes("ASSISTANT_OVERVIEW")) {
    const featured = assistantCapabilities.filter((capability) => capability.featured);
    return [
      "**O que a Assistente NK consegue fazer**",
      "",
      ...featured.map((capability) => `- **${capability.title}:** ${capability.description}`),
      "",
      "Toda alteração operacional gera uma prévia para revisão e só acontece após confirmação pelo botão.",
    ].join("\n");
  }

  const selected = ids
    .map((id) => capabilityById.get(id))
    .filter((capability): capability is AssistantCapability => Boolean(capability));

  if (!selected.length) {
    return buildAssistantCapabilityHelp(["ASSISTANT_OVERVIEW"]);
  }

  return selected.map(formatCapability).join("\n\n---\n\n");
}
