# Bulk Safisa Pickup — NK PR #84

Base: `5b6dba535d5da0b5e151c2f9dc26d2fa85b41710`.

## Contrato operacional

O card **Retiradas Safisa** da Assistente oferece **Retirar todos os prontos**.
Não é um comando de IA. Abrir o dialog consulta novamente o servidor e não retira
nem lança estoque. A prévia inclui todas as linhas `ready_quantity > picked_quantity`
de Pedidos não cancelados/não finalizados, inclusive parcialmente prontos.
Código e descrição vêm dos snapshots do Pedido, não de reinterpretação do catálogo.

Limites explícitos: **100 Pedidos e 500 linhas**. A consulta conta o conjunto
completo e falha se exceder um limite; nunca confirma um subconjunto truncado.
Todos os itens da prévia são exibidos, com scroll interno e rodapé acessível.

## Migration e RPCs

Única migration nova: `20261006142946_bulk_safisa_pickup.sql`.

- `public.preview_safisa_bulk_pickup()` retorna resumo, Pedidos, versões e linhas.
- `public.bulk_mark_supplier_orders_all_picked_checked(jsonb, uuid)` confirma tudo
  em uma transação, com identidade obtida por `require_supplier_order_user()`.
- O worker privado compõe **`private.mark_supplier_order_all_picked_checked`**.
  Não existe loop de writes no client/server action, nem outra regra de estoque.
- `public.supplier_order_bulk_pickup_operations` guarda autoria, nome snapshot,
  request canônica e receipt. RLS habilitada, sem policies ou acesso direto dos
  clientes, inclusive `service_role`. Somente os wrappers autorizados acessam o ledger.
- RPCs públicas: `SECURITY DEFINER`, `search_path = ''`, EXECUTE somente para
  `authenticated`/`service_role`; helpers privados sem EXECUTE desses papéis.
  O gate continua exigindo um perfil interno ativo real; não aceita autoria do browser.

Nenhuma migration histórica, push #82, regra de readiness/finalização ou writer
canônico foi alterado. Supplier Orders atualmente resolve ITEM e configuração
comercial; esta PR não acrescenta suporte a bundles nos Pedidos.

## Exatidão, stale e atomicidade

Uma única instrução SQL lê a prévia e suas versões. Cada Pedido tem
`expected_updated_at` e um fingerprint server-side das linhas prontas, incluindo
identidade física, snapshots e quantidades. O timestamp mantém os microssegundos.
O fingerprint também rejeita mudanças se um writer legado reutilizar o timestamp.

A confirmação aceita somente IDs, versões, fingerprints e chave global — não
quantidades arbitrárias. Primeiro bloqueia e valida **todos** os Pedidos/linhas;
só então executa filhos. Mudança de versão/composição, cancelamento, finalização
ou ausência de unidades elegíveis aborta a transação inteira com `40001`.

Um novo Pedido que ficou pronto depois não é incluído nem invalida os já mostrados.
Pedidos já incluídos nunca recebem uma quantidade diferente silenciosamente.

Cada filho mantém seus eventos, stock-entry, linhas e movement batch canônicos.
O bulk exige `added_picked_quantity == stock_entry_quantity > 0` por filho.
Erro tardio desfaz inclusive balances, picked/stocked, eventos, batches, entries
anteriores e ledger global. Não há finalização administrativa adicional.

## Lock ordering

1. Gate de perfil/autoria e advisory lock da chave global, no namespace canônico.
2. Todos os `supplier_orders` por UUID.
3. Todas as `supplier_order_items` por Pedido + UUID da linha.
4. Metadados compartilhados: códigos → configurações → itens, por UUID.
5. Configuration balances por UUID, depois item balances por UUID.
6. Workers filhos por UUID de Pedido; os recursos de estoque já estão bloqueados.

Aliases candidatos são pré-bloqueados porque o worker existente pode resolver
alias ausente. Balance rows ausentes são provisionadas como zero da mesma forma
que inbound canônico, apenas dentro da transação; não constituem lançamento,
movimento fictício ou saldo artificial. Qualquer falha desfaz a provisão.

Os testes concorrentes cobrem mesma ação, bulks sobrepostos, bulks disjuntos com
targets em ordem oposta, retirada individual e entrada vinculada histórica.
Nenhum `SKIP LOCKED` é usado: Pedido problemático não pode ser pulado.

### Gate concorrente com writers Safisa — 2026-10-06

Quatro regressões adicionais usam **duas sessões PostgreSQL reais**, chamando os
wrappers públicos autenticados, sem substituir workers ou alterar seus locks.
Cada writer é exercitado como primeiro e segundo vencedor, deterministicamente:
a primeira sessão executa o writer e conserva a transação aberta; a segunda
executa o outro writer. Antes do COMMIT, `pg_stat_activity`, `pg_blocking_pids()`
e `wait_event_type = 'Lock'` comprovam a sobreposição e quem bloqueia quem.
Não basta iniciar dois processos ou presumir corrida por um sleep.

