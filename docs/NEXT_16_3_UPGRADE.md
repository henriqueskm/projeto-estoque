# NK PR #76 — Next.js 16.3.8

Base: `da982868622c698abc5eeb3472126213dd4373c6` (`main`, após #75).
Escopo exclusivo de framework/compatibilidade. Nenhuma implementação de Workspace State nesta PR.

## Dependências e compatibilidade

- `next`: **16.2.11 → 16.3.8**, versão estável, não prerelease.
- `eslint-config-next`: **16.2.11 → 16.3.8**, mantendo as regras oficiais alinhadas ao framework.
- React e React DOM **19.2.4 preservados**: satisfazem os peers publicados (`^19.0.0`). Tipos React e TypeScript também preservados.
- Node local: **24.15.0**; requisito do pacote: **>=20.9.0**.
- Lockfile atualiza os transitivos exigidos pelo Next: `@next/env`, SWC/plugin ESLint, `@swc/helpers`, PostCSS e Sharp/binários/libvips. A atualização incidental de `fastq` foi revertida para a versão anterior compatível. Nenhuma biblioteca de aplicação foi atualizada.

A [release 16.3.8](https://github.com/vercel/next.js/releases/tag/v16.3.8) contém correções de segurança. A [política oficial de suporte](https://nextjs.org/support-policy) classifica 16.x como Active LTS.

## Configuração preservada

Inspecionados `package.json`, lockfile, `next.config.ts`, `tsconfig.json`, ESLint, layouts App Router, AppSidebar, cache compartilhado e scripts. Não há `vercel.json` versionado.

- `next.config.ts` continua sem flags adicionais; Cache Components e Partial Prefetching não foram habilitados.
- Nenhum codemod aplicável: os [codemods 16.3](https://nextjs.org/docs/app/guides/upgrading/codemods#163) destinam-se à adoção das opções de cache/prefetch, fora deste escopo. O projeto já utiliza async request APIs, Proxy e ESLint CLI.
- `unstable_cache` user-scoped, auth gate, invalidação e leituras operacionais frescas continuam intactos.
- AppSidebar mantém `prefetch={false}`, `router.prefetch` por intenção, deduplicação por rota e fila idle seletiva.
- Scripts de build não foram trocados. A validação explícita usa `npm run build -- --webpack`; o deployment mantém a configuração existente da Vercel.
- Sem mudanças em Providers, pesquisa, estoque, Entrada/Saída, Pedidos, Assistente/Gemini, writers, auth, migrations ou RPCs.

## Evidência local (não é benchmark)

Mesmo checkout/Node, antes e depois do upgrade, sem controlar estado de cache ou carga do computador. No build novo também havia regressões executando em paralelo. Uma execução por versão não prova ganho/regressão de performance.

| Observação | 16.2.11 | 16.3.8 |
| --- | ---: | ---: |
| Build Webpack completo, stopwatch | 167,22 s | 360,16 s |
| Compilação informada pelo Next | 32,1 s | 2,6 min |
| Typecheck informado pelo Next | 54 s | 66 s |
| Páginas geradas | 43 | 43 |
| Arquivos `.js` em `.next/static` | 82 | 82 |
| Soma de bytes desses arquivos, sem compressão | 1.855.296 | 1.894.145 |

Ambos os builds passaram, inclusive traces. JavaScript estático: +38.849 bytes (~2,1%); isso não representa o download de uma rota nem payload RSC. Não foram medidos tempo de navegação, memória ou ganho do novo prefetch; não afirmar melhora com base nos números do release.

430 testes de regressão passaram (0 falhas/skips): #74/#75, inventory/bundles, seleção/preview de Entrada/Saída, Venda, contexto/consultas/multi-item/semantic routing da Assistente, Pedidos/stale/finalização/entrada vinculada, recommendations, layout/navegação, performance diagnostics, shared catalog, imagens e paginação >1000.

Nenhum warning novo do Next no build Webpack. Os testes mantêm avisos preexistentes do Node sobre `experimental-loader` e `MODULE_TYPELESS_PACKAGE_JSON`; não foram ocultados nem usados para justificar mudança de módulos. O smoke do Preview, console e status do deployment são registrados na descrição da PR. Testes mockados não equivalem à execução remota de uma venda/pedido; nenhuma operação remota é autorizada por esta validação.

## Recomendações específicas para #77 (não implementadas)

1. **Separar upgrade de adoção.** Instant Navigations exige desenho explícito de shells/Suspense e as opções Cache Components/Partial Prefetching; atualizar a dependência sozinho não habilita esse comportamento. Medir primeiro as transições entre Assistente, Estoque, Entrada, Saída e Pedidos. [Guia oficial](https://nextjs.org/docs/app/guides/instant-navigation)
2. **Não depender exclusivamente de Activity para Workspace State durável.** Com Cache Components, Next preserva estado/DOM de até três rotas; a rota mais antiga pode ser descartada. Para pesquisa/carrinho que precisam sobreviver a mais rotas ou reload, definir explicitamente duração, chave de usuário e limpeza no logout. Não persistir saldo/autorizações como verdade operacional. [Preservação de estado](https://nextjs.org/docs/app/guides/preserving-ui-state)
3. **Definir resets seguros.** Preservar drafts/filtros, mas fechar menus/modais transitórios e limpar feedback/chaves de operação concluída. Revisar cleanup de effects ao ocultar/reexibir páginas. Manter o `AssistantConversationProvider` existente, sem duplicar sua persistência. [Preservação de estado](https://nextjs.org/docs/app/guides/preserving-ui-state)
4. **Cache Components é uma adoção própria, não uma flag gratuita.** O layout autenticado usa perfil/cookies e várias rotas possuem configuração dinâmica. Avaliar boundaries por rota antes de habilitar; manter saldos, mínimos, Pedidos e recommendations frescos, sem compartilhar cache autenticado entre usuários. [Migração oficial](https://nextjs.org/docs/app/guides/migrating-to-cache-components)
5. **Integrar com a política atual de prefetch, não duplicá-la.** Partial Prefetching muda o conteúdo antecipado das rotas com Cache Components, mas `Link prefetch={false}` permanece desativado. Comparar o shell recebido pelo warmup atual antes de mudar a fila/intenção; preservar single-flight e no-store da lista recomendada. [Adoção oficial](https://nextjs.org/docs/app/guides/adopting-partial-prefetching)
6. **Medir o novo inlining antes de ajustar limites.** O agrupamento de respostas pequenas de prefetch passa a ser padrão em 16.3. Deixar os defaults; não ativar overrides experimentais apenas por hipótese. [Referência](https://nextjs.org/docs/app/api-reference/config/next-config-js/prefetchInlining)

## Limites

Nenhuma migração, RPC, dado remoto, saldo, regra comercial ou modelo de IA alterado. Sem promoção para Production, merge ou auto-merge. Manter Draft para validação humana.
