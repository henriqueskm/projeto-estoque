# Objetivo atual

- **ID:** MIG-ORD-007A
- **Título:** Retirada + entrada atômica no Estoque
- **Prioridade:** crítica
- **Fase:** migration / contrato de banco
- **Estado:** `WAITING_DB_REVIEW`
- **Classificação:** C — migration/RPC implementada somente localmente
- **Branch:** `agent/atomic-pickup-stock-entry`
- **Base:** `origin/main` em `393f989d85a83d0051172d37fffee7e96263b819`
- **Arquitetura:** NK-ORD-007 `ARCHITECTURE_APPROVED`, PR #16 mesclado.

## Migration

`20260812023500_atomic_supplier_order_pickup_stock_entry.sql`

SHA-256:
`040f6ec6aa50ffd7062f20c2229bd098194662fc245fceff456c95428c39c343`

A migration não foi aplicada remotamente.

## Contrato implementado

Toda nova retirada positiva cria, na mesma transação PostgreSQL, a entrada no
Estoque de exatamente:

`new_picked_quantity - previous_picked_quantity`

O teto operacional permanece:

`ready_quantity - picked_quantity`

O worker rejeita redução do total retirado. Quando o alvo é igual ao valor
atual, mantém o resultado idempotente sem criar batch ou entrada vazia.

## Backlog histórico

O backlog anterior não é absorvido. Se uma linha tinha `picked = 3` e
`stocked = 1`, uma nova retirada de 1 resulta em `picked = 4` e `stocked = 2`.
As 2 unidades anteriores continuam disponíveis para regularização explícita
pelo NK-ORD-006.

## Primitive físico compartilhado

Foi criado `private.apply_supplier_order_stock_entry`, `SECURITY INVOKER`, com
`search_path = ''` e sem grant público. Ele concentra:

- normalização e validação das linhas;
- resolução server-side de ITEM e configuração comercial;
- chamada a `private.stock_inbound_lines`;
- criação de um batch `INBOUND/MANUAL`;
- inbound lines, movimentos e saldos;
- `supplier_order_stock_entries` e linhas de vínculo;
- incremento de `stocked_quantity`.

O worker standalone `private.create_supplier_order_stock_entry` foi refatorado
para reutilizá-lo e continua sendo a operação do NK-ORD-006.

## Retirada individual e total

`private.set_supplier_order_item_picked_quantity` agora:

- preserva o request idempotente e o evento `PICKED_QUANTITY_CHANGED`;
- bloqueia Pedido e linha;
- rejeita Pedido cancelado, redução e alvo acima de `ready_quantity`;
- calcula somente o delta positivo novo;
- atualiza pickup e entrada dentro da mesma transação;
- incorpora os IDs verdadeiros da entrada e do batch ao receipt/evento.

`private.mark_supplier_order_all_picked` agora:

- bloqueia Pedido e linhas em UUID crescente;
- usa `ready_quantity - picked_quantity` por linha;
- ignora linhas sem delta;
- cria um único batch e uma única entrada por Pedido;
- preserva a atribuição individual nas stock-entry lines;
- consolida o movimento físico quando aliases convergem para uma configuração.

As assinaturas públicas normais e checked foram preservadas. Os wrappers
checked continuam validando `expected_order_updated_at` integral antes de
delegar aos workers canônicos e recebem os novos campos do receipt.

## Idempotência e auditoria

Existe uma fronteira externa por usuário/chave:

- retirada individual: `PICKED_QUANTITY_CHANGED`;
- retirada total: `ALL_ITEMS_MARKED_PICKED`;
- entrada standalone: `STOCK_ENTRY_CREATED`.

A operação composta não cria um segundo evento `STOCK_ENTRY_CREATED` com a
mesma chave. A entrada automática permanece auditável pela entrada vinculada,
suas linhas, batch, inbound lines, movimentos físicos e dados incorporados ao
resultado do evento primário. Replay idêntico não cria novos registros; mesma
chave com payload diferente é rejeitada.

## Locks e atomicidade

A ordem preservada é:

1. advisory lock de usuário/idempotência;
2. Pedido;
3. linhas do Pedido em UUID crescente;
4. códigos, configurações e itens físicos em ordem determinística;
5. saldos de configurações em UUID crescente;
6. saldos de itens em UUID crescente.

Falhas durante estoque ou durante a gravação do evento revertem retirada,
entrada, batch, movimentos e saldos integralmente.

## Validação local

- duas reconstruções independentes do baseline + migrations;
- `SchemaSignature`: `888958aa8d3058dfa0ace13ffe17a02a` em ambas;
- `CatalogSignature`: `9e010282ce86835cb5973da9b50a5d52` em ambas;
- testes A–M aprovados para ITEM, backlog, Safisa, redução, mark-all, aliases,
  replay, conflito, rollback, concorrência, standalone, finalização e wrappers
  checked;
- três concorrências reais com duas conexões PostgreSQL;
- regressão Safisa automática atualizada para o contrato atômico.

## Fora do escopo

- UI tradicional e Assistente ainda não foram alteradas;
- nenhuma migration foi aplicada remotamente;
- nenhum `db push`, retirada real, entrada real ou alteração de dados remotos;
- merge e marcação Ready permanecem proibidos.

**Ponto de parada:** `WAITING_DB_REVIEW`.
