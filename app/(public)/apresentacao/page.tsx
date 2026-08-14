import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DeviceFrameDesktop, DeviceFrameMobile } from "@/components/public-site/device-frame";

export const metadata: Metadata = {
  title: "NK Estoque | Gestão inteligente de Estoque e Pedidos",
  description: "Conheça o NK Estoque: controle físico, Pedidos, fornecedor, histórico, estatísticas e Assistente NK em uma operação integrada.",
  robots: { index: false, follow: false },
};

const capabilities = [
  ["Estoque", "Saldo físico organizado por Servos com kit, Servos sem kit, kits, reparos e peças."],
  ["Pedidos", "Acompanhamento claro do que foi solicitado, preparado, retirado e recebido."],
  ["Fornecedor", "Prontidão informada em um portal dedicado, sem acesso à operação interna."],
  ["Histórico", "Cada movimento preserva origem, responsável, horário e resultado."],
  ["Estatísticas", "Períodos oficiais, rankings e comparações baseados em movimentos reais."],
  ["Assistente NK", "Consultas e ações preparadas em linguagem natural, com validação e confirmação."],
];

const photoSteps = [
  ["01", "Foto", "O usuário envia uma imagem do Pedido pelo celular ou computador."],
  ["02", "IA interpreta", "A leitura identifica negociação, data, códigos, descrições e quantidades."],
  ["03", "Sistema valida", "O backend confere tudo no catálogo oficial e sinaliza divergências."],
  ["04", "Usuário revisa", "Itens desconhecidos exigem correção ou cadastro controlado."],
  ["05", "Usuário confirma", "Somente o botão explícito autoriza a criação do Pedido."],
  ["06", "Pedido criado", "O resultado é registrado pelo fluxo oficial, com idempotência e auditoria."],
];

const inventoryItems = ["Servos com kit", "Servos sem kit", "Kits avulsos", "Jogos de reparo", "Peças avulsas"];

