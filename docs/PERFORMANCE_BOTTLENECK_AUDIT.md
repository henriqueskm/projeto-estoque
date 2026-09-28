# NK-PR-67 — auditoria de desempenho

Estado: **baseline Preview coletado — pendente decisão de escopo/próxima fase**. Há medições autenticadas locais e de Preview, descritas abaixo. Nenhuma otimização de comportamento foi feita nesta PR; não há comparação antes/depois nem benchmark de produção. Assinatura sob demanda é o candidato medido, não uma alteração autorizada: loading/erro/retry do visualizador precisa definição na próxima fase.

## Caminho crítico antes da instrumentação

Todas as rotas abaixo passam pelo layout autenticado: `requireActiveProfile()` usa `getClaims()`, consulta `profiles` e, quando o claim de email falta, usa `getUser()`. `React.cache` deduplica `requireActiveProfile` dentro do render. A sidebar é Client Component; seus links têm `prefetch={false}` e fazem `router.prefetch` quando há intenção por pointer/focus. O estado de prefetch pode variar entre cliques. O layout espera o perfil antes de renderizar; os `loading.tsx` das páginas não cobrem essa espera do layout.

| Rota | Server loader e waves estáticas | Client / fronteira de carregamento | Imagens |
| --- | --- | --- | --- |
| `/` | `loadAssistantAttention` inicia sem bloquear o shell. Em paralelo: recomendações (catálogo + 2 saldos + 2 mínimos + 2 leituras de Pedidos), Safisa e Pedidos pendentes. | `AssistantHome`; Attention em `Suspense`; hidratação restaura conversa. Sem `loading.tsx` da rota. | Mídia da conversa é posterior. |
| `/estoque` | `loadInventoryData`: catálogo compartilhado, 2 saldos e 2 mínimos em paralelo; transformações e URLs assinadas depois. | `InventoryWorkspace`; `loading.tsx`; tabelas apenas em accordions abertos, filtros e agrupamentos com `useMemo`. | Uma operação `createSignedUrls` para paths únicos, se houver. |
| `/entrada` | `getInboundCatalog`: catálogo + 2 saldos em paralelo; builder e URLs assinadas depois. | `InboundEntryFlow`; `loading.tsx`. | Uma operação de assinatura para paths únicos, se houver. |
| `/saida` | `getOutboundCatalog`: catálogo + 2 saldos em paralelo; builder e URLs assinadas depois. | `OutboundEntryFlow`; `loading.tsx`. | Mesmo padrão de Entrada. |
| `/pedidos` | `loadSupplierOrderSummaries`: um stream paginado de `supplier_order_summaries`. Detalhe, mídia e catálogo são chamadas API posteriores. | `SupplierOrdersWorkspace`; `loading.tsx`; dados de detalhe sob demanda. | URLs no endpoint de mídia sob demanda. |
| `/aplicacoes` | `loadVehicleApplicationBrands`: uma consulta `vehicle_application_brands`. | Grid client; `loading.tsx`. | Sem geração de URL nesta rota. |
| `/estatisticas` | `loadStatisticsData`: seis streams paralelos (lotes, items, configurações, aliases, dois saldos); depois até cinco famílias de streams por IDs de lote e cálculo no servidor. | Render principal server; `loading.tsx`. | Nenhuma no caminho principal. |
| `/historico` | `loadHistoryList`: página/count de lotes; possível segunda página se filtro pedir página inexistente; depois cinco streams paralelos de linhas/movimentos/montagem. | Render principal server; `loading.tsx`. | Nenhuma no caminho principal. |

Os streams paginados podem executar mais de uma query física quando ultrapassam o tamanho de página da API. `streamCount` indica leitores lógicos, não número real de round trips ou de waves. Por isso os spans paginados omitem `queryCount` e `waveCount` quando esses números não são medidos. A garantia >1000 da NK-PR-63 não foi alterada.

## Catálogo #66 e segurança

