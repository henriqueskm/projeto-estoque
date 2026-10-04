# NK PR #80 — Design & Motion Review

## 1. Executive Summary

Auditoria realizada em 04/10/2026, sem implementar correções. Base: `d464473c8e7ff3da326c98ab2da4dcedb5af2a08`. Branch: `codex/nk-pr-80-design-motion-review`.

| Resultado | Quantidade |
| --- | ---: |
| Findings únicos | 8 |
| P0 | 0 |
| P1 | 1 |
| P2 | 6 |
| P3 | 1 |
| SYSTEMIC | 3 |
| Relacionados a mobile | 8 |
| Relacionados a motion | 1 |
| Decisões NO MOTION NEEDED | 5 |
| Novas animações recomendadas | 0 |

Os recortes mobile concentram as melhorias demonstráveis: nome acessível do filtro, alvos de quantidade pequenos, título cortado, acesso ao carrinho e densidade dos filtros. Não há evidência para redesenhar o aplicativo ou introduzir transições de página. Instant Navigation, saldos operacionais explícitos, drafts e fechamento de confirmações ao navegar devem permanecer.

Top 5: nome acessível de **Filtros**; título do **Histórico** legível em 320 px; alvos do stepper de **Pedidos**; acesso próximo ao **carrinho**; encerramento do **drawer** coerente com reduced motion. As demais propostas ficam para seleção do Lead, não para execução automática.

Os números geométricos abaixo são observações dos estados indicados, não benchmarks de performance, médias ou estimativas de uso real. Nenhuma mutação operacional foi confirmada.

## 2. Metodologia

1. Inspeção do código antes do browser: tokens, componentes compartilhados, campos, botões, dialogs, menus, accordions, loading, feedback, CSS e ciclos de navegação.
2. Hipóteses verificadas no aplicativo autenticado: nome acessível de controles icon-only; alcance do carrinho após resultados; títulos e labels longos; tamanho dos steppers; foco e encerramento dos dialogs; timers de reduced motion; retorno de rotas com Activity.
3. Screenshots temporárias, árvore acessível e geometria DOM para distinguir overflow da página de clipping interno. Um snapshot imediatamente após navegação não foi tratado como pintura final.
4. Interações por teclado, navegação client-side e Back/Forward. Abertura de dialogs sem submit. Drafts de Entrada/Saída criados pela auditoria, revisados e removidos ao final.
5. Emulação de reduced motion e casos adversariais sanitizados; nenhuma alteração do DOM de negócio ou instalação de DemoToggle.
6. Agrupamento de problemas compartilhados, preservação de decisões boas e ordenação por impacto/esforço. Todas as recomendações são propostas, não alterações aplicadas.

Fontes locais principais: `app/globals.css`, `components/app-sidebar.tsx`, componentes de diálogo/menu e busca, `inventory-workspace.tsx`, `inventory-bundle-table.tsx`, `orders-workspace.tsx`, `inbound-entry-flow.tsx`, `outbound-entry-flow.tsx`, páginas de Aplicações/Estatísticas/Histórico e cleanup transacional/Workspace State.

## 3. Ferramentas e skills utilizadas

| Skill | Uso efetivo nesta auditoria |
| --- | --- |
| `nk-builder` | Limites do escopo, segurança operacional e entrega ao Lead sem Reviewer automático |
| `emil-design-eng` | Hierarquia, densidade, affordance, consistência e propostas Before/After/Why |
| `mobile-native` | Touch targets, inputs, viewport, drawer e limites da emulação |
| `playwright-cli` | Sessão isolada local, snapshots, geometria, screenshot e reduced motion da superfície pública |
| `review-animations` | Revisão do motion existente e comparação com os critérios do `STANDARDS.md` |
| `improve-animations` | Inventário, impacto e plano; sem melhorar source nesta PR |
| `find-animation-opportunities` | Gate função/frequência/velocidade e rejeição de motion sem benefício |
| `transitions-dev` | Consulta das recipes de menu/modal após avaliar a necessidade, não para escolher efeitos por estética |
| `transitions-polish` | Review de valores por uso; sem executar polish, fix ou revamp |
| `break-ui` | Casos adversariais sanitizados e tabela do que resistiu/quebrou |
| `impeccable` (complementar, disponível no ambiente) | Checagem técnica read-only e triagem de falsos positivos, sem instalar/atualizar a skill |

