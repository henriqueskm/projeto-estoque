# Retirada integral → Histórico — Issue #100

Base main: `adc99fb56fed77d0e29c1f61602ee428a2da1291`.
Primeiro commit: reconciliação #97, descrita em `MIGRATION_HISTORY_ALIGNMENT.md`.
Segundo: migration nova `20261023043855_auto_finalize_integral_supplier_order_pickup.sql`
e integração mínima de receipt/feedback em Pedidos. Não aplicada remotamente.

## Regra e ponto transacional

Somente uma retirada **positiva** nova pode causar encerramento automático.
É necessário Pedido não cancelado/não finalizado, pelo menos uma linha, todas
com `picked_quantity = ordered_quantity` e `cancelled_quantity = 0`.
Retirar todos os **prontos** não equivale a retirar todos os **pedidos**.
Não há trigger de prontidão, backfill ou classificação ad hoc no React.

Os dois workers canônicos privados (`set_supplier_order_item_picked_quantity`
e `mark_supplier_order_all_picked`) mantêm a lógica atual de retirada e entrada
no estoque. Depois da entrada automática e antes da criação do receipt/evento
imutável de pickup, chamam o helper privado
`auto_finalize_integral_supplier_order_pickup`. Ele revalida a regra estrita e
compõe `private.finalize_supplier_order`, sem um segundo writer de finalização.
Isso cobre linha, Retirar prontos/tudo, Assistente e filhos do bulk #84.
A Safisa continua informando prontidão, não executando retirada por conta própria.

A finalização canônica grava `finalized_at`, autor/nome reais, motivo
**Finalização automática após retirada integral**, evento `ORDER_FINALIZED`,
`closure_kind=FINALIZED`, `is_in_history=true` e `is_active_order=false`.
O evento de finalização recebe chave interna distinta da chave pickup/estoque;
um replay da retirada retorna o receipt já persistido antes de tentar finalizar
novamente. Eventos históricos nunca são atualizados para mudar seu resultado.

## Locks, falhas e segurança

- Pai do Pedido → todas as linhas por UUID → metadata/balances canônicos.
  O worker individual agora pré-locka todas as linhas antes de estoque; o bulk
  mantém todos os pais → todas as linhas → targets → filhos. Locks da
  finalização são reentrantes, não introduzem aquisição tardia de novas linhas.
- Atualizações de versões/stale e idempotência continuam nos writers checked.
- Falha de entrada, overflow, evento de pickup ou finalização aborta também
  picked/stocked, lotes, movimentos, vínculos, eventos e ledger bulk.
- Novo helper `SECURITY INVOKER`, `search_path=''`, sem EXECUTE para
  PUBLIC/anon/authenticated/service_role. Nenhuma policy/RLS/grant público ampliado.
  Autoria continua derivada de `auth.uid()`/perfil nos wrappers existentes.
- Não há novo lote de estoque para finalizar. Conservação de saldos e
  `before + change = after` permanecem nos movimentos oficiais.

## Receipts, interface e navegação

O receipt de pickup agora é produzido com a classificação final, depois da
entrada e da finalização. A action preserva/valida `isInHistory` e `closureKind`
quando presentes; receipts anteriores continuam compatíveis antes do rollout.
Ao receber `FINALIZED`, a confirmação fecha, limpa o detalhe ativo e informa
explicitamente que houve entrada e transferência para Histórico. Não tenta
recarregar o Pedido encerrado pela consulta de Ativos.

Durante esta visita, IDs conhecidos como finalizados usam o reader de Histórico
quando um checkpoint seguro de Back/Forward restaura o detalhe. Ele abre
somente leitura, sem ressuscitar confirmação/mutação. Não muda Workspace State
schema v1, listener global, Cache Components ou política Activity. Dados úteis
continuam preservados. Invalidações incluem Pedidos e, quando há entrada real,
Home, Estoque, Entrada/Saída, Estatísticas, Histórico e Relatório.
Assistente já faz readback canônico e gera link para a view final do Pedido;
nenhuma alteração de IA. Bulk mantém seus receipts/vínculos por Pedido.

## Backlog e legado

Somente o delta recém-retirado recebe entrada automática. Quantidades antigas
já retiradas mas não lançadas permanecem em `waiting_stock_quantity`; podem
receber entrada vinculada depois da finalização, sem reabrir o Pedido.
Pedido COMPLETED ainda ativo não é finalizado pela instalação nem por pickup
de delta zero; mantém Finalizar pedido manual como compatibilidade.

