# NK-PR-67 — auditoria de desempenho

Estado: **medição humana no Preview pendente**. Nenhum gargalo foi classificado por tempo e nenhuma otimização de comportamento foi feita. A revisão estática abaixo descreve trabalho executado pelo código; não é benchmark.

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

Os streams paginados podem executar mais de uma query física quando ultrapassam o tamanho de página da API. `streamCount` indica leitores lógicos, não número real de round trips. A garantia >1000 da NK-PR-63 não foi alterada.

## Catálogo #66 e segurança

`loadSharedCatalogForCurrentRequest` passa por `requireActiveProfile` e `getSession` **antes** de consultar `unstable_cache`. A chave inclui o usuário; a leitura de origem usa JWT/RLS. O callback do cache faz quatro streams estruturais paralelos. A nova métrica `catalogReadFromSource` informa apenas se **o callback local iniciou antes de a chamada retornar**; `false` não prova cache quente global nem descarta revalidação posterior. A leitura de saldos e mínimos não usa cache persistente. A assinatura de URLs ocorre fora desse cache, com validade de dez minutos.

## Instrumentação adicionada

- Logs estruturais `nk_performance_audit` nos servidores de development/Preview. Em produção (`NODE_ENV=production` e `VERCEL_ENV` diferente de `preview`) o helper retorna sem serializar payload e sem emitir log.
- Auth: claims, perfil, fallback de usuário, espera do layout; catálogo: sessão, gate, callback de leitura, consulta ao cache. Estoque: saldos, mínimos, transformações, total. Entrada/Saída: builder e total. Imagens: duração de `createSignedUrls` e quantidade de paths, sem paths ou URLs nos logs. Attention: três ramos e total. Pedidos conserva métricas e `Server-Timing` existentes.
- `?nk_perf=1` ativa um painel no Preview ou development, persistindo apenas o interruptor em `sessionStorage`. `?nk_perf=0` ou “Desligar” desativa. O painel mede clique em link da sidebar até o marcador da rota ser montado e o próximo frame. Para abertura inicial, usa o relógio da navegação até esse marcador. Isto **não é TTI**, não mede a interação operacional subsequente e não separa precisamente rede RSC, hidratação e pintura. “Intenção prefetch” indica pointer/focus observado; não prova que o prefetch terminou.
- `payloadBytes` representa o JSON do resultado do loader antes da serialização RSC, quando medido. Não é o tamanho do payload RSC nem dos arquivos de imagem. A leitura de imagens no navegador (download/decodificação) ainda precisa do painel Network/Performance do browser; o timer de URLs assinadas mede somente a chamada server ao Storage.

Nenhum log contém identificador de usuário, token, cookie, código de item/pedido, path de imagem ou mensagem. As métricas não são enviadas a serviço externo. O console do Preview da Vercel pode ser filtrado por `nk_performance_audit` e `supplier_orders_performance`; correlacione uma rodada isolada pela janela de horário e ordem de rotas, sem identificador pessoal.

## Procedimento reproduzível no Preview

1. Abra o Preview final em navegador autenticado, acrescente `?nk_perf=1` em `/`, mantenha DevTools Network aberto com Preserve log. Anote dispositivo, navegador, tipo de rede, horário, URL de Preview e HEAD da PR.
2. Registre separadamente a primeira abertura. Ela é “primeira navegação observada”, não “cold cache” comprovado. Para chamar uma amostra de cold, é preciso controlar a nova instância/cache ou ter evidência da leitura de origem (`catalogReadFromSource: true`). Não invalide catálogo operacional só para benchmark.
3. Clique na sidebar: Assistente → Estoque → Entrada → Saída → Pedidos → Estoque. Copie o JSON do painel, o waterfall Network/RSC e os logs server correspondentes. Registre se a intenção prefetch foi observada. Espere a interface operacional aparecer antes de seguir.
4. Repita a sequência na mesma sessão para “navegação repetida”. Identifique separadamente as chamadas em que `catalogReadFromSource: false`; só chame o cache de warm se o estado tiver sido controlado, e registre mudança possível entre instâncias e prefetch/browser.
5. Para imagens, conte requests e bytes no Network, marque tempo de download e, se necessário, faça trace de paint/decode no Performance. Nunca copie URLs assinadas no relatório. Para Estoque, registre contagem de nós DOM e duração de render no profiler antes de propor virtualização.
6. Envie JSON do painel e logs estruturais sem dados de negócio. Desligue com o botão ou `?nk_perf=0`.

## Resultados — aguardando rodada autenticada

| Pergunta | Evidência necessária | Resultado atual |
| --- | --- | --- |
| Maior custo na abertura inicial | NavigationTiming, auth/layout, shell/Attention, Network | Não medido |
| Maior custo em Estoque | loader, catálogo, saldos, mínimos, signed URLs, RSC e frame | Não medido |
| Maior custo em Entrada | loader, catálogo, saldos, imagens e frame | Não medido |
| Maior custo em Saída | loader, catálogo, saldos, imagens e frame | Não medido |
| Cache #66 reutilizado em navegação quente? | `catalogReadFromSource` por rodada/instância | Não medido |
| Supabase dominante? | spans de consulta comparados com total e Network | Não medido |
| Imagens relevantes? | assinatura server + Network/trace client | Não medido |
| Render client relevante? | diferença entre server e frame com trace React/browser | Não medido |
| Auth/profile relevante? | claims/profile/layout em rodadas repetidas | Não medido |
| Próxima otimização | ranking por durações observadas antes/depois | A decidir após medição |

## Limites

Nenhum navegador autenticado do Negócios K estava disponível durante a implementação. Os tempos de Preview, tamanhos RSC, estado cold/warm real, download/decode de imagens e custo DOM não foram observados. O painel não prova que uma tela esteja pronta para todas as ações; seu marcador é o commit/primeiro frame do conteúdo da rota. Nenhuma otimização deve ser escolhida com base apenas na matriz estática.