Timeouts locais: statement **6 s**, lock **5 s**, sessão idle-in-transaction
**10 s**; deadline **4 s** para observar cada barreira. As duas sessões são
encerradas inclusive se uma asserção falhar. Nenhum deadlock/timeout foi aceito
como resultado legítimo, e o contador `pg_stat_database.deadlocks` permaneceu igual.

Fixture sanitizada: dois Pedidos, três linhas, **6 unidades** na prévia inicial.
O Pedido concorrente tem `3/10` unidades prontas de um item e `1/7` de um kit;
o outro Pedido tem duas prontas. A Safisa incrementa **2** na primeira linha ou
marca todo o restante das duas linhas (**13 novas unidades**).

| Writer Safisa | Primeiro vencedor | Resultado comprovado |
| --- | --- | --- |
| `increment_safisa_ready_quantity` | Bulk | Somente 6 retiradas/estocadas; incremento posterior 2 continua pendente; nova prévia e alerta mostram 2. |
| `increment_safisa_ready_quantity` | Safisa | Incremento persistido; bulk antigo rejeitado com SQLSTATE `40001`; zero efeitos de bulk nos dois Pedidos; nova prévia/alerta mostram 8. |
| `mark_safisa_order_remaining_ready` | Bulk | Somente 6 retiradas/estocadas; mark-all posterior mantém 13 aguardando próxima retirada; nova prévia/alerta mostram 13. |
| `mark_safisa_order_remaining_ready` | Safisa | Mark-all persistido; bulk antigo rejeitado com SQLSTATE `40001`; zero efeitos de bulk nos dois Pedidos; nova prévia/alerta mostram 19. |

Nos dois casos stale, comparação integral das contagens pré/pós prova ausência
de alterações em picked, stocked, balances físicos/configurações, eventos de
Pedido, movements, batches, stock entries e ledger bulk. Nos casos de sucesso,
receipt, estoque e picked/stocked são exatamente 6, com dois entries/batches e
um ledger. A linha concorrente permanece `ready > picked` após a Safisa.
Também são verificados `before + change = after`, saldos não negativos e um
único evento canônico da ação Safisa. **Nenhuma quantidade nova é incluída
silenciosamente e nenhum double-stock ocorre.**

Reprodução focada, no container descartável já preparado:

```powershell
$env:BULK_TEST_DB_CONTAINER='supabase_db_nk_pr84_bulk_v4'
node --test --test-name-pattern='real bulk vs Safisa' tests/bulk-safisa-pickup.local.mjs
```

Resultado: **4/4 aprovados**. A hierarquia atual Pedido → linhas da Safisa é
compatível com todos os Pedidos → todas as linhas → metadata/balances → filhos
do bulk. Não foram alterados writers, arquitetura ou migration para fechar o gate.

## Idempotência e transporte

O ledger tem `UNIQUE(user_id, idempotency_key)`. Request normalizada por UUID e
timestamp; ordem de entrada irrelevante. Replay idêntico retorna receipt anterior
antes da validação stale. Request diferente com a mesma chave é rejeitada.
Chave já utilizada por operação canônica de Pedido/movement batch é rejeitada.
Os filhos recebem UUIDs próprios na primeira execução, nunca uma chave comum.
Após commit, replay consulta o ledger antes de chamar filhos novamente.

No client, uma tentativa mantém request/chave e bloqueia double click sincronamente.
Timeout, conexão perdida, completion desconhecido ou receipt inválido conservam
a mesma identidade. **Tentar novamente** consulta o resultado dessa operação,
não gera uma nova retirada. Mesmo se os alerts desaparecerem após um commit
incerto, **Verificar retirada pendente** continua disponível para resolver o receipt.

Stale encerra a tentativa antiga e remove a confirmação. **Atualizar prévia** faz
nova leitura e cria nova identidade. Success é terminal: somente Fechar/Ver Pedidos.

Receipt global:

```text
bulkPickupId, orderCount, changedLineCount,
totalPickedQuantity, totalStockEntryQuantity, idempotentReplay,
orders[{ supplierOrderId, negotiationNumber, changedLineCount,
         addedPickedQuantity, stockEntryQuantity,
         supplierOrderStockEntryId, movementBatchId }]
```

Os dois totais devem ser iguais. Parsers validam IDs, linhas, deltas e totais.

## UI, lifecycle e refresh

Dialog usa o Semantic Back central e os helpers Activity/transient já existentes.
Back/Escape/overlay fecham a prévia sem submit; pending bloqueia fechamento e
segundo envio. Forward não restaura confirmação. Activity encerra UI transitória,
sem trocar a chave de uma tentativa incerta. Não altera Workspace State schema v1.
Focus trap, foco inicial em Cancelar, retorno de foco, safe areas e reduced motion
reutilizam os padrões NK; não há page transition ou latência artificial.
O transient é registrado dentro do dialog montado, como `DialogShell` de Pedidos,
para consumir exatamente uma entrada ao fechar por Escape/Cancelar.