Ferramentas instaladas na #79 não foram atualizadas. CLI local: `@playwright/cli@0.1.22`, sempre `npx --no-install playwright-cli`, sessão `nk80-audit`. Revisões registradas pela #79: Emil `e8a175de22ae1e49370fc144c1f3bb9aeedf988d`; Transitions `3bc58021c69725d8bf42108632ac6cf14f2b1d3c`.

O CLI isolado abriu produção e foi corretamente redirecionado para `/login`: não possuía sessão humana. Nele foram verificados heading, input sem envio, quatro viewports, screenshot ignorada, console e comando `set-reduced-motion reduce`; preferência limpa e sessão encerrada. Resultado geométrico: larguras 320/375/768/1440 iguais ao `scrollWidth` da página de login; zero mensagens de console nessa sessão.

A auditoria das oito áreas protegidas usou o navegador Chrome autenticado permitido pelo ambiente, em aba dedicada, com locators, snapshots, screenshots e diagnóstico DOM/CDP. Nenhum cookie, token ou storage state foi copiado/exportado. Evidências visuais autenticadas não foram commitadas.

## 4. Viewports e cobertura

| Área | 320 × 800 | 375 × 812 | 768 × 1024 | 1440 × 900 | Amostra principal |
| --- | --- | --- | --- | --- | --- |
| Assistente | Sim | Sim | Sim | Sim | Attention, composer, consulta determinística e resposta estruturada |
| Estoque | Sim | Sim | Sim | Sim | Cards, busca/filtros, tabelas, menu, dialogs e recomendações |
| Pedidos | Sim | Sim | Sim | Sim | Ativos/histórico, detalhe, criação/edição e confirmação sem submit |
| Entrada | Sim | Sim | Sim | Sim | Busca unificada, seleção, carrinho e review local |
| Saída | Sim | Sim | Sim | Sim | Busca de conjunto, carrinho, review válido e insuficiente |
| Aplicações | Sim | Sim | Sim | Sim | Marcas, listagem, busca e nenhum resultado |
| Estatísticas | Sim | Sim | Sim | Sim | Métricas, períodos, gráfico e leitura de labels |
| Histórico | Sim | Sim | Sim | Sim | Header, filtros, listagem, detalhe e segunda página |

Cobertura significa inspeção do estado principal em cada viewport, não repetição de todos os fluxos em todas as dimensões. Modal Venda também foi inspecionado em **320 × 480**, com scroll interno e footer alcançável. Drawer/foco/reduced motion foram amostrados em 320 px.

## 5. Limitações e segurança da evidência

- Preview autenticado: `https://projeto-estoque-sp4o-git-codex-nk-p-b09da0-henrqueskms-projects.vercel.app`. O source do aplicativo entre o HEAD final da #78 (`213d82f29ff3524d9f83d156fd31bde9a883b124`) e esta base é idêntico: o diff contém somente tooling da #79. O SHA efetivamente servido pelo alias não foi comprovado pela API de deployments; não afirmar que o browser validou criptograficamente o deployment do SHA de main.
- A toolbar do Preview interceptou cliques e acrescentou `__vercel_draft=1` à aba dedicada. Isso foi separado dos problemas do app. Testes posteriores não são evidência de performance/cache em produção. Nenhuma configuração de projeto ou dado operacional foi alterado pela auditoria.
- A aba original do usuário não foi manipulada. Drafts/conversa locais criados pela auditoria foram limpos. Ao concluir, o ambiente perdeu a conexão de debugger com a aba dedicada; sua limpeza final/remoção do override de viewport não pôde ser confirmada. A sessão separada do CLI foi encerrada normalmente.
- Emulação desktop de viewport não comprova teclado virtual, safe areas de hardware, hover sticky em touch real ou zoom de inputs no iOS. Esses casos precisam de aparelho real; não são descritos como falhas observadas.
- Não houve criação de pedido nem confirmação de Entrada, Saída, Venda, Ajuste, mínimo, Montagem ou Desmontagem. Estados de sucesso/receipt, execução pendente real e erros remotos pós-submit foram avaliados somente no source; não foram fabricados para testar.
- Não havia pedido de histórico adequado para reproduzir todas as variações de finalização/entrada vinculada. Os dialogs disponíveis foram inspecionados; os demais têm cobertura de código, não prova visual completa.
- Sem medição de contraste completa, leitor de tela real, FPS, custos de Supabase ou latência end-to-end. Ausência de finding não é certificação WCAG ou benchmark.
- Captura longa de network teve buffer truncado. Na amostra nova e limitada de navegação entre Entrada, Saída, Aplicações, Estatísticas e Histórico: **51 eventos, sem truncamento, 0 respostas HTTP ≥400 e 5 fetches cancelados `net::ERR_ABORTED`** associados à navegação/preload, sem erro visível. Não foram classificados como falhas inesperadas. Console autenticado observado: nenhuma mensagem error/warn capturada; nenhuma hydration/React warning observada nessa amostra.
- Uma invocação de help do CLI terminou com assertion de encerramento do Node no Windows. Os comandos do smoke executaram depois com sucesso; ferramenta não foi atualizada nem produto alterado para contornar isso.