export default function PresentationPage() {
  return (
    <main>
      <section className="presentation-hero" aria-labelledby="hero-title">
        <div className="public-shell presentation-hero-grid">
          <div className="presentation-hero-copy">
            <p className="public-eyebrow">Gestão inteligente de estoque</p>
            <h1 id="hero-title">Estoque, Pedidos e inteligência artificial em uma operação só.</h1>
            <p className="public-lead">
              O NK Estoque conecta controle físico, Pedidos, fornecedor, histórico, estatísticas e uma Assistente com IA para tornar a operação mais rápida, organizada e segura.
            </p>
            <div className="public-cta-row">
              <Link className="public-button" href="#funcionalidades">Conhecer as funcionalidades</Link>
              <Link className="public-button public-button-secondary" href="/manual">Abrir o manual</Link>
            </div>
            <ul className="hero-trust-list" aria-label="Destaques do produto">
              <li>Controle físico confiável</li>
              <li>Confirmação humana</li>
              <li>Uso no celular e desktop</li>
            </ul>
          </div>

          <div className="hero-visual" aria-label="NK Estoque no desktop e no celular">
            <div className="hero-glow" aria-hidden="true" />
            <DeviceFrameDesktop
              src="/presentation/screenshots/inventory/inventory-overview-desktop.png"
              alt="Tela de Estoque com resumo, pesquisa e categorias do catálogo"
              width={1103}
              height={610}
              priority
              className="hero-desktop"
            />
            <DeviceFrameMobile
              src="/presentation/screenshots/assistant/assistant-context-reference-mobile.png"
              alt="Assistente NK respondendo uma consulta contextual sobre o modelo MBF-025"
              width={1080}
              height={2400}
              priority
              className="hero-mobile"
            />
          </div>
        </div>
      </section>

      <section className="public-section public-section-light" id="funcionalidades" aria-labelledby="integrated-title">
        <div className="public-shell">
          <div className="section-heading section-heading-centered">
            <p className="public-eyebrow">Visão integrada</p>
            <h2 id="integrated-title">Uma operação conectada do início ao histórico.</h2>
            <p>Cada módulo resolve uma etapa específica sem perder a ligação com o estoque físico.</p>
          </div>
          <div className="capability-grid">
            {capabilities.map(([title, description], index) => (
              <article key={title} className="capability-item">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section public-section-dark" id="assistente" aria-labelledby="assistant-title">
        <div className="public-shell split-section split-section-assistant">
          <div className="section-copy section-copy-on-dark">
            <p className="public-eyebrow">Assistente NK</p>
            <h2 id="assistant-title">A operação em linguagem natural, com as regras do sistema.</h2>
            <p>
              A Assistente consulta, interpreta e prepara ações com validação e confirmação. Ela entende código, modelo e o contexto da conversa sem substituir o catálogo nem o banco como fonte da verdade.
            </p>
            <ul className="feature-list">
              <li>Consulta estoque e composição de configurações.</li>
              <li>Responde com Estatísticas oficiais de 7, 30 e 90 dias.</li>
              <li>Prepara entradas, saídas, montagens e operações de Pedido.</li>
              <li>Nunca executa uma mutação apenas porque o usuário escreveu “sim”.</li>
            </ul>
          </div>
          <div className="assistant-visual-stack">
            <DeviceFrameMobile
              src="/presentation/screenshots/assistant/assistant-context-reference-mobile.png"
              alt="Conversa contextual da Assistente NK sobre saldo de Servos com kit"
              width={1080}
              height={2400}
            />
            <DeviceFrameMobile
              src="/presentation/screenshots/assistant/assistant-statistics-reference-mobile.png"
              alt="Assistente NK respondendo uma consulta estatística com ranking oficial"
              width={1080}
              height={2400}
              className="assistant-frame-secondary"
            />
          </div>
        </div>
      </section>

      <section className="public-section photo-order-section" id="pedido-por-foto" aria-labelledby="photo-title">
        <div className="public-shell">
          <div className="section-heading">
            <p className="public-eyebrow">Pedido por foto</p>
            <h2 id="photo-title">Da folha impressa ao Pedido validado.</h2>
            <p>Uma sequência segura transforma leitura visual em dados revisáveis — nunca em escrita automática.</p>
          </div>

          <div className="photo-story">
            <figure className="document-frame">
              <Image
                src="/presentation/screenshots/photo-order/supplier-order-photo-sanitized.png"
                alt="Exemplo sanitizado de Pedido impresso usado para interpretação"
                width={1448}
                height={1086}
                sizes="(max-width: 767px) 92vw, 44vw"
              />
              <figcaption>Documento sanitizado</figcaption>
            </figure>
            <ol className="photo-stepper">
              {photoSteps.map(([number, title, description]) => (
                <li key={number}>
                  <span>{number}</span>
                  <div><h3>{title}</h3><p>{description}</p></div>
                </li>
              ))}
            </ol>
          </div>

          <div className="photo-screens">
            <DeviceFrameMobile
              src="/presentation/screenshots/photo-order/photo-order-upload-mobile.png"
              alt="Assistente NK analisando uma foto de Pedido selecionada na galeria"
              width={1080}
              height={2400}
            />
            <DeviceFrameMobile
              src="/presentation/screenshots/photo-order/photo-order-preview-mobile.png"
              alt="Prévia de Pedido com itens identificados e indicação de revisão"
              width={1080}
              height={2400}
            />
            <DeviceFrameMobile
              src="/presentation/screenshots/photo-order/photo-order-confirm-mobile.png"
              alt="Confirmação explícita da criação do Pedido com resumo das linhas"
              width={1080}
              height={2400}
            />
            <DeviceFrameMobile
              src="/presentation/screenshots/photo-order/photo-order-result-mobile.png"
              alt="Resultado da criação segura do Pedido"
              width={1080}
              height={2400}
            />
          </div>
          <div className="public-note">
            <strong>O sistema não inventa itens.</strong>
            <p>Um código desconhecido fica em revisão e pode ser corrigido ou cadastrado como Peça avulsa por uma ação separada e controlada.</p>
          </div>
        </div>
      </section>

      <section className="public-section public-section-light" id="estoque" aria-labelledby="inventory-title">
        <div className="public-shell split-section split-section-wide">
          <div className="section-copy">
            <p className="public-eyebrow">Estoque físico</p>
            <h2 id="inventory-title">Saldos claros, catálogo pesquisável e reposição orientada.</h2>
            <p>O estoque diferencia o que existe fisicamente e como cada Servo está configurado, sem duplicar componentes.</p>
            <div className="pill-list" aria-label="Tipos controlados no estoque">
              {inventoryItems.map((item) => <span key={item}>{item}</span>)}
            </div>
            <ul className="feature-list">
              <li>Pesquisa por código, descrição ou modelo.</li>
              <li>Filtros, estoque mínimo e alertas de saldo.</li>
              <li>Lista recomendada para apoiar a reposição.</li>
            </ul>
          </div>
          <DeviceFrameDesktop
            src="/presentation/screenshots/inventory/inventory-overview-desktop.png"
            alt="Visão geral do Estoque com totais, pesquisa e categorias físicas"
            width={1103}
            height={610}
          />
        </div>
      </section>

      <section className="public-section orders-section" id="pedidos" aria-labelledby="orders-title">
        <div className="public-shell split-section">
          <div className="orders-visuals">
            <DeviceFrameMobile
              src="/presentation/screenshots/orders/supplier-order-detail-mobile.png"
              alt="Detalhe mobile de um Pedido com quantidades solicitadas, retiradas e prontas"
              width={1080}
              height={2400}
            />
            <DeviceFrameMobile
              src="/presentation/screenshots/safisa/safisa-portal-mobile.png"
              alt="Portal do fornecedor mostrando prontidão por item do Pedido"
              width={1080}
              height={2400}
              className="orders-safisa-frame"
            />
          </div>
          <div className="section-copy">
            <p className="public-eyebrow">Pedidos + fornecedor</p>
            <h2 id="orders-title">Prontidão, retirada e entrada acompanhadas no fluxo certo.</h2>
            <p>
              A equipe acompanha solicitado, pronto para retirar, retirado e pendente de entrada. No Portal do fornecedor / Safisa, o fornecedor informa prontidão sem acessar o sistema interno.
            </p>
            <ul className="feature-list">
              <li>Pedidos parciais e concluídos permanecem legíveis.</li>
              <li>A equipe visualiza novas unidades prontas para retirada.</li>
              <li>Retirada e entrada no Estoque continuam etapas distintas e auditáveis.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="public-section statistics-section" id="estatisticas" aria-labelledby="statistics-title">
        <div className="public-shell split-section split-section-wide">
          <div className="section-copy section-copy-on-dark">
            <p className="public-eyebrow">Estatísticas oficiais</p>
            <h2 id="statistics-title">O que movimentou a operação, sem misturar conceitos.</h2>
            <p>Visões de 7, 30 e 90 dias separam entradas, saídas externas, montagens e desmontagens.</p>
            <div className="metric-strip" aria-label="Períodos disponíveis">
              <span><strong>7</strong> dias</span><span><strong>30</strong> dias</span><span><strong>90</strong> dias</span>
            </div>
            <ul className="feature-list">
              <li>Rankings de Servos com kit e Servos sem kit.</li>
              <li>Kits usados em montagens e itens sem movimento.</li>
              <li>Comparação entre períodos baseada no histórico real.</li>
            </ul>
          </div>
          <DeviceFrameMobile
            src="/presentation/screenshots/statistics/statistics-ranking-mobile.png"
            alt="Ranking mobile de itens mais movimentados no período"
            width={1080}
            height={2400}
          />
        </div>
      </section>

      <section className="public-section safety-section" aria-labelledby="safety-title">
        <div className="public-shell">
          <div className="section-heading section-heading-centered">
            <p className="public-eyebrow">Segurança operacional</p>
            <h2 id="safety-title">Automação sem abrir mão do controle.</h2>
            <p>A inteligência acelera a interpretação; as regras oficiais continuam decidindo o que pode acontecer.</p>
          </div>
          <ol className="safety-flow">
            {[
              ["IA", "interpreta"], ["Backend", "valida"], ["Usuário", "confirma"], ["Banco", "executa"], ["Histórico", "registra"],
            ].map(([actor, action], index) => (
              <li key={actor}><span>{index + 1}</span><strong>{actor}</strong><small>{action}</small></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="public-section mobile-section" aria-labelledby="mobile-title">
        <div className="public-shell mobile-callout">
          <div>
            <p className="public-eyebrow">Mobile + PWA</p>
            <h2 id="mobile-title">A operação acompanha a equipe.</h2>
            <p>Responsivo no celular, confortável no desktop e instalável como aplicativo para acesso rápido no dia a dia.</p>
          </div>
          <div className="mobile-benefits" aria-label="Benefícios mobile">
            <span>Interface responsiva</span><span>Instalação como app</span><span>Controles para toque</span>
          </div>
        </div>
      </section>

      <section className="public-section manual-promo" aria-labelledby="manual-title">
        <div className="public-shell manual-promo-inner">
          <div>
            <p className="public-eyebrow">Central de ajuda</p>
            <h2 id="manual-title">Um manual organizado para cada etapa.</h2>
            <p>Primeiros passos, Estoque, Assistente NK, Pedidos, movimentações, Estatísticas e Portal Safisa.</p>
          </div>
          <Link className="public-button public-button-secondary" href="/manual">Explorar o manual</Link>
        </div>
      </section>

      <section className="presentation-final-cta" aria-labelledby="final-title">
        <div className="public-shell">
          <p className="public-eyebrow">NK Estoque</p>
          <h2 id="final-title">Tecnologia para organizar toda a operação.</h2>
          <div className="public-cta-row public-cta-row-centered">
            <Link className="public-button" href="#funcionalidades">Conhecer as funcionalidades</Link>
            <Link className="public-button public-button-secondary-on-dark" href="/manual">Abrir o manual</Link>
            <Link className="public-text-link" href="/login">Entrar no sistema <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>
    </main>
  );
}
