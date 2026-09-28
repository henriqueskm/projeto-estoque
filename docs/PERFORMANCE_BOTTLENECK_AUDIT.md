# NK-PR-67 — auditoria de desempenho

Estado: **MEASUREMENT READY FOR HUMAN RUN — confirmação no Preview pendente**. Há medições autenticadas locais de desenvolvimento, descritas abaixo. Nenhuma otimização de comportamento foi feita nesta PR; não há comparação antes/depois nem benchmark de produção.

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

## Diagnóstico e dez respostas

| Pergunta | Resposta sustentada pela coleta local | Limite / próximo passo |
| --- | --- | --- |
| 1. Maior custo na abertura inicial? | No reload observado, Attention teve 1285 ms; Safisa 1239 e recommendations 1284 concorrem. Layout 535 também é relevante. | Attention está fora do caminho bloqueante do shell desde #65. Shell e TTI não foram medidos; não concluir que Attention atrasou a primeira interface. |
| 2. Maior custo ao navegar para Estoque? | O grupo de gates auth e leituras frescas tem centenas de ms; assinatura 91–202 ms é cauda secundária, transform 18–26 é menor. | Spans concorrem; trace/Network no Preview precisa identificar o caminho crítico de cada clique. |
| 3. Maior custo em Entrada? | Gate catálogo/auth e saldos frescos dominam os spans observados; assinatura é custo serial relevante depois do builder. | Sem benchmark de produção ou correção antes/depois. |
| 4. Maior custo em Saída? | Mesmo padrão medido de Entrada; saldos atuais e gate permanecem, assinatura adiciona cauda. | Não fundir regras de negócio nem cachear saldos. |
| 5. #66 reutiliza catálogo? | Nas páginas observadas, lookup 2–6 ms e callback false mostram que essas chamadas não iniciaram leitura de origem antes do retorno. | Não prova hit global/instância Vercel; APIs recommendations tiveram callback true e precisam investigação separada. |
| 6. Supabase é dominante? | Auth/perfil, leituras operacionais e Storage são os maiores grupos server medidos nessas amostras; transformações são menores. | Spans incluem espera remota e overhead, não tempo SQL puro. Não medimos RTT, EXPLAIN, transporte RSC ou produção; não afirmar dominância end-to-end. |
| 7. Signed URLs/imagens importam? | Assinatura de 76 paths por tela custou 91–202 ms mesmo sem `img` no Estoque inicial. | É custo server comprovado. Download/decode/render de imagens não medidos; abrir foto funcionou pontualmente. |
| 8. Render browser importa? | Ainda não há evidência que quantifique esse custo. Accordions fechados evitam montar as tabelas/imagens. | Painel − server não é render. Trace de main thread/paint e contagem DOM necessários antes de virtualização. |
| 9. Auth/profile importa? | Sim nos spans locais: gate centenas de ms; reload Home perfil 285, claims 99 e layout 535. | Gates incluem dependências e overlap. React.cache deduplica no render; não inferir número duplicado de consultas de uma duração. Não enfraquecer autorização. |
| 10. Próxima otimização? | Primeiro confirmar Preview e capturar waterfall/trace. Candidato limitado: reduzir a cauda de assinatura por sobreposição ou resolução sob demanda. | Nenhuma opção foi aplicada: exige prova antes/depois e preservação do conjunto de imagens, RLS e expiração. Não criar índice sem evidência/decisão humana. |

### Avaliação das correções, sem implementação

Sobrepor assinatura à leitura operacional é possível em Entrada/Saída porque a seleção de paths é estrutural, mas exige preservar exatamente seus filtros ativos. No Estoque, uma configuração inativa ainda é exibida quando seu saldo montado é positivo: o conjunto exato assinado **não depende somente do catálogo**. Assinar indiscriminadamente todos os paths adicionaria trabalho e alteraria o conjunto atual.

Como catálogo e estado operacional já concorrem, antecipar assinatura não elimina automaticamente seus 91–202 ms. Nas amostras pareadas, o espaço estimado de sobreposição + transform é da ordem de 20–59 ms no Estoque, 49 ms na Entrada e 26 ms na Saída; esses números são **análise de dependências**, não ganho medido, nem promessa. A correção foi adiada pelo Lead para evitar mudar comportamento com teto limitado sem antes/depois.

Assinatura sob demanda poderia remover trabalho inicial sem imagens visíveis, mas precisaria contrato autenticado por alvo validado, estados de carregamento/erro, compatibilidades e teste de expiração. É mudança moderada, não apenas deslocar um await. Não foi implementada. Não há justificativa medida para virtualização, memoização adicional, mudança de auth ou reabrir a otimização do core de Pedidos.

### Recommendations e diferença de contexto de cache

Não atribuímos callback true da API automaticamente a `dynamic = "force-dynamic"`. No código instalado de Next 16.2.11, o handler define `workStore.forceDynamic`, enquanto `unstable_cache` verifica `workStore.fetchCache === 'force-no-store'` para bypass. O IncrementalCache em dev também retorna miss com request `cache-control: no-cache`; a chave usa texto do callback + keyParts, e revalidação pode executar callback. Headers técnicos, estado real do cache e diferenças de bundle não foram observados nessa coleta. São hipóteses de investigação, não causas confirmadas. O no-store autenticado e o warm single-flight da #65 permanecem intactos.

## Limites e continuação

As melhorias de core/mídia sob demanda de Pedidos (#53), navegação/recommendations (#65) e catálogo (#66) já estavam na base. A #67 adicionou diagnóstico, não essas otimizações. O anexo histórico da #53 foi avaliado no contexto atual, sem ressuscitar sua PR mergeada.

Preview/produção, payload RSC, rede/browser download/decode, custo DOM/render, shell/TTI e cold/warm controlados continuam **não medidos**. O navegador autenticado local tornou a coleta possível após a implementação inicial; não substitui confirmação autenticada no Preview. O botão Desligar foi verificado e removeu o painel ao final da rodada. Não é correto marcar APPROVED FOR HUMAN TEST como se o diagnóstico de produção estivesse concluído.

Próxima rodada: abrir Preview do HEAD final autenticado; repetir a sequência com viewport/rede registrados, copiar painel + logs na mesma janela e capturar Network/Performance. Conferir callback das páginas e de duas requests consecutivas de recommendations, sem copiar cookies, IDs ou URLs assinadas. Separar compilação dev, prefetch, request RSC, espera server e main thread. Depois escolher no máximo 1–2 correções comprovadas e medir antes/depois no mesmo ambiente. Se o gargalo exigir migration/index/RPC/schema/RLS/auth/infra/dependência, parar para decisão humana.
