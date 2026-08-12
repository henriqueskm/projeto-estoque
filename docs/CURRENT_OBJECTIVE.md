# Objetivo atual

- **ID:** NK-ORD-007
- **Título:** Auditoria de retirada com entrada automática no Estoque
- **Prioridade:** crítica
- **Estado:** `WAITING_ARCHITECTURE_REVIEW`
- **Classificação:** C — exige migration/RPC transacional
- **Branch:** `agent/pickup-auto-stock-audit`
- **Base:** `origin/main` em `8f2a044e2fd94a3720ef9800432496f5f2eaf549`
- **Dependência concluída:** NK-ORD-006, PR #15 mesclado.

## Encerramento de NK-ORD-006

NK-ORD-006 está `DONE`. O PR #15 foi mesclado, a leitura de
`waiting_stock_quantity` foi corrigida, entradas individuais e totais funcionam,
a prévia e a confirmação real foram aprovadas e Pedido/Estoque permaneceram
consistentes. Nenhuma migration foi necessária. Esse fluxo continua sendo a
regularização explícita do backlog histórico `picked_quantity - stocked_quantity`.

## Regra auditada para NK-ORD-007

Toda nova retirada deve, na mesma transação PostgreSQL:

1. validar a quantidade pronta disponível por
   `ready_quantity - picked_quantity`;
2. calcular o delta novo `new_picked_quantity - previous_picked_quantity`;
3. atualizar `picked_quantity` somente se o delta for positivo e válido;
4. lançar exatamente esse delta no saldo físico correspondente;
5. incrementar `stocked_quantity` pelo mesmo delta;
6. criar lote, linhas, movimentos e auditoria coerentes;
7. concluir tudo ou reverter tudo.

O backlog anterior não participa do lançamento automático. Exemplo: se uma
linha tinha `picked = 3`, `stocked = 1` e recebe nova retirada de 1, o estado
final é `picked = 4`, `stocked = 2`; as 2 unidades históricas continuam
aguardando regularização pelo NK-ORD-006.

## Estado atual dos contratos

### Retirada

- os workers efetivos estão em
  `20260807235900_automatic_safisa_order_lifecycle.sql`;
- `private.set_supplier_order_item_picked_quantity` altera uma linha, bloqueia
  Pedido e linha, limita `picked_quantity` a `ready_quantity` e grava
  `PICKED_QUANTITY_CHANGED`;
- `private.mark_supplier_order_all_picked` bloqueia Pedido e linhas em ordem e
  define cada retirada como `ready_quantity`, gravando
  `ALL_ITEMS_MARKED_PICKED`;
- as variantes checked preservam `timestamptz` integral, validam
  `expected_order_updated_at` dentro da transação e retornam replay seguro;
- nenhuma dessas operações cria lote, movimento, entrada ou altera
  `stocked_quantity`.

### Entrada por Pedido

- `private.create_supplier_order_stock_entry` calcula disponibilidade por
  `picked_quantity - stocked_quantity`, bloqueia Pedido e linhas e chama
  `private.stock_inbound_lines`;
- a operação resolve item físico ou configuração comercial, cria batch
  `INBOUND/MANUAL`, linhas, movimentos, saldos, entrada vinculada, linhas de
  vínculo, `stocked_quantity` e evento `STOCK_ENTRY_CREATED`;
- aliases convergem para a configuração física, sem duplicar saldo;
- a entrada é atômica e continua permitida em Pedido encerrado quando existe
  backlog válido.

### Idempotência incompatível com duas chamadas

`supplier_order_events` possui unicidade por `(user_id, idempotency_key)`, e
`private.supplier_order_existing_result` usa advisory lock por usuário/chave e
exige o mesmo tipo de evento e request no replay. O batch de movimento também
possui fronteira idempotente própria. Assim, chamar a RPC de retirada e depois a
RPC de entrada:

- não é uma única transação;
- permite retirada sem entrada se a segunda chamada falhar;
- não pode compartilhar ingenuamente a mesma chave entre eventos de tipos
  diferentes;
- com chaves diferentes, permite retry, clique duplo ou sucesso parcial
  divergente.

Essa composição na aplicação está rejeitada.

## Alternativas avaliadas

### A — nova RPC pública isolada

Uma RPC pública nova pode ser segura, mas manteria os workers públicos antigos
capazes de retirar sem entrada e exigiria migrar e controlar todos os callers.
É aceitável apenas se os contratos antigos forem revogados ou passarem a
delegar ao mesmo worker composto.

### B — evoluir diretamente cada worker canônico

Garante cobertura imediata dos callers existentes, mas duplicaria a resolução
física, criação de entrada e movimentos entre retirada individual e em massa.
Também aumentaria o risco de divergência com NK-ORD-006.

### C — worker privado composto, reutilizado pelos wrappers canônicos

**Recomendação.** Criar, por migration, um worker privado transacional para
retirada + entrada e fazer os wrappers públicos existentes, inclusive checked,
delegarem a ele. O worker de entrada do NK-ORD-006 deve ser refatorado para
compartilhar um primitive privado de aplicação física, sem chamar uma segunda
RPC pública.

O primitive composto deve receber alvos tipados e fechados, calcular os deltas
sob lock e ser a única fronteira de idempotência. Os contratos públicos podem
preservar as assinaturas atuais e ampliar o JSON de retorno com IDs e totais da
entrada automática, minimizando mudanças nos callers.

## Contrato transacional recomendado

### Modos

- **increment:** `target = current_picked + requested_delta`;
- **set_total:** somente `target > current_picked`; delta é a diferença;
- **mark_all:** por linha, `target = ready_quantity`; linhas com delta zero são
  ignoradas.

