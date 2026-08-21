import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CommercialProposalLogin } from "@/components/public-site/commercial-proposal-login";
import {
  COMMERCIAL_PROPOSAL_COOKIE_NAME,
  getCommercialProposalCredentials,
  verifyCommercialProposalSessionToken,
} from "@/lib/commercial-proposal-auth";
import { commercialProposalLogout } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Proposta comercial | NK Estoque",
  robots: { index: false, follow: false },
};

const systemScreens = [
  ["Assistente NK", "Consultas e operações guiadas por linguagem natural.", ["Consulta Estoque, Pedidos, histórico e Estatísticas.", "Prepara entradas, saídas, montagens e desmontagens para revisão.", "Analisa foto de Pedido e sinaliza divergências antes da criação.", "Alterações só acontecem após confirmação explícita."]],
  ["Estoque", "Saldos físicos organizados para leitura rápida.", ["Visão de Servos com kit, Servos sem kit, kits, reparos e peças.", "Pesquisa por código, descrição ou modelo.", "Estoque mínimo e itens que precisam de atenção.", "Detalhes e imagens técnicas quando disponíveis."]],
  ["Entrada", "Registro de itens recebidos com revisão antes da confirmação.", ["Seleção de itens físicos e códigos comerciais.", "Entrada de várias linhas na mesma operação.", "Conferência do saldo antes e depois.", "Registro no histórico após a confirmação."]],
  ["Saída", "Baixa externa com contexto completo da configuração física.", ["Seleção de itens e configurações comerciais.", "Montagem automática quando a composição necessária está disponível.", "Prévia de componentes, saldo e resultado esperado.", "Registro rastreável depois da confirmação."]],
  ["Pedidos", "Acompanhamento da solicitação até a entrada no Estoque.", ["Criação e acompanhamento por número de negociação.", "Status, solicitado, pronto, retirado e pendências por linha.", "Retiradas parciais e finalização do Pedido.", "Entrada no Estoque acompanhada separadamente da retirada."]],
  ["Detalhe do Pedido e retirada", "Leitura linha a linha para operar somente o que está disponível.", ["Quantidades solicitadas, prontas, retiradas e restantes.", "Retiradas parciais com revisão da operação.", "Entrada em Estoque associada às quantidades retiradas válidas.", "Histórico disponível para conferência."]],
  ["Pedido por foto", "Uma foto vira prévia revisável, nunca uma criação automática.", ["Foto pelo celular, galeria ou computador.", "Leitura de negociação, data, códigos, descrições e quantidades.", "Validação contra o catálogo e revisão de divergências.", "Pedido criado somente pelo botão de confirmação."]],
  ["Estatísticas", "Leitura operacional baseada em movimentos registrados.", ["Períodos de 7, 30 ou 90 dias.", "Entradas, saídas externas e movimentos internos separados.", "Rankings e comparações entre períodos.", "Visão de montagens, desmontagens e itens sem movimento."]],
  ["Portal Safisa", "Um ambiente dedicado para o fornecedor informar prontidão.", ["Fornecedor informa novas unidades prontas por item.", "A equipe acompanha itens prontos para retirada.", "A retirada continua sendo feita pelo aplicativo oficial.", "O fornecedor não acessa o sistema interno."]],
  ["Histórico e auditoria", "Cada operação pode ser conferida depois.", ["Lotes, responsáveis, data, horário e origem registrados.", "Detalhe de quantidades e saldos antes e depois.", "Rastreabilidade para conferências e correções."]],
  ["Mobile e PWA", "Operação pensada para o celular, sem abrir mão do desktop.", ["Interface responsiva para celular, tablet e computador.", "Uso no navegador ou instalação como aplicativo.", "Leitura e confirmação adaptadas para toque."]],
] as const;

async function hasCommercialProposalSession() {
  const credentials = getCommercialProposalCredentials();
  if (!credentials) return false;
  const cookieStore = await cookies();
  return verifyCommercialProposalSessionToken(
    cookieStore.get(COMMERCIAL_PROPOSAL_COOKIE_NAME)?.value,
    credentials.sessionSecret,
  );
}

