# NK Semantic Back Navigation — PR #83

Base: `6e4dd00fd8045b087b48add2644d73e385410b42`.

## Responsabilidades

`SemanticBackProvider` é o único coordenador de `popstate` semântico no layout
autenticado. Não substitui o Next Router, Cache Components/Activity nem o
Workspace State v1. O listener de scroll existente continua somente capturando
scroll; o lifecycle #78 recebe `nk:semantic:before-pop` do coordenador.

`lib/semantic-back-history.ts` mantém checkpoints identificados por versão, ID,
rota, tipo e chave. Toda escrita preserva `...history.state`, incluindo os dados
internos do Next. Não há monkeypatch de History API nem listener por página.

Os valores pequenos restauráveis (filtros, IDs de grupos/famílias, ID seguro de
Pedido e etapa/identidade de Review) ficam em memória. Não há carrinho, saldo,
receipt, submit, credencial ou payload de mutação no `history.state`. Workspace
State continua sendo a fonte de verdade, incluindo persistência e scroll.

## Checkpoints

| Ação | Tratamento |
| --- | --- |
| Estoque: status, sort, painel, grupos e famílias | push de projeção segura |
| Pedidos: status, período, closure, sort, painel e detalhe read-only | push de projeção segura |
| Aplicações: categoria | push de projeção segura |
| Pesquisa em Estoque/Pedidos/Aplicações/Entrada/Saída | replace do checkpoint atual; nenhuma entrada por tecla |
| Entrada/Saída: Editing ↔ Review | push somente de etapa e identidade do draft |
| Drawer, menu, imagem, diálogos transacionais, disclosure manual do Histórico | checkpoint descartável; Back fecha; Forward não reabre |
| Lista recomendada | URL local existente; abas possuem checkpoints; X/Escape fecham também os checkpoints das abas |
| Histórico/Estatísticas/Ativos/Histórico de Pedidos | entradas URL/GET existentes, sem segundo push semântico |
| Scroll, quantidade, texto de observação, focus, hover e toast | nenhum push |

O Next instalado trata escritas que preservam `__NA` como escritas nativas;
checkpoints locais não solicitam RSC. A Lista continua abrindo localmente e
sincroniza Back/Forward pela URL, sem mudar seu no-store/single-flight.

## Segurança de Forward e Activity

Participantes se registram em layout effects e saem ao serem escondidos por
Activity. Ao voltar, recebem somente a projeção segura do checkpoint da rota.
Diálogos descartáveis não têm callback de restauração. A sondagem de effects
do StrictMode reutiliza o checkpoint, sem push duplicado.

Review só é restaurada se a identidade corresponder ao draft ainda existente,
o catálogo continuar reconciliado e não houver envio em andamento. Navegação
não gira a idempotency key. Sucesso invalida todos os checkpoints de Review
da operação antes de limpar o draft; não é possível voltar ao payload concluído.
Os locks e os checks de visit da #78 permanecem. Um diálogo com operação em
andamento não autoriza segundo envio e mantém sua proteção durante Back.

## Deep links e saída

`/pedidos?order=<id>` cria uma base da mesma lista, sem o parâmetro `order`, e
um checkpoint read-only. Primeiro Back fecha o detalhe; não manda para Home.
O mesmo princípio vale para o deep link da Lista recomendada.

Somente `isStandaloneMode()` habilita a proteção de saída. Uma única entrada
de fronteira é colocada antes da base do app. Back na fronteira retorna à
entrada existente e abre **Sair do Negócios K?**; não empilha sentinelas novas.
Reload de uma entrada marcada reutiliza a fronteira. Navegações documentais
internas por GET mantêm o histórico anterior em vez de adicionar outra fronteira.

Continuar fecha o dialog, preserva estado e reativa a proteção. Escape equivale
a Continuar. O foco inicial vai a Continuar; Tab/Shift+Tab ficam no dialog e
o foco anterior é restaurado. Não há motion novo nem `window.confirm()`.

Sair libera a proteção e tenta atravessar a fronteira pelo histórico real.
Se o runtime não conseguir fechar uma janela instalada, o próximo Back fica
liberado. Não usa `window.close()`, reload, about:blank ou loop de sentinelas.
Um browser comum não recebe exit guard. Emulação não comprova fechamento
de Chrome Android/PWA real; essa validação exige aparelho humano.

## Validação

Suíte dedicada: `tests/mobile-semantic-back.test.mjs`, com um port determinístico
da History API executando o coordenador real; regressões Workspace State,
Activity, Instant Navigation, Lista, mobile/UI e estoque continuam obrigatórias.
O smoke autenticado deve usar Back/Forward reais e parar antes de toda confirmação.

Checklist: Pedidos filtro/detalhe; Estoque filtro/grupo/família; Review de Entrada
e Saída com a mesma chave; drawer; Histórico GET; Lista/abas; deep link; exit
guard standalone emulado. Viewports: 320/375/768/1440. Somente drafts locais
criados pelo smoke podem ser limpos. Nenhuma operação de estoque/Pedido é
autorizada por esta PR.

### Evidência local e pendências

- 29 testes novos do coordenador semântico; 253 testes combinados de navegação,
  Workspace, Activity, UI/mobile, Lista e inventory passaram, sem falhas/skips.
- Mais 19 testes de ações/performance de Pedidos e 7 de stale conflict passaram.
- TypeScript, ESLint com zero warnings e diff-check passaram. Builds padrão Next
  e Webpack mantêm Cache Components e Partial Prefetching habilitados.
- O Preview requer autenticação humana própria. O CLI dedicado encontra primeiro
  o login da Vercel; o Chrome habitual alcança o login do NK. Nenhuma sessão foi
  copiada/exportada. Enquanto não houver login, o smoke autenticado real em
  320/375/768/1440 permanece **pendente**, não aprovado pelos testes do port.
- Confirmação visual do exit dialog, focus trap e retorno de Activity no browser
  também exige esse smoke. Fechamento de PWA em Android real não foi comprovado.