`loadSharedCatalogForCurrentRequest` passa por `requireActiveProfile` e `getSession` **antes** de consultar `unstable_cache`. A chave inclui o usuário; a leitura de origem usa JWT/RLS. O callback do cache faz quatro streams estruturais paralelos. A nova métrica `catalogReadFromSource` informa apenas se **o callback local iniciou antes de a chamada retornar**; `false` não prova cache quente global nem descarta revalidação posterior. A leitura de saldos e mínimos não usa cache persistente. A assinatura de URLs ocorre fora desse cache, com validade de dez minutos.

## Instrumentação adicionada

- Logs estruturais `nk_performance_audit` nos servidores de development/Preview. Em produção (`NODE_ENV=production` e `VERCEL_ENV` diferente de `preview`) o helper retorna sem serializar payload e sem emitir log.
- Auth: claims, perfil, fallback de usuário, espera do layout; catálogo: sessão, gate, callback de leitura, consulta ao cache. Estoque: saldos, mínimos, transformações, total. Entrada/Saída: builder e total. Imagens: duração de `createSignedUrls` e quantidade de paths, sem paths ou URLs nos logs. Attention: três ramos e total. Pedidos conserva métricas e `Server-Timing` existentes.
- `?nk_perf=1` ativa um painel no Preview ou development, persistindo apenas o interruptor em `sessionStorage`. O botão “Desligar” desativa imediatamente; `?nk_perf=0` desativa quando a página é carregada novamente (mudança apenas da query via navegação client-side não é observada). O painel mede clique em link da sidebar até o marcador da rota ser montado e o próximo frame. Para abertura inicial, usa o relógio da navegação até esse marcador. Isto **não é TTI**, não mede a interação operacional subsequente e não separa precisamente rede RSC, hidratação e pintura. “Intenção prefetch” indica pointer/focus observado; não prova que o prefetch terminou.
- `payloadBytes` representa o JSON do resultado do loader antes da serialização RSC, quando medido. Não é o tamanho do payload RSC nem dos arquivos de imagem. A leitura de imagens no navegador (download/decodificação) ainda precisa do painel Network/Performance do browser; o timer de URLs assinadas mede somente a chamada server ao Storage.

Nenhum log contém identificador de usuário, token, cookie, código de item/pedido, path de imagem ou mensagem. As métricas não são enviadas a serviço externo. O console do Preview da Vercel pode ser filtrado por `nk_performance_audit` e `supplier_orders_performance`; correlacione uma rodada isolada pela janela de horário e ordem de rotas, sem identificador pessoal.

## Procedimento reproduzível no Preview

1. Abra o Preview final em navegador autenticado, acrescente `?nk_perf=1` em `/`, mantenha DevTools Network aberto com Preserve log. Anote dispositivo, navegador, tipo de rede, horário, URL de Preview e HEAD da PR.
2. Registre separadamente a primeira abertura. Ela é “primeira navegação observada”, não “cold cache” comprovado. Para chamar uma amostra de cold, é preciso controlar a nova instância/cache e distinguir leitura inicial de revalidação. `catalogReadFromSource: true` sozinho não comprova cold. Não invalide catálogo operacional só para benchmark.
3. Clique na sidebar: Assistente → Estoque → Entrada → Saída → Pedidos → Estoque. Copie o JSON do painel, o waterfall Network/RSC e os logs server correspondentes. Registre se a intenção prefetch foi observada. Espere a interface operacional aparecer antes de seguir.
4. Repita a sequência na mesma sessão para “navegação repetida”. Identifique separadamente as chamadas em que `catalogReadFromSource: false`; só chame o cache de warm se o estado tiver sido controlado, e registre mudança possível entre instâncias e prefetch/browser.
5. Para imagens, conte requests e bytes no Network, marque tempo de download e, se necessário, faça trace de paint/decode no Performance. Nunca copie URLs assinadas no relatório. Para Estoque, registre contagem de nós DOM e duração de render no profiler antes de propor virtualização.
6. Envie JSON do painel e logs estruturais sem dados de negócio. Desligue com o botão ou recarregue com `?nk_perf=0`.

## Baseline autenticado local — 27/09/2026