## 6. Findings P0/P1

Nenhum P0 observado nas amostras. Um P1:

### NK-UX-001 — Filtro mobile sem nome acessível

- **Área:** Estoque; `inventory-workspace.tsx`, botão que controla `inventory-filter-panel`.
- **Viewport:** 320 e 375 px; comparação em 768/1440 px.
- **Severidade / categoria:** P1 — Accessibility / Focus/keyboard.
- **Problema observado:** o botão de filtros vira apenas ícone abaixo de 430 px e perde seu nome acessível.
- **Evidência:** texto `Filtros` em `hidden min-[430px]:inline`, SVG decorativo e ausência de `aria-label`; snapshot mobile expõe botão sem nome. `aria-expanded`/`aria-controls` existem, mas não nomeiam sua função. No desktop o texto aparece.
- **Por que importa:** leitor de tela encontra um controle importante sem identificação; a mesma tarefa disponível no desktop fica menos compreensível no mobile. Relaciona-se a nome/função de controle (WCAG 4.1.2), sem alegar auditoria WCAG completa.
- **Recomendação:** nome acessível constante, por exemplo `Filtros do estoque`; preservar ícone compacto, foco, estado expandido e filtros persistidos.
- **Skill:** emil-design-eng, mobile-native; checagem técnica complementar de acessibilidade.
- **Impacto / esforço:** Alto / XS.
- **Risco de regressão:** Baixo; testar nome acessível nos dois breakpoints sem mudar layout.
- **Precisa motion?** NÃO.

## 7. Findings P2

### NK-UX-002 — Stepper de Pedidos pequeno para operação touch — SYSTEMIC

- **Área:** Pedidos, componente compartilhado de quantidade em formulário/edição; `orders-workspace.tsx`, controles `size-8` e input `h-8 w-8 text-xs`.
- **Viewport:** 320/375 px; formulário aberto também em tablet/desktop.
- **Severidade / categoria:** P2 — Touch / Mobile.
- **Problema observado:** aumentar/diminuir exige tocar em alvos de 32 × 32 px próximos; valor editável tem fonte de 12 px.
- **Evidência:** dimensões DOM e classes confirmam 32 px no formulário de edição. Outros controles operacionais usam 44–48 px. Não houve prova de erro de toque ou zoom de teclado em aparelho real.
- **Por que importa:** quantidade é uma tarefa recorrente; o alvo menor exige precisão desnecessária. 44 px é a meta de conforto NK/skills, não uma alegação automática de violação WCAG 2.5.8 para todo alvo de 32 px.
- **Recomendação:** ampliar a área efetiva de toque para aproximadamente 44 px e tornar o input legível, sem mudar limites, valores, eventos ou densidade desktop desnecessariamente.
- **Skill:** mobile-native, emil-design-eng, break-ui.
- **Impacto / esforço:** Alto / S.
- **Risco de regressão:** Médio; largura da linha, números grandes e layout de edição em 320 px.
- **Precisa motion?** NÃO.

### NK-UX-003 — Título do Histórico cortado em 320 px