Reduções não pertencem ao novo fluxo. A interface tradicional hoje permite
reduzir retirada até `stocked_quantity`; a implementação deve remover essa
possibilidade ou separá-la em correção explícita auditada antes de ativar a
entrada automática.

### Ordem de locks

1. advisory lock de idempotência por usuário/chave;
2. `supplier_orders FOR UPDATE`;
3. `supplier_order_items FOR UPDATE` em UUID crescente;
4. códigos/configurações/itens físicos em ordem determinística;
5. `configuration_stock_balances FOR UPDATE` em UUID crescente;
6. `stock_balances FOR UPDATE` em UUID crescente.

Depois dos locks, a transação cria o batch, aplica movimentos/saldos, cria a
entrada vinculada e suas linhas, atualiza `picked_quantity` e
`stocked_quantity`, atualiza a versão do Pedido e grava o resultado idempotente.
Qualquer falha reverte todas as etapas.

### Auditoria recomendada

Usar o evento de retirada existente como ledger idempotente primário
(`PICKED_QUANTITY_CHANGED` ou `ALL_ITEMS_MARKED_PICKED`) e incluir no resultado
os IDs da entrada e do batch. A entrada, suas linhas, o batch e os movimentos
continuam como trilha técnica. Não inserir também `STOCK_ENTRY_CREATED` com a
mesma chave, pois a restrição atual proíbe dois eventos por usuário/chave.

## Identidade física e múltiplas linhas

- linha `ITEM` movimenta `stock_balances`;
- linha de configuração resolve o código comercial ativo, mas movimenta uma
  única `configuration_stock_balance` física;
- aliases da mesma configuração são consolidados no movimento físico;
- o vínculo por linha do Pedido preserva a atribuição de quantidades mesmo
  quando duas linhas convergem para o mesmo alvo físico;
- `mark_all` deve criar um único batch e uma única entrada por Pedido, com todas
  as linhas de delta positivo; falha em qualquer linha reverte o conjunto.

## Callers afetados

- interface tradicional: Server Actions de quantidade retirada por linha e
  “Marcar tudo como retirado”, além do modal/stepper em Pedidos;
- Assistente: resolução, prévia, token e execução de retirada individual,
  `increment`, `set_total` e `mark_all`;
- NK-ORD-006 permanece separado para backlog já existente e continua usando
  `create_supplier_order_stock_entry`.

Foi identificada uma lacuna adicional na Assistente: parte da prévia ainda usa
`ordered_quantity - cancelled_quantity` como teto, enquanto o banco final usa
`ready_quantity`. A implementação deve corrigir a prévia para nunca oferecer
quantidade acima de `ready_quantity - picked_quantity`.

## Concorrência e finalização

- `expected_order_updated_at` deve ser conferido após locks e antes de qualquer
  mutação; prontidão, retirada ou entrada concorrente invalida a prévia;
- alteração concorrente somente do saldo físico não muda o delta, mas o lock do
  saldo garante valores anteriores/finais efetivos no resultado;
- retries usam a mesma chave e retornam o mesmo resultado, sem novo batch;
- mesma chave com payload diferente é rejeitada;
- a finalização atual exige zero pendência de retirada, mas permite backlog de
  entrada. Isso deve permanecer para possibilitar regularização histórica pelo
  NK-ORD-006; bloquear finalização por backlog seria outra decisão de negócio.

## Segurança e performance

- nenhum nome de RPC, tabela, UUID, saldo ou quantidade calculada pela IA vira
  autoridade;
- browser e Gemini não escolhem o alvo físico;
- wrappers continuam fixos e exigem usuário interno ativo;
- não há duas chamadas mutáveis nem retry automático com chave nova;
- catálogo e saldos são resolvidos em lote, com locks ordenados e sem N+1;
- o batch `INBOUND/MANUAL` mantém as Estatísticas coerentes como entrada externa,
  sem contar retirada e entrada duas vezes na mesma série.

## Matriz mínima da futura implementação

1. linha ITEM: delta parcial e total;
2. configuração e aliases: um único saldo físico;
3. `increment`, `set_total` e `mark_all` multilinha;
4. quantidade acima de `ready - picked` rejeitada antes da prévia;
5. backlog anterior preservado exatamente;
6. replay idêntico sem novo evento, batch ou movimento;
7. mesma chave/payload diferente rejeitado;
8. duas retiradas concorrentes;
9. retirada versus incremento/correção Safisa;
10. retirada versus regularização NK-ORD-006;
11. falha após pickup simulado ou durante movimento com rollback total;
12. saldo insuficiente, alvo inativo e alias inválido;
13. Pedido cancelado/finalizado e version conflict;
14. retorno de sucesso com releitura falha sem transformar commit em erro;
15. regressões da interface tradicional, Assistente, Estatísticas e Histórico.

## Plano proposto

1. **Migration/RPC:** extrair primitive privado de entrada, criar worker composto
   e substituir os workers canônicos mantendo wrappers/grants restritos.
2. **Testes PostgreSQL locais:** atomicidade, rollback, locks, idempotência,
   aliases, multilinha e concorrência real em duas conexões.
3. **Aplicação tradicional:** adaptar recibos/refresh e impedir redução ambígua.
4. **Assistente:** corrigir limite Safisa na prévia, manter confirmação HMAC e
   renderizar resultado conjunto.
5. **Regressão e revisão humana:** validar mobile/desktop e executar teste real
   somente mediante autorização específica posterior.

## Decisão

**MIGRATION_REQUIRED. Classificação C.** A implementação não deve começar como
simples mudança de aplicação. O ponto de parada é
`WAITING_ARCHITECTURE_REVIEW`.