Fonte: Lead, painel diagnóstico no Chrome autenticado e stdout do servidor Next dev em `localhost:3000`, HEAD `a3f150308c676f7855125ec1e4ab18f42f1fd537`, viewport 718 × 682, noite de 27/09 (referência final 22:45 BRT / 28/09 01:45 UTC). A sequência foi repetida na mesma sessão e viewport. Todas as amostras abaixo observaram intenção de prefetch; sua conclusão não foi medida. Rede local/browser e chamadas Supabase remotas, sem controle de latência ou instância. São **rodadas observadas/repetidas**, não cold/warm comprovados. Instrumentação e logging estavam ligados.

### Amostras sanitizadas

Todos os tempos são ms observados, arredondados pelo instrumento. O painel mede commit + próximo frame, **não TTI**. As colunas de spans não devem ser somadas: requests, auth e leitura operacional podem se sobrepor. A diferença painel − loader não mede custo de render.

| Navegação | Rodada observada | Rodada repetida |
| --- | ---: | ---: |
| Assistente → Estoque | 852 | 866 |
| Estoque → Entrada | 606 | 520 |
| Entrada → Saída | 670 | 487 |
| Saída → Pedidos | 578 | 468 |
| Pedidos → Estoque | 624 | 607 |

| Loader / fase | Amostras ou intervalo observado | Evidência estrutural |
| --- | --- | --- |
| Catálogo nas páginas críticas: gate | 183–393 | Autorização/sessão antes do cache; não somar novamente ao total |
| Catálogo nas páginas: lookup | 2–6 | `catalogReadFromSource: false` nas chamadas observadas |
| Saldos frescos | 138–368 | Dois streams operacionais; sem cache de saldo |
| Mínimos frescos | 260–383 | Dois streams; somente Estoque/recomendações precisam deles |
| Transformações Estoque/Entrada/Saída | 18–26 | CPU server, antes da assinatura |
| Assinatura Estoque/Entrada/Saída | 91–202 | 76 paths únicos em cada tela, uma operação Storage por chamada |
| Estoque total | 456–540 | Inclui dependências concorrentes e cauda sequencial |
| Entrada total | 371 / 395 | Catálogo + saldos, builder, assinatura |
| Saída total | 472 / 370 | Mesmo desenho, regras próprias preservadas |
| Pedidos summaries | 183 / 200 / 420 | Stream paginado, sem waves físicas presumidas |
| Recommendations API: callback de origem | 125 / 73 | `catalogReadFromSource: true`, diferentemente das páginas |

Algumas amostras pareadas permitem analisar dependências sem fingir uma melhoria medida:

| Loader / amostra | Gate catálogo | Lookup | Saldos | Mínimos | Transform | Assinatura | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Estoque, segunda Assistente → Estoque | 393 | 2 | 368 | 383 | 20 | 115 | 540 |
| Estoque, retorno | 230 | 2 | 272 | 271 | 19 | 153 | 457 |
| Entrada | 183 | 6 | 212 | — | 26 | 126 | 395 |
| Saída | 211 | 2 | 221 | — | 18 | 97 | 370 |

Os intervalos acima e essas amostras individuais vieram de janelas distintas da coleta; não representam estatística populacional nem um único waterfall perfeitamente correlacionado.

### Home, rotas secundárias e Pedidos sob demanda

| Cenário | Painel | Spans server / request observado |
| --- | ---: | --- |
| Reload Home após login/cache prévio | 1787 | Claims 99; perfil 285; layout 535; gate catálogo 403; lookup 3, callback false; saldos 849; mínimos 1085; Attention pending 475, Safisa 1239, recommendations 1284, total 1285; GET 1423, app 1404 |
| Primeira navegação Aplicações | 2030 | Loader 389; GET 1932, compilação dev 1476, app 447 |
| Primeira navegação Estatísticas | 1085 | Loader 563; GET 914, compilação 71, app 830 |
| Primeira navegação Histórico | 938 | Loader 595; GET 819, compilação 67, app 742 |
| Terceira lista Pedidos | 585 | Summaries 420; página 424; GET 490, app 473 |
| Quarta amostra detalhe Pedidos | — | Core 172; 3 queries/1 wave, 6 rows, JSON 4088 bytes; GET 507, app 477 |
| Mídia posterior desse detalhe | — | Total 291; 7 operações/4 waves, 4 rows, JSON 733 bytes; enriquecimento 119; assinatura 86; GET 404, app 380 |