- **Área:** Histórico, header de `historico/page.tsx`.
- **Viewport:** 320 × 800; comparação em 375/768/1440 px.
- **Severidade / categoria:** P2 — Responsive / Visual hierarchy.
- **Problema observado:** a palavra longa do título ultrapassa a coluna ao lado do ícone e é cortada pelo contêiner.
- **Evidência:** screenshot de 320 px mostra o corte de “movimentações”; ícone de 44 px + gap e heading de 30 px deixam coluna estreita. O header possui `overflow-hidden`. A página não apresenta scroll horizontal, mas isso não impede clipping interno.
- **Por que importa:** o título principal perde legibilidade logo na abertura da área.
- **Recomendação:** adaptar o header estreito (posição do ícone, tamanho responsivo ou wrapping seguro) sem reduzir toda a tipografia do aplicativo.
- **Skill:** emil-design-eng, mobile-native, break-ui.
- **Impacto / esforço:** Alto / S.
- **Risco de regressão:** Baixo; conferir 320/375/768/1440 e texto ampliado.
- **Precisa motion?** NÃO.

### NK-UX-004 — Filtros do Histórico dominam a primeira tela mobile

- **Área:** Histórico, painel de filtros.
- **Viewport:** 320 × 800; comparação desktop.
- **Severidade / categoria:** P2 — Mobile / Layout.
- **Problema observado:** seis campos e ações permanecem expandidos antes da lista, impondo bastante scroll mesmo sem filtro específico.
- **Evidência:** painel observado com cerca de 750 px de altura, começando em y≈482; heading dos resultados em y≈1276 no estado inicial de 320 px.
- **Por que importa:** consultar as últimas movimentações exige atravessar um formulário inteiro. Os filtros são úteis, mas competem com o conteúdo primário.
- **Recomendação:** apresentação mobile compacta de filtros avançados com indicação de filtros ativos; preservar acesso explícito, query parameters e valores atuais. Não ocultar silenciosamente critérios aplicados.
- **Skill:** emil-design-eng, mobile-native.
- **Impacto / esforço:** Médio / M.
- **Risco de regressão:** Médio; URLs filtradas, navegação/paginação e foco ao expandir.
- **Precisa motion?** NÃO; disclosure imediato é suficiente.

### NK-UX-005 — Carrinho distante da seleção em buscas com vários resultados — SYSTEMIC

- **Área:** Entrada e Saída; resultados compartilhados e carrinho abaixo da busca.
- **Viewport:** 320 × 800; amostra `MBF015` na Entrada e comparação do fluxo da Saída.
- **Severidade / categoria:** P2 — Navigation / Mobile / Feedback.
- **Problema observado:** o item indica corretamente “adicionado”, mas quantidade/carrinho ficam longe quando a lista de resultados é longa; não há atalho próximo à seleção.
- **Evidência:** na busca com dez resultados, após adicionar uma linha, o primeiro campo de quantidade ficou em y≈1719. O feedback local ✓ funcionou; o problema é alcance do próximo passo, não perda de seleção.
- **Por que importa:** o usuário precisa percorrer resultados que já não interessam para editar quantidade/revisar. Isso aumenta custo de uma tarefa diária.
- **Recomendação:** atalho compacto `Ver carrinho (N)` próximo à área de pesquisa/resultados, levando ao carrinho existente. Evitar scroll automático surpresa, duplicar review, overlay que cubra resultados ou alterações no writer.
- **Skill:** emil-design-eng, mobile-native, break-ui.
- **Impacto / esforço:** Alto / S.
- **Risco de regressão:** Médio; manter foco, draft/review, deduplicação e posição de scroll úteis.
- **Precisa motion?** NÃO; usar comportamento de navegação/foco coerente com reduced motion, sem animação nova.

### NK-UX-006 — Resumo duplicado ocupa espaço na Lista recomendada mobile

- **Área:** Estoque/Assistente → Lista recomendada, bottom sheet mobile.
- **Viewport:** 320 × 800.
- **Severidade / categoria:** P2 — Mobile / Visual hierarchy / Layout.
- **Problema observado:** três tiles de resumo e três controles de categorias repetem contagens e consomem grande parte do sheet antes das recomendações.
- **Evidência:** tabs observados com cerca de 88 px de altura; primeiro card começa aproximadamente em y≈480. Sheet ocupa x=0, y≈48, width=320, height≈752; o scroll interno funciona.
- **Por que importa:** o conteúdo que motivou a abertura fica abaixo de uma camada redundante de resumo. Não é falha de abertura, bloqueio ou truncamento da lista.
- **Recomendação:** consolidar contagens nos controles de categoria ou compactar o resumo somente em narrow mobile. Preservar labels, números, filtros, abertura local, deep link, Escape e fechamento pelo X.
- **Skill:** emil-design-eng, mobile-native.
- **Impacto / esforço:** Médio / S.
- **Risco de regressão:** Médio; acessibilidade dos controles e diferenças sheet/dialog.
- **Precisa motion?** NÃO.

