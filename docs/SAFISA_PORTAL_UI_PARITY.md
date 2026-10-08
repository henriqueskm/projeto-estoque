# Portal Safisa — paridade visual com Pedidos NK

Base: `90581f55ed3ac5a7b84b49c4be5ec3dba27e95ca`. PR #87, apresentação somente.

## Antes / depois

| Antes | Depois |
| --- | --- |
| Cards grandes à esquerda e detalhe permanente à direita | Lista em largura total, tabela compacta e Pedido em dialog |
| Quatro métricas grandes no Pedido e em cada item | Progresso da produção + quantidades na linha e informações secundárias |
| Ação global em card azul no topo | Dock inferior, fora da área de scroll, com a mesma confirmação |
| Confirmação sem focus trap | Shell visual azul, foco inicial, Tab/Shift+Tab, Escape, foco restaurado e bloqueio pending |

Referência direta: `OrderDetailsDialog` / tabela de `orders-workspace.tsx`.
Hierarquia, largura máxima do dialog (61,25rem), faixa de data/status, progresso,
ordem de produção, grid de quatro colunas e dock seguem o NK. Não importamos ações,
permissões nem writers internos. Safisa mantém azul/branco, verde para pronto,
âmbar para parcial/correção e vermelho para erro. Não há novas animações.

O status apresentado descreve **produção**, pelo `readinessStatus` existente;
retirada é informação secundária, nunca a fonte do progresso. As quantidades
canônicas e suas fórmulas não foram alteradas.

## Operações e contratos preservados

- `incrementSafisaReadyQuantity`, `markSafisaRemainingReady`,
  `markSafisaOrderRemainingReady`, `correctSafisaReadyQuantity` e `safisaLogout`.
- Payloads, `expectedUpdatedAt`, min/max, confirmação e justificativa continuam
  os mesmos. Não há loop por item para concluir o Pedido.
- `prepareSafisaLogicalAttempt`, restore/serialize, persistência, chave lógica,
  bloqueio de double-submit e reconciliação `RESULT_UNKNOWN` foram preservados.
- Resultado desconhecido continua bloqueando novas mutações; somente o retry
  explícito pode verificar a mesma tentativa, sem gerar nova chave.
- `app/safisa/page.tsx`, actions, readers, tipos e fórmulas server-side intactos.
- URL `/safisa?pedido=<id>` continua sendo a identidade do detalhe. Abrir pela
  lista usa push com `scroll:false`; fechar retorna por Back. Deep link/reload
  fecha com replace para `/safisa`, nunca logout. A aba local permanece.
- Prefetch por pointer enter, focus e touch start permanece. Nenhuma leitura de
  catálogo interno, dependência nova ou N+1 foi introduzida.
- Confirmações não reaparecem após troca do detalhe/Activity. A limpeza não
  modifica attempt/payload/idempotency; pending mantém os gates existentes.

`SafisaPortalDialog` é somente apresentação/foco/scroll. Dialogs aninhados usam
inert, bloqueio de fundo, foco limitado ao dialog superior e contagem de scroll
locks para liberar corretamente o body ao fechar ambos.

## Gate de push

A suíte de UI compara com a base os trechos de execução/tentativa lógica e os
arquivos protegidos. Dispatcher, service worker, Firebase client, actions Safisa,
readers/tipos e `20261006104415_safisa_item_ready_push_notifications.sql` estão
inalterados; o diff de **todas** as migrations é vazio.

A suíte de push (55 testes) passou: ITEM_READY usa delta/snapshots; incremento
final entrega somente FULLY_READY; mark-all mantém FULLY_READY; correções,
destinatários, claim/complete, retries, timeout e FIDs inválidos permanecem.
Nenhum push real foi enviado pelo smoke.

## Validação automatizada

