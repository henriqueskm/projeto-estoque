# Auditoria de completude das leituras Supabase

Data: 2026-09-23
Base auditada: `ebaf0c129a4b35f9e1078d016c266f68f84554fd`

## Escopo e classificação

Foram inventariados os 225 `select` reais de `lib/`. O `select` de um
`textarea` não faz parte do inventário.

| Classe | Significado | Sites |
| --- | --- | ---: |
| A | Naturalmente limitada por PK, unicidade ou entrada já limitada | 79 |
| B | Paginação completa já existente e preservada | 15 |
| C | Janela deliberada de produto, prévia, token ou ambiguidade | 47 |
| D | Potencialmente truncável, mas apenas em metadado/contrato secundário | 9 |
| E | Bug de completude confirmado | 75 |
| **Total** |  | **225** |

O falso limite vinha de `max_rows = 1000`: aumentar `.limit()` não supera o
teto do PostgREST. Os sites E agora usam páginas de no máximo 1.000 linhas,
ordem total estável e propagação de erro sem devolver resultado parcial.

## Inventário fora da Assistente (83)

| Arquivo / função | Classe | Quantidade | Justificativa / ação |
| --- | ---: | ---: | --- |
| `auth.ts` / `requireActiveProfile` | A | 1 | Perfil por PK e `maybeSingle`. |
| `supplier-orders-route-auth.ts` / autenticação | A | 1 | Perfil por PK e `maybeSingle`. |
| `catalog-writer.ts` / tabela de códigos | B | 1 | Paginação preexistente por código único, preservada. |
| `inventory-data.ts` / snapshot | E | 6 | Itens, modelos, saldos, configurações, aliases e saldos montados agora paginam por chave. |
| `inbound-data.ts` / catálogo | E | 6 | As seis leituras globais agora paginam. |
| `outbound-data.ts` / catálogo | E | 6 | As seis leituras globais agora paginam. |
| `home-data.ts` / resumo | E | 5 | Catálogo e saldos agora são completos. O alias passou a selecionar `id` para desempate real. |
| `purchase-recommendations.ts` / recomendações | E | 7 | Cinco snapshots, resumos e linhas pendentes agora paginam; pendências após 1.000 entram no cálculo. |
| `history-data.ts` / página principal | B | 1 | A página de 25 lotes já usava `range`; preservada. |
| `history-data.ts` / relações de 25 lotes | E | 5 | Linhas inbound/outbound, movimentos e montagens agora paginam sem alterar a página de lotes. |
| `history-data.ts` / lookups por IDs | A | 3 | Chunks de 100 por PK. |
| `history-data.ts` / aliases por configuração | D | 1 | Fanout de aliases; permanece secundário no detalhe. |
| `history-data.ts` / detalhe de um lote | A | 6 | PK do lote e relações limitadas pelo máximo operacional de 500 linhas. |
| `statistics-data.ts` | B | 11 | Loader oficial e todos os filhos já paginavam; preservados. |
| `vehicle-applications.ts` | A/B | 2/2 | Marcas/slug limitados; aplicações e códigos já paginados. |
| `safisa-pickup-alerts.ts` | A | 1 | IDs vêm de RPC com limite explícito de 500. |
| `safisa-push-dispatch.ts` | E | 1 | Todas as inscrições ativas são lidas antes dos chunks multicast de 500. |
| `supplier-orders-data.ts` / catálogo | E | 4 | Quatro tabelas globais agora paginam. |
| `supplier-orders-data.ts` / lista | E | 1 | Lista completa com desempate final por `id`. |
| `supplier-orders-data.ts` / detalhe e mídia por PK | A | 5 | Resumo/itens/fontes limitados pelo pedido. |
| `supplier-orders-data.ts` / mídia compatível, componentes, aliases, eventos | D | 4 | Metadado/timeline secundários; sem promessa nova de snapshot distribuído. |
| `supplier-orders-data.ts` / busca | E | 1 | Removeu a janela silenciosa de 250; detalhes paginam, IDs são deduplicados e summaries usam chunks paginados. |
| `supplier-orders-data.ts` / summaries candidatos | A | 1 | Era limitado a 250 IDs; após a correção passa a fanout chunkado dentro do mesmo E da busca. |

Totais fora da Assistente: A21, B15, C0, D5, E42.

## Inventário da Assistente (113)