### NK-UX-007 — Reduced motion não elimina espera de encerramento do drawer — SYSTEMIC

- **Área:** drawer mobile compartilhado; `components/app-sidebar.tsx`, `closeDrawer`, timer de 240 ms.
- **Viewport:** 320 × 800, `prefers-reduced-motion: reduce` emulado.
- **Severidade / categoria:** P2 — Motion / Accessibility / Focus/keyboard.
- **Problema observado:** CSS torna a animação quase instantânea, mas o ciclo JS continua aguardando o timeout antes de remover o drawer e devolver o foco.
- **Evidência:** duração computada de `0.00001s` (0,01 ms) com reduce; medição única de Escape até remoção do dialog ≈257 ms por observador DOM temporário, coerente com o timer fixo de 240 ms do source. Não é média/benchmark. Foco retornou ao botão de abrir após o cleanup/RAF.
- **Por que importa:** preferência de movimento reduzido e lifecycle ficam desalinhados; overlay/foco continuam presos à janela de uma animação que praticamente não ocorre.
- **Recomendação:** fazer o encerramento respeitar reduced motion e o término real da transição, com fallback seguro. Manter trap, scroll lock, cancelamento de timer e retorno do foco. Não remover motion normal que já comunica a origem do drawer.
- **Skill:** review-animations, improve-animations, mobile-native; transitions-polish em review por uso.
- **Impacto / esforço:** Médio / S.
- **Risco de regressão:** Médio; abrir/fechar rápido, Escape, navegação e foco.
- **Precisa motion?** NÃO — corrigir lifecycle do motion existente, não criar efeito. Recipes `05-menu-dropdown`/`06-modal` são referências de função/foco, não justificam trocar duração por token numericamente próximo.

## 8. Findings P3

### NK-UX-008 — Label “Desmontagens” ultrapassa sua caixa em 320 px

- **Área:** Estatísticas, card de movimentações internas.
- **Viewport:** 320 × 800; comparação em 375/768/1440 px.
- **Severidade / categoria:** P3 — Responsive / Consistency.
- **Problema observado:** tracking do label longo invade o espaço de padding disponível no card estreito.
- **Evidência:** label de 12 px com letter-spacing≈1,44 px, largura disponível 107 px e `scrollWidth` 121 px. Não houve overflow horizontal da página; é uma inconsistência interna do label.
- **Por que importa:** reduz o acabamento/legibilidade de uma métrica, sem impedir a consulta.
- **Recomendação:** reduzir tracking nesse recorte ou permitir wrapping apropriado, mantendo nome e valor. Não animar número nem mudar regra estatística.
- **Skill:** emil-design-eng, break-ui, mobile-native.
- **Impacto / esforço:** Baixo / XS.
- **Risco de regressão:** Baixo; comparar os demais labels e os quatro viewports.
- **Precisa motion?** NÃO.

## 9. Findings sistêmicos e Before / After / Why

SYSTEMIC significa uma causa compartilhada, não várias cópias do mesmo finding: **002** (stepper reutilizado em Pedidos), **005** (seleção/carrinho de Entrada e Saída) e **007** (drawer de todas as rotas). Não há evidência para padronizar todos os dialogs ou botões indiscriminadamente.

| Before observado | After proposto, NÃO aplicado | Why |
| --- | --- | --- |
| Filtro icon-only sem nome | Mesmo botão com nome acessível constante | Identificação sem consumir largura |
| Quantidade em alvo 32 px | Hit area confortável, valor legível | Precisão touch em operação recorrente |
| Heading cortado em 320 px | Header responsivo com título inteiro | Hierarquia principal compreensível |
| Seis filtros expandidos antes da lista | Filtros mobile compactos com indicação ativa | Acesso mais direto às movimentações |
| Carrinho distante dos resultados | Atalho para o carrinho já existente | Próximo passo encontrado sem novo fluxo |
| Contagens repetidas antes das recomendações | Contagens consolidadas no mobile | Mais conteúdo útil no primeiro viewport |
| CSS reduced instantâneo + timer fixo | Lifecycle compatível com a preferência | Foco/overlay liberados coerentemente |
| Tracking ocupa mais que o label | Wrapping/tracking adaptado ao espaço | Legibilidade sem alterar métricas |