| Suíte | Passaram |
| --- | ---: |
| Portal Safisa | 19 |
| Idempotência / transporte / retry | 17 |
| Automatic lifecycle | 6 |
| Migration contracts Safisa | 6 |
| Legacy order transition | 6 |
| Push / ITEM_READY / FULLY_READY | 55 |
| UI layout regressions | 13 |
| Nova UI parity (render real + contratos) | 10 |
| **Total** | **132** |

Nova suíte:

```powershell
node --experimental-strip-types --experimental-loader ./tests/safisa-portal-ui-loader.mjs --test tests/safisa-portal-ui.test.mjs
```

TypeScript, ESLint `--max-warnings 0`, `git diff --check`, build Webpack e build
padrão Next/Turbopack passaram. Cache Components e Partial Prefetching permanecem
ativos; 54 páginas geradas em cada build. Warnings do runner Node sobre loader
experimental / package type já fazem parte do método existente, não do browser.

Não reexecutamos scripts SQL destrutivos sobre o baseline local compartilhado:
esta PR não altera SQL e não havia container descartável de push disponível.
Os contratos SQL existentes e a suíte TypeScript/FCM foram executados.

## Smoke visual local sanitizado

Chrome pelo browser permitido do Codex, com locators Playwright. A restrição do
ambiente exige `cua_repl` para interações; não invocamos um segundo mecanismo CLI
de browser nem copiamos sessão/cookies. A skill Playwright orientou o checklist.

Harness reproduzível, sem Supabase, Auth ou conexão com produção:

```powershell
node tests/safisa-portal-ui.browser-fixture.mjs
# http://127.0.0.1:3087/safisa
# ?fixture=unknown&pedido=87000000-0000-4000-8000-000000000101
```

Os stubs de ações rejeitam qualquer tentativa de mutação; dados são sanitizados.
O harness usa o componente e CSS reais, não uma cópia da tela. Nenhum script de
teste é importado por uma rota do produto.

| Viewport | Lista / detalhe parcial | Histórico / extremos | Resultado desconhecido |
| --- | --- | --- | --- |
| 320 × 800 | OK | OK | OK |
| 375 × 812 | OK | OK | OK |
| 768 × 1024 | OK | OK | OK |
| 1440 × 900 | OK | OK | OK |

Largura do documento = viewport nos quatro tamanhos. No extremo com código longo
e 9.999 unidades, scrollWidth/clientWidth do dialog foram respectivamente
302/302, 357/357, 734/734 e 978/978. Quantidades principais permaneceram legíveis.
Histórico tinha zero inputs; estado desconhecido mantinha todos os novos writers
desabilitados e retry habilitado nos quatro tamanhos.

Também verificados: item pronto dentro de Pedido parcial, Pedido completamente
pronto, correção disclosure + revisão sem submit, confirmações, Tab/Shift+Tab,
Escape, foco restaurado, URL, Back/Forward e aba Histórico preservada. Nenhuma
confirmação transacional reapareceu via Forward; scroll lock foi liberado ao sair.
Console local: zero errors/warnings observados.

Deep link fechado voltou a `/safisa`. Com reduced motion emulado, a confirmação
global abriu/fechou normalmente, sem submit nem nova animação.

Comparação visual complementar com a página/detalhe NK reais, somente leitura,
usando a sessão interna já disponível; nenhum botão de mutação acionado.

## Limitações / autorização

- Emulação de viewport não comprova teclado virtual ou safe areas de aparelho
  físico. Recomenda-se smoke humano Safisa em celular antes do merge.
- Histórico, correção e RESULT_UNKNOWN foram exercitados com fixtures; não
  criamos estados ou Pedidos reais para fabricar evidência.
- Smoke autenticado no Preview Safisa depende de sessão **Safisa** autorizada.
  A conta interna NK não é usada para contornar membership do Portal.
- Preview e resultado de acesso remoto são registrados na descrição da PR,
  associados ao HEAD exato, sem commitar credenciais ou capturas sensíveis.

Zero migrations. Zero RPC changes. Zero changes to Safisa notification semantics.
Zero stock mutations. Zero remote business-data mutations. PR Draft, sem merge
ou auto-merge.
