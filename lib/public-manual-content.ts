export type ManualArticle = {
  slug: string;
  title: string;
  summary: string;
  objective: string;
  whenToUse: string;
  steps: string[];
  expectedResult: string;
  warning?: string;
  image?: { src: string; alt: string; width: number; height: number };
};
export const manualArticles: ManualArticle[] = [
  {
    slug: "primeiros-passos",
    title: "Primeiros passos",
    summary: "Conheça a navegação, os conceitos físicos e a forma segura de operar.",
    objective: "Entender como Estoque, Pedidos, movimentações, histórico e Assistente NK se conectam.",
    whenToUse: "Na primeira utilização do NK Estoque ou ao apresentar o sistema para uma nova pessoa da equipe.",
    steps: ["Entre com sua conta individual.", "Use o menu para acessar Estoque, Pedidos, Entrada e Saída, Estatísticas e Histórico.", "Consulte antes de operar e revise toda prévia antes de confirmar.", "Use Nova conversa na Assistente quando quiser encerrar o contexto atual."],
    expectedResult: "Você identifica rapidamente onde consultar, preparar e acompanhar cada etapa da operação.",
    warning: "Toda pessoa deve usar sua própria conta. O nome cadastrado identifica quem realizou cada operação.",
  },
  {
    slug: "assistente",
    title: "Assistente NK",
    summary: "Faça consultas e prepare ações usando linguagem natural.",
    objective: "Usar a Assistente NK para consultar dados oficiais e preparar operações com segurança.",
    whenToUse: "Quando for mais rápido perguntar por código, modelo, Pedido, saldo, histórico ou Estatísticas.",
    steps: ["Escreva uma pergunta clara ou escolha uma sugestão.", "Confira a resposta e o contexto mostrado no card.", "Para ações operacionais, revise a prévia completa.", "Confirme somente pelo botão específico dentro da prévia."],
    expectedResult: "A Assistente responde com dados atuais ou prepara uma ação que ainda depende de confirmação humana.",
    warning: "Mensagens como “sim”, “pode fazer” ou “confirme” nunca executam uma operação.",
    image: { src: "/presentation/screenshots/assistant/assistant-context-reference-mobile.png", alt: "Assistente NK em uma conversa contextual sobre Estoque", width: 1080, height: 2400 },
  },
  {
    slug: "estoque",
    title: "Estoque",
    summary: "Consulte saldos físicos, configurações e necessidades de reposição.",
    objective: "Encontrar rapidamente um item e compreender onde cada unidade está fisicamente.",
    whenToUse: "Para consultar saldo, estoque mínimo, composição ou itens recomendados para reposição.",
    steps: ["Abra Estoque.", "Pesquise por código, descrição ou modelo.", "Use os filtros para reduzir a lista.", "Abra o item para consultar detalhes e imagens disponíveis."],
    expectedResult: "Você visualiza Servos com kit, Servos sem kit, kits avulsos, reparos e peças sem duplicar o saldo físico.",
    image: { src: "/presentation/screenshots/inventory/inventory-overview-desktop.png", alt: "Tela de Estoque com resumo, pesquisa e categorias", width: 1103, height: 610 },
  },
  {
    slug: "entrada-saida",
    title: "Entrada e Saída",
    summary: "Registre movimentações externas mantendo saldo e histórico consistentes.",
    objective: "Adicionar ou retirar unidades do Estoque pelo fluxo correspondente.",
    whenToUse: "Após receber itens, registrar uma saída externa ou fazer uma operação manual autorizada.",
    steps: ["Escolha Entrada ou Saída no menu.", "Selecione o item físico ou a configuração comercial correta.", "Informe a quantidade como variação da operação.", "Revise o saldo anterior e o saldo resultante antes de confirmar."],
    expectedResult: "O saldo é atualizado e um lote auditável aparece no Histórico.",
    warning: "Entrada por Pedido e retirada no fornecedor são etapas próprias. Não use uma movimentação manual para substituir o fluxo oficial.",
  },
  {
    slug: "pedidos",
    title: "Pedidos",
    summary: "Acompanhe solicitação, prontidão, retirada e entrada no Estoque.",
    objective: "Visualizar o andamento real de um Pedido e executar cada etapa no momento correto.",
    whenToUse: "Para criar, consultar, retirar, lançar no Estoque ou finalizar um Pedido do fornecedor.",
    steps: ["Abra Pedidos e selecione a negociação.", "Confira solicitado, pronto para retirar, retirado e faltante.", "Registre a retirada disponível.", "Acompanhe separadamente o que ainda aguarda entrada no Estoque."],
    expectedResult: "O Pedido reflete o andamento no fornecedor e o Estoque recebe somente quantidades retiradas válidas.",
    warning: "Finalizar um Pedido encerra a retirada atual; não significa que tudo já entrou no Estoque.",
    image: { src: "/presentation/screenshots/orders/supplier-order-detail-mobile.png", alt: "Detalhe mobile de um Pedido com quantidades por linha", width: 1080, height: 2400 },
  },
  {
    slug: "montagem",
    title: "Montagem e desmontagem",
    summary: "Mude a configuração do Estoque sem criar ou destruir componentes.",
    objective: "Associar ou separar um kit compatível de um Servo mantendo os totais físicos.",
    whenToUse: "Ao preparar um Servo com kit ou devolver Servo e kit ao saldo avulso.",
    steps: ["Escolha a operação de montagem ou desmontagem.", "Selecione a configuração comercial exata.", "Informe a quantidade.", "Revise todos os componentes consumidos ou devolvidos antes de confirmar."],
    expectedResult: "Os saldos de Servo sem kit, kit avulso e configuração montada mudam juntos na mesma transação.",
    warning: "Montagem e desmontagem são movimentos internos; não contam como entradas ou saídas externas.",
  },
  {
    slug: "estatisticas",
    title: "Estatísticas",
    summary: "Analise movimentos oficiais em 7, 30 ou 90 dias.",
    objective: "Compreender entradas, saídas externas e movimentações internas sem misturar categorias.",
    whenToUse: "Para acompanhar volume, rankings, comparação de períodos e itens sem movimento.",
    steps: ["Abra Estatísticas.", "Escolha 7, 30 ou 90 dias.", "Consulte os totais e o movimento no tempo.", "Use os rankings para detalhar Servos com kit, Servos sem kit e kits usados em montagens."],
    expectedResult: "Você obtém uma leitura operacional baseada no Histórico, com aliases agrupados corretamente.",
    warning: "Saída externa é movimento físico; não representa faturamento ou venda financeira.",
    image: { src: "/presentation/screenshots/statistics/statistics-ranking-mobile.png", alt: "Ranking de itens mais movimentados nas Estatísticas", width: 1080, height: 2400 },
  },
  {
    slug: "safisa",
    title: "Portal Safisa",
    summary: "Acompanhe a prontidão informada pelo fornecedor sem expor o sistema interno.",
    objective: "Entender como a prontidão chega à equipe e como ela se relaciona com a retirada.",
    whenToUse: "Quando um Pedido publicado ao fornecedor possui novas unidades prontas.",
    steps: ["A Safisa informa novas unidades prontas no portal dedicado.", "A equipe interna recebe o alerta correspondente.", "Abra o Pedido para conferir as linhas prontas.", "Registre a retirada pelo aplicativo oficial."],
    expectedResult: "A prontidão fica visível e a retirada continua controlada pela equipe interna.",
    warning: "A Safisa não altera Estoque, negociação ou estrutura do Pedido.",
    image: { src: "/presentation/screenshots/safisa/safisa-portal-mobile.png", alt: "Portal Safisa exibindo prontidão por item", width: 1080, height: 2400 },
  },
  {
    slug: "historico",
    title: "Histórico",
    summary: "Consulte lotes, responsáveis e saldos antes e depois de cada operação.",
    objective: "Rastrear o que aconteceu no Estoque e quem confirmou a operação.",
    whenToUse: "Ao conferir uma movimentação, investigar uma divergência ou validar uma operação concluída.",
    steps: ["Abra Histórico.", "Localize o lote por data e tipo.", "Abra o detalhe para ver linhas e quantidades.", "Compare saldo anterior, variação e saldo posterior."],
    expectedResult: "Você encontra uma trilha permanente da operação, incluindo usuário, origem e horário.",
    warning: "O Histórico não é apagado. Uma correção deve gerar uma nova operação adequada, não alterar o registro anterior.",
  },
  {
    slug: "faq",
    title: "Perguntas frequentes",
    summary: "Respostas rápidas para dúvidas comuns da operação.",
    objective: "Resolver dúvidas recorrentes sem confundir conceitos do domínio.",
    whenToUse: "Sempre que precisar confirmar o significado de saldo, Pedido, prontidão ou confirmação.",
    steps: ["Servo com kit é uma configuração física de Servo + kit, não um item físico adicional.", "Retirada no fornecedor não é a mesma coisa que entrada no Estoque.", "Montagem e desmontagem não alteram os totais físicos.", "A Assistente prepara ações, mas somente o botão explícito confirma."],
    expectedResult: "Os principais conceitos ficam alinhados antes de qualquer operação.",
  },
];

export function getManualArticle(slug: string) {
  return manualArticles.find((article) => article.slug === slug) ?? null;
}