function CommercialProposalContent() {
  return (
    <main className="proposal-page">
      <section className="proposal-hero" aria-labelledby="proposal-title">
        <div className="public-shell">
          <div className="proposal-topbar">
            <p className="public-eyebrow">Proposta comercial</p>
            <form action={commercialProposalLogout}><button type="submit" className="proposal-logout nk-focus">Sair</button></form>
          </div>
          <h1 id="proposal-title">NK Estoque</h1>
          <p>Uma visão detalhada do sistema, das etapas da operação e do investimento.</p>
          <nav className="proposal-anchor-nav" aria-label="Navegação da proposta">
            <a className="nk-focus" href="#visao-do-sistema">Visão do sistema</a>
            <a className="nk-focus" href="#investimento">Investimento</a>
          </nav>
        </div>
      </section>

      <section id="visao-do-sistema" className="proposal-section" aria-labelledby="system-title">
        <div className="public-shell">
          <header className="proposal-section-heading">
            <p className="public-eyebrow">Visão do sistema</p>
            <h2 id="system-title">Cada tela atende uma etapa da operação.</h2>
            <p>Informações atuais, confirmação antes de alterar e histórico rastreável em todo o fluxo.</p>
          </header>
          <div className="proposal-screen-grid">
            {systemScreens.map(([title, summary, points]) => (
              <article key={title} className="proposal-screen-card">
                <h3>{title}</h3>
                <p>{summary}</p>
                <ul>{points.map((point) => <li key={point}>{point}</li>)}</ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="investimento" className="proposal-section proposal-investment-section" aria-labelledby="investment-title">
        <div className="public-shell">
          <header className="proposal-section-heading">
            <p className="public-eyebrow">Investimento</p>
            <h2 id="investment-title">Projeto e implantação</h2>
          </header>

          <div className="proposal-price-card">
            <span>Investimento do projeto</span>
            <strong>R$ 6.000</strong>
            <p>Implantação com etapas claras, preparação da operação e treinamento concluído.</p>
          </div>

          <ol className="proposal-payment-steps" aria-label="Etapas de pagamento">
            <li><span>Etapa 1</span><h3>50% na contratação</h3><strong>R$ 3.000</strong><p>Pago na contratação e no início do projeto.</p></li>
            <li><span>Etapa 2</span><h3>Implantação e preparação</h3><p>Após a contagem e conferência do estoque estar concluída, com os ajustes personalizados combinados e o treinamento para utilização do sistema concluído.</p></li>
            <li><span>Etapa 3</span><h3>50% na conclusão da implantação</h3><strong>R$ 3.000</strong><p>A segunda parcela é paga após a conclusão das etapas de implantação, ajustes personalizados combinados e treinamento.</p></li>
          </ol>

          <div className="proposal-monthly-grid">
            <article className="proposal-monthly-card">
              <p className="public-eyebrow">Mensalidade</p>
              <strong>R$ 220 <small>/ mês</small></strong>
              <p>A mensalidade começa somente após a quitação da segunda parcela de R$ 3.000.</p>
            </article>
            <aside className="proposal-highlight">
              <strong>Durante a implantação não há mensalidade.</strong>
              <p>A mensalidade de R$ 220 começa somente após a conclusão da implantação e o pagamento da segunda parcela.</p>
            </aside>
          </div>

          <section className="proposal-included" aria-labelledby="included-title">
            <p className="public-eyebrow">Incluso na mensalidade</p>
            <h3 id="included-title">Continuidade do sistema</h3>
            <ul>
              <li>Manutenção mensal do sistema</li>
              <li>Atualizações e melhorias do sistema</li>
              <li>Uso da inteligência artificial</li>
              <li>Banco de dados seguro</li>
              <li>Hospedagem</li>
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}

export default async function CommercialProposalPage() {
  const session = await hasCommercialProposalSession();
  if (!session) return <CommercialProposalLogin />;
  return <CommercialProposalContent />;
}