Outras amostras de core do detalhe: 186 / 133 / 173 ms; mídia posterior: 279 / 233 / 243 ms, assinatura 84 / 68 / 64 ms. O primeiro GET de detalhe (2,1 s) incluiu 1,753 s de compilação dev; seguintes GETs 319 / 500 ms. Não atribuir compilação dev a gargalo de produção. O core já possui três queries em uma wave e não lê catálogo nem assina imagens; a mídia chega separadamente.

A abertura inicial após iniciar o processo dev teve callback estrutural 3729 ms, saldos 4025, mínimos 3956, Attention 4211 e GET ~4,9 s. Login, compilação e estado do cache não foram controlados; essa observação fica **excluída do baseline comparativo** e não prova cold em produção.

No DOM inicial do Estoque com accordions fechados não havia `img`. O visualizador de imagem foi aberto/fechado e a imagem estava completa, com dimensão natural 813 × 727. Download e decode **não foram medidos**: a superfície automatizada não expôs Performance/Network. Nenhum erro de console foi capturado; houve warnings de `getSession` preexistentes. Isso é uma verificação pontual, não prova ausência de erros em todos os fluxos.

## Baseline autenticado de Preview — 28/09 01:58–02:08 UTC

Fonte: Lead, painel no navegador interno do Codex autenticado (viewport 641 × 738) e runtime logs Vercel filtrados por `nk_performance_audit` / `supplier_orders_performance` no deployment `dpl_5mnuhed8H2GfsodU23zSG1mxspaE`, região confirmada `iad1`, estado READY. App: `projeto-estoque-sp4o-b2rlvujce-henrqueskms-projects.vercel.app`; SHA medido `b0a718217c331e376dcd941cdbba623120614638`. No horário de Brasília, noite de 27/09. Região de banco/RTT não medidos; não inferir topologia ou causa de latência da região da função.

Rodadas na mesma sessão, sem controle do cache da instância: **observadas/repetidas, não cold/warm comprovados**. Todos os cliques abaixo observaram intenção prefetch, não sua conclusão. Logs correlacionados por deployment, janela UTC e ordem das rotas, sem IDs de negócio. O header RSC cache MISS da Vercel não equivale a miss do catálogo compartilhado.

| Navegação (commit + próximo frame, ms; não TTI) | Rodada 1 | Rodada 2 |
| --- | ---: | ---: |
| Assistente → Estoque | 1624 | 1419 |
| Estoque → Entrada | 1373 | 1322 |
| Entrada → Saída | 1264 | 1494 |
| Saída → Pedidos | 1025 | 613 |
| Pedidos → Estoque | 1329 | 1832 |

Retorno à Home entre rodadas: 485 ms. Primeiro reload com diagnóstico: marcador inicial 1246 ms, **não TTI nem cold**. GET Home 01:58:54 UTC: claims 49, perfil 353, layout 405, gate catálogo 404, lookup 120/callback false, saldos 494, mínimos 513; Attention pendentes 493, recommendations 554, Safisa 669, total 670. Attention continua separado do shell. OPTIONS 01:58:56 foi excluído por não representar navegação normal.

### Spans por rota no Preview

Valores em ms, arredondados. Auth/profile integram o gate; catálogo, saldos e mínimos concorrem. Não somar colunas nem chamar painel − total de render client. JSON é resultado do loader, não payload RSC.

| UTC / rota | Claims | Perfil | Gate catálogo | Lookup (callback false) | Saldos | Mínimos | Transform | Assinatura (76 paths) | Total loader |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01:59:40 Estoque | 269 | 173 | 453 | 16 | 518 | 526 | 29 | 341 | 906 |
| 02:00:48 Entrada | 40 | 503 | 546 | 12 | 526 | — | 12 | 199 | 772 |
| 02:01:02 Saída | 7 | 530 | 541 | 10 | 434 | — | 11 | 167 | 733 |
| 02:01:31 Estoque | 14 | 472 | 488 | 15 | 509 | 510 | 14 | 322 | 851 |
| 02:02:33 Estoque | 9 | 417 | 428 | 15 | 257 | 446 | 11 | 290 | 749 |
| 02:02:46 Entrada | 6 | 401 | 408 | 14 | 401 | — | 20 | 309 | 754 |
| 02:02:57 Saída | 9 | 160 | 171 | 14 | 412 | — | 11 | 520 | 945 |
| 02:03:14 Estoque | 7 | 406 | 416 | 13 | 182 | 205 | 11 | 830 | 1273 |