Após receipt: revalidate `/`, `/pedidos`, `/estoque`, `/entrada`, `/saida`,
`/estatisticas`, `/historico`; evento existente de inventory-data-changed,
refresh imediato dos alerts e router refresh. Se um refresh estava em voo, o
provider executa uma leitura fresca adicional em vez de perder a invalidação.
Não depende do polling de 60 segundos. O sino não recebeu um fluxo duplicado.

## Validação local e reprodução

Executado em PostgreSQL 17.6 descartável, Docker `--network none`, sem portas,
sem URLs/credenciais remotas. Bootstrap exige fixture local #82 com label de
ownership; não toca no checkout principal nem em banco remoto. Para outra máquina,
é necessário preparar essa fixture local primeiro; não é um runner Supabase remoto.

```powershell
$env:BULK_TEST_DB_CONTAINER='supabase_db_nk_pr84_bulk'
node tests/bulk-safisa-pickup.bootstrap.local.mjs # somente target NOVO
node --test tests/bulk-safisa-pickup.local.mjs
node --experimental-strip-types --experimental-loader ./tests/bulk-safisa-pickup-loader.mjs --test tests/bulk-safisa-pickup.test.mjs
```

Resultados: **27 testes SQL (incluindo as quatro corridas Safisa)**, **18 testes app novos** e **403 regressões**
app/source aprovados (421 app/source no total). Além disso, suites SQL canônicas
atomic pickup A–M + três corridas e automatic lifecycle A–O + quatro corridas
aprovadas no mesmo ambiente descartável. Incluem stale, rollback tardio real,
idempotência, auth/grants, limites de 101 Pedidos/504 linhas, aliases e auditoria.
Reexecutados em 2026-10-06 após fechar o gate: 27/27 bulk SQL e 421/421 app/source,
atomic pickup A–M + três corridas, lifecycle A–O + quatro corridas. A suíte SQL
push também passou em clone descartável separado: deltas individuais, correção,
mark-all com um push, replay concorrente, SKIP LOCKED, lease fencing, grants/RLS
e ordem de reset com rollback integral. Nenhuma entrega FCM remota foi executada.

TypeScript, ESLint zero warnings, diff-check, build Webpack e build padrão
Next/Turbopack aprovados. Cache Components/Partial Prefetching continuam ativos.
Reset/backup classificam o novo ledger como operacional, com DELETE explícito,
row-count e validação pós-reset. Fingerprints/contrato antigo não foram afrouxados:
contrato desatualizado continua recusando execução.

Fixture visual read-only usa o dialog/preview reais e CSS do build atual,
com código longo, descrição extensa e quantidade 9999. Sem DemoToggle ou rota de
produção. A superfície interativa compila os componentes React reais, Activity e
coordenador Semantic Back, substituindo apenas boundaries de servidor/rede.
Confirmações nesta fixture são simuladas, sem Supabase.

```powershell
npm run build -- --webpack
$env:BULK_PICKUP_VISUAL_FIXTURE='1'
node --experimental-strip-types --experimental-loader ./tests/bulk-safisa-pickup-loader.mjs tests/bulk-safisa-pickup.visual.mjs
# Em outro terminal:
npx --no-install playwright-cli -s=nk-pr84-bulk open http://127.0.0.1:3084 --browser=chrome
npx --no-install playwright-cli -s=nk-pr84-bulk run-code --filename=tests/bulk-safisa-pickup.browser.mjs
```

Viewports: 320×800, 375×812, 768×1024 e 1440×900. Artefatos ficam em caminhos
ignorados. Teste em emulação não comprova teclado físico/virtual ou PWA Android real.
Nos quatro viewports: zero overflow, oito linhas sanitizadas completas, focus trap,
Escape, Back/Forward e ocultação/retorno por Activity aprovados. Também passaram
stale com nova identidade, commit incerto seguido de retry com a mesma chave,
sucesso terminal, refresh imediato, pending bloqueando Back/Escape/double submit
e reduced motion. Zero console errors e zero requests remotos nessa fixture.

## Deploy e smoke remoto

**Migration remota NÃO aplicada. Nenhuma confirmação remota autorizada nesta PR.**
O Preview pode compilar antes da migration; nesse estado a prévia real não estará
disponível. A UI informa erro sem executar retirada. Não se deve simular sucesso
remoto, contornar auth ou aplicar migration para completar o smoke.

Após revisão/autorização humana de implantação, smoke autenticado deve apenas
abrir o card/prévia, conferir snapshots/totais/Back/Escape e cancelar. **Não tocar
Confirmar retirada + entrada no Preview ligado à produção.** Local fixture não
substitui esse smoke autenticado. Login humano e migration autorizada são gates
separados; não exportar cookies, tokens ou state autenticado.