## 10. Motion Audit

| Padrão existente | Valores/uso no source | Veredito |
| --- | --- | --- |
| Dialog animado compartilhado | 180 ms, cubic-bezier(.22,1,.36,1), opacity + translateY(12px) + scale(.985→1) | Entrada curta e moderada; manter. Não trocar scale/duração só para coincidir com recipe |
| Drawer abrindo | 260 ms, cubic-bezier(.22,1,.36,1), translateX(-100%→0), opacity .86→1 | Continuidade espacial útil, abaixo de 300 ms; manter |
| Drawer fechando | 240 ms, cubic-bezier(.4,0,1,1); backdrop 240 ms ease-in | Funciona no modo normal; gap de reduced motion em 007 |
| Backdrop abrindo | 180 ms ease-out | Discreto, sem efeito decorativo pesado |
| Chevron/hover | 150/200 ms conforme classes; pequenos rotate/translate/scale | Não encontrado atraso bloqueante; chevron não exige animação da lista inteira |
| Loading | Shells e feedback textual; pulse em algumas áreas | Informação continua compreensível sem pulse; sem duração mínima artificial |
| Reduced motion global | Animation/transition 0,01 ms, scroll auto | Amostra funcional legível; lifecycle do drawer precisa alinhamento, não remover todo o mecanismo |

Transitions review foi uma inspeção read-only equivalente à revisão pedida, não execução de `transitions polish`. Os valores ad-hoc acima foram registrados por **uso**: `.985` de modal não precisa virar `.96`, nem 180 ms virar um token de 250 ms só por existir. Menus já acessíveis não precisam ganhar blur/scale. As recipes foram consultadas como referência, não copiadas.

Não foi observada animação de página bloqueando shells, blur grande no fluxo operacional ou contadores animados atrasando leitura. Não foram medidos FPS/compositor/layout thrashing. Motion da superfície pública de apresentação não é confundido com o workspace autenticado.

## 11. Animation Opportunities

Gate aplicado: frequência → propósito → velocidade → necessidade funcional. **Nenhuma nova animação passou o gate com evidência suficiente nesta auditoria.**

| Candidato | Propósito possível | Decisão |
| --- | --- | --- |
| Página antiga → nova | Continuidade | Rejeitar: shell imediato já resolve; não mascarar latência |
| Resultado → carrinho | Mostrar adição | ✓/Adicionado já confirma; falta é alcance do carrinho, não animação |
| Mudança de saldo | Explicar consequência | Before/after do review e ledger são melhores; leitura exata deve ser imediata |
| Expandir famílias/tabelas | Revelar hierarquia | São blocos grandes/frequentes; chevron e estrutura existentes bastam |
| Sucesso após confirmação | Confirmar operação | Não validado por submit real; manter feedback existente e não propor celebração por hipótese |

Somente 007 recomenda ajustar a integração do motion existente com lifecycle. Nenhuma recipe nova deve ser implementada como consequência automática deste relatório.

## 12. NO MOTION NEEDED

1. **Navegação/shells da #78:** sem fade de página, splash, minimum loading duration ou bloqueio antes de mostrar o shell.
2. **Busca unificada e “Adicionado”:** resultados e affordance textual já comunicam a seleção; não atrasar typing/render.
3. **Números operacionais e tabelas:** saldo livre/montado/pronto deve estar disponível imediatamente; sem counting animation.
4. **Accordions com catálogo volumoso:** manter expansão direta e indicador de estado; evitar longas animações de altura.
5. **Métricas/gráficos de Estatísticas:** rótulos e valores acessíveis importam mais que draw-in decorativo.

## 13. Mobile Audit

Sem overflow horizontal de página nos estados normais medidos das oito áreas e do login nos quatro viewports. Isso não invalida clipping interno de 003/008.

Pontos positivos: botão +/✓ com nome completo e hit area confortável; categorias na busca unificada; modal Venda com scroll interno em altura pequena; códigos destacados; menus contidos em 320 px; marcas em grid de duas colunas; drawer com botão de fechar e foco; review sem saldo/capacidade confundidos.