Primeira amostra Estoque: 183 rows, JSON 149927 bytes; Entrada JSON 79112; Saída JSON 88077. Esses tamanhos não medem bytes RSC/rede. Não quantificamos a parcela das URLs nesses resultados.

| UTC / operação Pedidos | Duração observada | Contagem / payload medidos |
| --- | --- | --- |
| 02:01:15 lista | summaries 463, página 464 | 11 rows, JSON 8144 bytes |
| 02:03:07 lista repetida | summaries 177, página 178 | Stream paginado; sem waves físicas presumidas |
| 02:03:48 detalhe core | 227 | 3 queries / 1 wave, 6 rows, JSON 4088 bytes |
| 02:03:49 mídia posterior | 1135; enriquecimento 555; assinatura 167 | 7 operações / 4 waves, 4 rows, JSON 733 bytes, 1 path assinado |
| 02:04:57 segundo detalhe core | 422 | 3 queries / 1 wave, 5 rows, JSON 3446 bytes |
| Mídia posterior desse detalhe | 1129; enriquecimento 550; assinatura 169 | 7 operações / 4 waves, 3 rows, JSON 1016 bytes, 2 paths |
| 02:06:12 terceiro detalhe core | 443 | 3 queries / 1 wave, 3 rows, JSON 1930 bytes |
| Mídia posterior desse detalhe | 1307; enriquecimento 779; assinatura 150 | 7 operações / 4 waves, 1 row, JSON 472 bytes, 1 path |

Rotas secundárias, primeiras navegações observadas no Preview: Aplicações marcador 1062 ms / loader 448 às 02:06:46 (1 query/1 wave, 8 rows); Estatísticas 941 / loader 421 às 02:06:56; Histórico 1042 / loader 630 às 02:07:07. Não interpretar diferença entre marcador e loader como render.

Amostra adicional de Estoque, **fora das duas rodadas principais**, 02:07:18: gate 204, lookup 13/callback false, saldos 196, mínimos 448, transform 12, assinatura 207, total 670 ms. Não a misturar como terceira rodada pareada.

Recommendations API 01:59:42: leitura estrutural 402 ms, lookup 417, callback true. Chamadas 02:01:33 / 02:02:35 / 02:03:16: lookup 13 / 14 / 12, callback false. Assim, **no Preview não há falha universal de reutilização do catálogo na API**. A causa da chamada com callback true não foi isolada.

DOM inicial Estoque: 393 nós, zero `img`. Visualizador abriu/fechou; imagem carregada, dimensão natural 813 × 727. Download/decode, RTT, CPU client, TTI e bytes RSC não medidos: a superfície de automação retornou `performance` indisponível, sem trace Network/Performance. Contagem DOM isolada não quantifica render pesado.

Regressão manual #65 no Preview: Lista recomendada abriu/reabriu; fechamento por X, Escape e backdrop, múltiplos ciclos e Back/Forward (oculta/reabre) confirmados. Lista de warnings/errors do browser vazia na observação; consulta scoped de 5xx no deployment entre 01:58 e 02:08:30 retornou vazia. Não prova ausência global de erros. Nenhuma mutação de estoque foi necessária para essa coleta read-only.

## Diagnóstico e dez respostas