| Arquivo / função | Classe | Quantidade | Justificativa / ação |
| --- | ---: | ---: | --- |
| `assistant-attention-data.ts` / pedidos aguardando entrada | E | 1 | Count e soma exigem todos os pedidos; paginação completa. |
| `assistant-configuration-assembly-data.ts` / enriquecimento | C | 3 | Resolução limitada a até 100 códigos e até 200 componentes. |
| `assistant-configuration-assembly.ts` / confirmação | A | 3 | Perfil por PK, batch por unicidade e batch por PK. |
| `assistant-configuration-disassembly-data.ts` / `buildTargets` | C/D/E | 3/1/1 | Configurações/saldos são derivados; componentes podiam chegar a 2.000 e agora usam chunks paginados. O fanout de aliases D também foi endurecido porque passou a depender do conjunto completo. |
| `assistant-configuration-disassembly-data.ts` / resolução limitada | C | 5 | Limites deliberados 10/20/20/20/100 preservados. |
| `assistant-configuration-disassembly-data.ts` / por código | A | 1 | Código por PK. |
| `assistant-configuration-disassembly-data.ts` / por servo | E | 2 | Todas as configurações e todos os códigos agora paginam/chunkam. |
| `assistant-configuration-disassembly.ts` / confirmação | A | 3 | Perfil, idempotência e recibo por chaves únicas. |
| `assistant-data.ts` / snapshot geral | E | 7 | Catálogo, saldos e compatibilidade completos. |
| `assistant-data.ts` / mídia exata | A/E/C | 3/3/1 | Exact code permanece único; fanout por kit, componentes e aliases agora pagina; modelos downstream também são chunkados/paginados. |
| `assistant-data.ts` / resumo exato | A/E/C | 3/5/2 | Fanouts por servo/kit, componentes, aliases e saldos agora completos; saldos de configuração/modelos downstream também foram endurecidos. |
| `assistant-manual-stock-entry.ts` / confirmação | A/C | 2/2 | Perfil/idempotência e até 500 movimentos do token. |
| `assistant-manual-stock-output.ts` / confirmação | A/C | 2/2 | Mesmo contrato de token até 500. |
| `assistant-order-photo-route.ts` / autenticação | A | 1 | Perfil por PK. |
| `assistant-stock-entry-data.ts` / alvos de Pedido | C/D | 5/1 | Prévia até 20; aliases são metadado secundário. |
| `assistant-stock-entry-data.ts` / resolução manual | C/D | 8/1 | Limites 10/20/50/100 preservados; aliases secundários. |
| `assistant-stock-entry-data.ts` / alvos por token | C/D | 6/1 | Token até 500; aliases secundários. |
| `assistant-stock-output-data.ts` / enriquecimento | C | 3 | Até 100/500 configurações e no máximo 1.000 componentes. |
| `assistant-supplier-order-finalization.ts` | A | 4 | PK, negociação única, perfil e evento idempotente. |
| `assistant-supplier-order-photo-catalog.ts` | E | 3 | Itens, configurações e aliases completos. |
| `assistant-supplier-order-pickup.ts` / lookups exatos | A | 3 | Resumo/linha por PK. |
| `assistant-supplier-order-pickup.ts` / ambiguidade | C | 2 | Janelas deliberadas de sete opções preservadas. |
| `assistant-supplier-order-pickup.ts` / sentinelas | E | 4 | Leitura real até 1.001; multi-pedido valida no máximo 1.000 por pedido, mesmo com mais de 1.000 no total. |
| `assistant-supplier-order-pickup.ts` / autenticação | A | 1 | Perfil por PK. |
| `assistant-supplier-order-stock-entry.ts` | A/E/C | 4/1/2 | Linhas usam sentinela real 1.001; refresh de até 20 linhas permanece limitado. |
| `assistant-supplier-orders.ts` / matching de catálogo | E | 2 | Sentinela real 1.001, mantendo fail-closed acima de 1.000. |
| `assistant-supplier-orders.ts` / summaries | C | 1 | Count exato e janela de lista/agregado preservados. |
| `assistant-supplier-orders.ts` / mídia | E/C | 3/1 | Configurações, componentes e aliases completos; modelos downstream também chunkados/paginados. |
| `assistant-supplier-orders.ts` / detalhe | E/C | 1/1 | Branch por código usa sentinela real; branch normal continua janela de 21 para exibir 20. |

Totais da Assistente: A29, B0, C47, D4, E33.

## Baseline E versus hardening downstream

Os totais acima são a classificação da base antes da correção e não foram
recalculados depois do patch: os 75 sites E foram corrigidos. Além deles, o
fanout D de aliases em `assistant-configuration-disassembly-data.ts` e os
lookups downstream antes classificados C de modelos/saldos de configuração em
`assistant-data.ts` passaram a usar chunks paginados. Esse hardening é
necessário porque corrigir o E upstream permite que o conjunto derivado passe
de 1.000; ele não amplia a seleção funcional nem transforma os demais D em
contratos de completude. Os D de histórico, mídia secundária de Pedidos,
timeline e aliases de `assistant-stock-entry-data.ts` permanecem riscos
residuais documentados.

## Estratégia implementada

- `fetchAllSupabaseRows` usa `range`, página máxima de 1.000 e chave única
  obrigatória. Duplicata, falta de progresso, página grande demais ou erro em
  qualquer página resulta em falha sem dados parciais.
- `fetchAllSupabaseRowsByChunks` limita os arrays usados em `.in`; cada chunk
  também é paginado. Chunk pequeno não é tratado como garantia contra fanout.
- Consultas completas usam ordem por PK ou chave única. Consultas com ordenação
  de negócio recebem `id` como desempate final.
- Guardas de 1.000 linhas da Assistente usam `rowLimit: 1001`: 1.000 exige a
  leitura da página seguinte; a 1.001ª linha preserva o erro fail-closed.
- Nenhum limite deliberado de 10, 20, 50, 100 ou 500 foi ampliado.

## Limitações residuais

A paginação por offset oferece completude para um conjunto estável durante a
leitura, mas não cria um snapshot transacional entre páginas. Inserções ou
remoções concorrentes podem deslocar offsets; duplicatas são detectadas e
falham fechadas, mas uma remoção concorrente ainda pode causar ausência. Fazer
snapshot distribuído exigiria RPC/arquitetura nova e ficou explicitamente fora
do escopo. Os D restantes são metadados/timeline secundários e não alteram
estoque, autorização ou regras operacionais.

Não houve migration, alteração de schema/RLS/auth, escrita remota, mudança de
Gemini, dependência nova ou aumento de `max_rows`.