Prioridades mobile: 001–008. Descrições da busca usam densidade e wrapping adequados na amostra; não aumentar altura de todas as linhas por precaução. Inputs principais de busca/formulário observados com fonte de 16 px; o stepper menor é tratado separadamente em 002. Keyboard virtual, safe-area física e tap highlight real permanecem como limitações de hardware, não bugs concluídos.

## 14. Accessibility / Focus

- Menus de Estoque: abertura por teclado, navegação e Escape funcionaram; trigger recuperou foco.
- Venda em 320 × 480: Tab/Shift+Tab circularam dentro do dialog; footer foi alcançável por scroll; Escape fechou e retornou ao contexto.
- Novo Pedido: foco inicial no campo, trap entre controles/ações e Escape funcionando; close button acessível. Confirmação de cancelamento foi apenas aberta e dispensada.
- Drawer: foco inicial no fechamento, trap e retorno ao trigger; gap de espera com reduce descrito em 007.
- Lista recomendada: X de 44 px, Escape e scroll interno funcionaram; foco inicial identificável.
- Gráfico: foco no elemento com descrição acessível dos valores; ausência de `role=tooltip` não foi tomada isoladamente como defeito.
- Filtro do Estoque: exceção confirmada de nome acessível em 001.

Não foi executada certificação automática de acessibilidade nem teste com VoiceOver/TalkBack. Não presumir que todo alvo menor que 44 px viola WCAG ou que todas as cores passam AA sem medição.

## 15. Break UI

Sem DemoToggle, fixtures de produção, alteração de catálogo ou submit de operação. Apenas inputs locais sanitizados e estados reais read-only.

| Caso | O que quebrou / resistiu | Decisão |
| --- | --- | --- |
| 320 px + título longo do Histórico | Título cortado | 003; futura adaptação localizada |
| 320 px + label longo de Estatísticas | Label ultrapassa caixa interna | 008; futuro ajuste de tracking/wrapping |
| Quantidade local 9999 na Entrada | Review e formatação mantiveram estrutura, sem overflow de página | KEEP; nenhum recebimento confirmado |
| 9999 em Saída de bundle com saldo insuficiente | Preview mostrou insuficiência e confirmação desabilitada | KEEP; valor previsto negativo é simulação, não saldo gravado |
| Descrição local longa no draft | Layout/review mantiveram leitura | KEEP; descrição limpa após teste |
| Código local longo plausível no formulário Nova peça | Campo contido, sem empurrar página | KEEP; peça não adicionada nem criada |
| Dez resultados na busca mobile | Lista legível, mas carrinho distante | 005; não culpar busca nem adicionar abas |
| Aplicações sem resultado | Mensagem clara e filtros ainda acessíveis | KEEP |
| Pedidos → histórico vazio | Empty state compreensível | KEEP |
| Venda 320 × 480 | Scroll interno e ações acessíveis | KEEP |
| Reduced motion | Feedback permaneceu legível; drawer manteve timer | 007, não redesenhar todos os modais |

Não se fabricou nome de usuário, código persistido, pedido ou erro de rede. Estados de lista gigantesca, número acima dos limites do banco e mensagem de erro remota pós-submit não possuem prova visual nesta rodada. Limites do source não equivalem a teste realizado.

## 16. KEEP — não alterar