| Pergunta | Resposta sustentada pelas coletas | Limite / próximo passo |
| --- | --- | --- |
| 1. Maior custo na abertura inicial? | Preview reload: Attention 670 ms (Safisa 669), layout 405, perfil 353; saldos/mínimos 494/513 dentro do ramo recommendations. Local: Attention 1285, layout 535. | Attention está fora do caminho bloqueante do shell desde #65. Shell e TTI não medidos; não afirmar que esse ramo atrasou a primeira interface. |
| 2. Maior custo ao navegar para Estoque? | Preview: grupo auth/fresh reads com centenas de ms; assinatura 290–830 é cauda serial, chegando a ser o maior span da última amostra. Transform 11–29 é menor. | Custos variam por amostra; não eleger um componente único universal. Trace/Network faltam para decomposição end-to-end. |
| 3. Maior custo em Entrada? | Preview: gate 408/546, saldos 401/526 concorrem; assinatura 199/309 é cauda posterior. | Sem produção ou comparação antes/depois. Não somar gate e saldos. |
| 4. Maior custo em Saída? | Preview: gate 171/541 e saldos 412/434; assinatura 167/520, maior span na segunda amostra. | Não fundir regras nem cachear saldos; Storage e consultas atuais têm variação relevante. |
| 5. #66 reutiliza catálogo? | Páginas Preview: lookup 10–16/callback false; APIs repetidas 12–14/false. Local páginas: 2–6/false. Evidência de ausência de leitura local iniciada nessas chamadas. | Callback true apareceu em uma API Preview e em APIs locais; não prova cold nem falha universal. RSC MISS é outra camada. |
| 6. Supabase é dominante? | Auth/perfil, leituras operacionais e Storage são os maiores grupos server observados; transformações são menores. | Spans medem espera/overhead, não SQL puro. RTT, EXPLAIN, RSC e CPU browser não medidos; não afirmar causa infra/índice nem dominância end-to-end. |
| 7. Signed URLs/imagens importam? | Preview: 76 paths por tela, 167–830 ms; local 91–202. Zero img no Estoque inicial. Assinatura é trabalho inicial comprovado usado só quando visualizador abre. | Download/decode/render não medidos; foto funcionou pontualmente. Resolução sob demanda muda loading/error/retry, exigindo decisão. |
| 8. Render browser importa? | Ainda não há evidência que quantifique esse custo. Accordions fechados evitam montar as tabelas/imagens; DOM inicial Preview com 393 nós/zero img. | Painel − server não é render. Trace de main thread/paint necessário antes de virtualização; contagem isolada não mede custo. |
| 9. Auth/profile importa? | Sim: Preview perfil 160–530, gate 171–546; reload Home perfil 353/layout 405. | Gates incluem dependências/overlap. React.cache deduplica no render; não inferir consultas duplicadas de duração. Não enfraquecer autorização. |
| 10. Próxima otimização? | Candidato 1: tirar assinatura antecipada do caminho inicial, resolvendo mídia somente ao abrir visualizador. Aguardar decisão humana de UX e contrato; depois medir antes/depois no mesmo Preview. | Preservar alvos/aliases/kits/configurações inativas montadas, RLS e expiração. Sem justificativa para índice, auth change ou virtualização. |

Ordenação sustentada pelas amostras server: (1) grupo auth + leituras frescas e assinatura de imagens têm os maiores custos; sua ordem relativa varia por request; (2) lookup estrutural reutilizado e transforms são menores nas navegações observadas. Assinatura é o candidato corrigível de escopo moderado porque sua necessidade é posterior à tela inicial, não porque seja sempre maior que auth/saldos. Attention tem custo medido alto, mas está fora do shell bloqueante. Mídia Pedidos também é posterior ao core, não gargalo comprovado da lista.

### Avaliação das correções, sem implementação

Sobrepor assinatura à leitura operacional é possível em Entrada/Saída porque a seleção de paths é estrutural, mas exige preservar exatamente seus filtros ativos. No Estoque, uma configuração inativa ainda é exibida quando seu saldo montado é positivo: o conjunto exato assinado **não depende somente do catálogo**. Assinar indiscriminadamente todos os paths adicionaria trabalho e alteraria o conjunto atual.

Como catálogo e estado operacional já concorrem, antecipar assinatura não elimina automaticamente seus 91–202 ms. Nas amostras pareadas, o espaço estimado de sobreposição + transform é da ordem de 20–59 ms no Estoque, 49 ms na Entrada e 26 ms na Saída; esses números são **análise de dependências**, não ganho medido, nem promessa. A correção foi adiada pelo Lead para evitar mudar comportamento com teto limitado sem antes/depois.