O Lead informou 1 COMPLETED ainda ativo em produção. Nenhuma leitura de seus
dados nem alteração foi necessária. Após autorização futura, a conciliação
pode ser feita individualmente pela finalização manual, com prévia/versão e
autoria. Não há DML automático para esse legado nesta PR.

## Evidência e reprodução local

`node tests/supplier-order-auto-finalization.bootstrap.local.mjs` exige o
container local rotulado #95 como fonte **apenas de schema**. Cria um container
novo `supabase_db_nk_issue100` com `--network none`, sem portas/credenciais,
catálogo sintético de seis produtos e aplica somente nele a migration nova.
O histórico local de 45 versões é metadata de fixture; não é repair remoto.
Não reutiliza/limpa a fonte nem copia usuários, Pedidos, saldos ou dados reais.

`node --test tests/supplier-order-auto-finalization.local.mjs`: 18 cenários
reais de banco, incluindo 5 corridas de duas sessões. O teste prova overlap
em `pg_stat_activity`, usa deadlines de 4–6 s e compara deadlocks antes/depois.
Cobre autoria, 2+3 linhas, todos-prontos parcial, cancelamento, legado, backlog
no Histórico, aliases/configuração, bulk completo/parcial, replay e rollback.

Regressões existentes usam o container isolado por variável de harness:
`BULK_TEST_DB_CONTAINER`, `ATOMIC_PICKUP_TEST_DB_CONTAINER` e
`SAFISA_TEST_DB_CONTAINER`. Guards de nome/label/rede são preservados; não se
reconcedem wrappers unchecked revogados. Chamadas históricas dos harnesses
Atomic/Lifecycle são adaptadas para as RPCs checked; perdedor stale exige
refresh/retry explícito, não adoção silenciosa do saldo concorrente.

Fixture visual: `node tests/supplier-order-auto-finalization.ui-fixture.mjs`,
`http://127.0.0.1:3100/pedidos`, workspace real com ações/dados locais falsos,
sem Supabase. Smoke Chrome integrado em 320×800, 375×812 e 1440×900:
confirmação simulada, sucesso/fechamento, Back histórico read-only e Forward
sem confirmação antiga; sem overflow ou errors/warnings de console.
Emulação não comprova gesto Android/PWA físico. Browser integrado substitui
CLI pelas restrições do ambiente. Nenhuma operação confirmada no Preview remoto.

Resultados em 2026-10-23:

| Grupo | Resultado |
| --- | --- |
| Histórico de migrations | 2/2 |
| Auto-finalização e stale actions | 16/16 (9 novos da #100) |
| Pedidos/Assistente/Safisa/push/Atomic contratos | 156/156 |
| Bulk app | 18/18 |
| Workspace/Activity/Semantic Back/Instant Navigation/UI/Inventory | 246/246 |
| Catálogo físico (rename #97) | 22/22 |
| SQL novo, banco real isolado | 18/18 |
| SQL bulk completo, incluindo corridas com Safisa | 27/27 |
| Atomic pickup SQL | A–M + 3 corridas + rollback: PASS |
| Safisa automatic lifecycle SQL | A–O + 4 corridas: PASS |
| Safisa push SQL | Subscriptions/RLS, ITEM_READY, FULLY_READY, correção, replay, mark-all único push, worker/lease: PASS |

Total Node test: **505 passed, 0 failed, 0 skipped**, além dos três harnesses
SQL adicionais acima. TypeScript, ESLint com zero warnings nos arquivos alterados,
diff-check, build Webpack e build padrão Next/Turbopack: PASS. Os warnings de
Node experimental-loader/module-type e do stub Link em SSR não são novos
erros de runtime. A checagem React foi focada nos callbacks/estado seguro, sem
redesign, novas dependências ou mudanças de navegação global.

## Rollout futuro — exige revisão e autorização separadas

Antes de implantar, comparar novamente as 45 versões antigas com produção.
Somente `20261023043855` pode estar pendente. Rename #97 nunca reaplica SQL.
Usar o procedimento CLI coordenado documentado na reconciliação, conferindo o
dry-run autorizado antes de qualquer aplicação verdadeira. Nesta tarefa não
foram executados db push, migration repair, apply_migration ou backfill remoto.
Antes da migration ser autorizada, Preview serve para revisão de interface/
compatibilidade; não é prova de finalização automática em produção.