1. **Instant Navigation:** shells surgem antes dos dados; preservar Cache Components, Partial Prefetching, streaming, `connection()` e instrumentação. Nenhum número de latência novo foi atribuído a esta auditoria.
2. **Semântica de saldo:** Estoque distingue item livre, configuração montada e conjunto pronto; físico/embutido e capacidade são informações secundárias, não saldo vendável.
3. **Busca flexível e unificada:** `MBF015`, código comercial e bundle encontram resultados tipados sem abrir categorias; pesquisa vazia mostra orientação, não catálogo inteiro.
4. **Botão compartilhado +/✓ no mobile:** compacto, acessível e consistente; desktop mantém Adicionar/Adicionado.
5. **Venda segura:** indisponibilidade exibida quando não há saldo livre; modal não oferece componentes/capacidade como venda pronta. Nenhuma confirmação feita.
6. **Draft editing/review:** Entrada e Saída preservam carrinho/review ao navegar e retornar. Não gerar nova chave de operação por navegação.
7. **Workspace State / Activity:** Estoque preservou busca/filtros; Pedido seguro selecionado voltou ao detalhe. Back/Forward não reabriu Venda nem criação de Pedido antiga na amostra.
8. **Modais operacionais:** foco, Escape, cancelamento e scroll interno funcionam nas amostras; não trocar todos por um padrão novo por estética.
9. **Attention e resposta estruturada:** reposição compacta com CTA para lista e consulta determinística de bundle separam saldo pronto, mínimo, capacidade e receita.
10. **Aplicações:** grid de marcas e nenhum resultado legíveis; não transformar catálogo em experiência animada.
11. **Estatísticas/Histórico:** separação de movimentos externos/internos, detalhes auditáveis e paginação read-only funcionais; não questionar regras de negócio nesta PR.
12. **Paleta semântica:** verde/vermelho operacionais e violeta de configuração têm função. O detector complementar produziu sete warnings, triados como falsos positivos/contexto: três confundiram classes disabled cinza com fundo ativo, quatro sinalizaram violeta já previsto pela marca. Não são sete novos findings nem justificativa para trocar cores.

Integridade visual observada: sistema industrial claro com tokens, contraste semântico e affordances consistentes; não uma necessidade de rebrand. Não há score global de saúde/20: performance, contraste integral e hardware não foram medidos para sustentar essa pontuação.

## 17. Matriz impacto × esforço

Ordem recomendada, sujeita à decisão do Lead. P1 primeiro; depois impacto e custo de mudança. Não estimar horas.

| Ordem | ID | Prioridade | Impacto | Esforço | Risco | Motion |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | 001 | P1 — nome do filtro | Alto | XS | Baixo | Não |
| 2 | 003 | P2 — título legível | Alto | S | Baixo | Não |
| 3 | 002 | P2 — stepper touch | Alto | S | Médio | Não |
| 4 | 005 | P2 — alcance do carrinho | Alto | S | Médio | Não |
| 5 | 007 | P2 — reduced lifecycle | Médio | S | Médio | Existente, sem novo efeito |
| 6 | 006 | P2 — resumo recomendado | Médio | S | Médio | Não |
| 7 | 004 | P2 — filtros do Histórico | Médio | M | Médio | Não |
| 8 | 008 | P3 — label estreito | Baixo | XS | Baixo | Não |

## 18. Proposta de execução

**Primeira PR futura, após aprovação do Lead:** correções de legibilidade/acessibilidade pequenas (001, 003, 002), com verificação em 320/375/768/1440, foco e teclado. Pode incluir 007 se houver testes do lifecycle do drawer para redução, Escape, abrir/fechar rápido e foco. Não alterar writers/schema/saldos.

**Segunda PR, somente se escolhida:** alcance do carrinho (005) e densidade mobile de Lista recomendada/Histórico (006/004). Validar com o usuário antes de remover/compactar resumo; preservar filtros ativos, deep links, drafts, review e Activity. 008 pode acompanhar uma mudança localizada de tipografia, sem virar redesenho geral.

**Não propor uma wave de novas animações:** nenhuma passou o gate. Não implementar a #80, executar polish ou iniciar a próxima PR automaticamente. O Lead/ChatGPT revisa estes findings; o usuário valida e autoriza merge humano.

### Verificação da entrega

Somente este documento consta no diff. `node scripts/verify-agent-ux-tooling.mjs`: **13 passed, 0 failed, 0 skipped**. `git diff --check`: passou. O smoke do CLI confirmou heading e ausência de overflow no login nos quatro viewports, sem mensagens de console, sem envio do formulário. A checagem complementar read-only retornou sete warnings heurísticos (exit 1), todos triados como descrito em KEEP; não é uma falha de testes do aplicativo.

Sem alteração de código/package, não há motivo para build, TypeScript, lint de código ou suítes do app nesta PR; não foram executados. Artefatos temporários permanecem ignorados. Nenhum cookie, screenshot autenticado, token, nome pessoal ou identificação de pedido é parte da entrega.

Nenhuma alteração de produto, migration, RPC, RLS, writer, saldo, modelo de IA ou operação remota de estoque/pedido foi executada. PR em Draft, sem merge/auto-merge, aguardando seleção do Lead.