Assinatura sob demanda poderia remover trabalho inicial sem imagens visíveis, mas precisaria contrato autenticado por alvo validado, estados de carregamento/erro/retry, compatibilidades e teste de expiração. É mudança moderada, não apenas deslocar um await. Não foi implementada. Não há justificativa medida para virtualização, memoização adicional, mudança de auth ou reabrir a otimização do core de Pedidos.

Auditoria dos consumidores: Estoque usa foto em menu de ações/configuração e botão/seletor de kit; Entrada/Saída usam text-link. Nesses casos o `img` só aparece no modal, embora todas as URLs sejam assinadas no loader. O componente compartilhado também atende thumbnails em outros fluxos: não alterar indiscriminadamente todos os consumidores. A lista/compatibilidades deve continuar incluindo exatamente os alvos atuais; mínimo e saldo não podem virar cache.

Endpoints existentes de mídia não são substitutos diretos: Assistente resolve código ativo/enriquece catálogo e não mantém configuração inativa montada; Pedidos exige order/view. Resolução por identidade de configuração precisaria endpoint somente leitura, active auth e RLS existentes, path obtido no servidor (não path livre do client), resposta no-store e refresh por expiração. UX muda: hoje falha de assinatura pode ocultar foto antes do clique; sob demanda seria loading/erro/retry depois. Isso é proposta para **decisão de escopo/próxima fase**, não stop técnico obrigatório por mudança de auth/infra demonstrada. Nenhuma nova política auth nem weakening é proposta.

### Recommendations e diferença de contexto de cache

Não atribuímos callback true da API automaticamente a `dynamic = "force-dynamic"`. No código instalado de Next 16.2.11, o handler define `workStore.forceDynamic`, enquanto `unstable_cache` verifica `workStore.fetchCache === 'force-no-store'` para bypass. O IncrementalCache em dev também retorna miss com request `cache-control: no-cache`; a chave usa texto do callback + keyParts, e revalidação pode executar callback. Headers técnicos, estado real do cache e diferenças de bundle não foram observados nessa coleta. São hipóteses de investigação, não causas confirmadas. O no-store autenticado e o warm single-flight da #65 permanecem intactos.

## Limites e continuação

As melhorias de core/mídia sob demanda de Pedidos (#53), navegação/recommendations (#65) e catálogo (#66) já estavam na base. A #67 adicionou diagnóstico, não essas otimizações. O anexo histórico da #53 foi avaliado no contexto atual, sem ressuscitar sua PR mergeada.

Produção, payload RSC, rede/browser download/decode, CPU/render, shell/TTI e cold/warm controlados continuam **não medidos**. Preview autenticado foi medido, em duas rodadas, sem antes/depois funcional. Contagem DOM foi pontual, não profiling. Verificação desktop adicional 1280 × 800: Entrada → Saída → Pedidos → Home com sidebar presente; Estoque sem overflow horizontal. Não misturar essas navegações às duas rodadas de 641 × 738. Viewport restaurado e Desligar confirmou remoção do painel no Preview; Home autenticada permaneceu aberta. Rede lenta, retry, expiração de URL e usuários/perfis diferentes não foram exercitados no browser nesta coleta; testes automatizados anteriores cobrem auth/gating. Não é correto marcar APPROVED FOR HUMAN TEST como se implementação/validação da otimização estivesse concluída.

Próximo passo é decisão humana: autorizar ou não resolução de fotos sob demanda com loading/erro/retry. Se autorizada, definir contrato preservando media atual e implementar um único gargalo; medir antes/depois no mesmo Preview/sessão/viewport com logs e, quando disponível, Network/Performance. Não copiar cookies, IDs de negócio ou URLs assinadas. Se o gargalo exigir migration/index/RPC/schema/RLS/auth/infra/dependência, parar para decisão humana em vez de contornar com cache operacional. Nenhuma dessas mudanças foi autorizada ou executada nesta rodada.
