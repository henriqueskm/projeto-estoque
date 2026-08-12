# Objetivo atual

- **ID:** NK-ORD-007B
- **Título:** Aplicação da retirada + entrada automática no Estoque
- **Prioridade:** crítica
- **Fase:** aplicação
- **Estado:** `IMPLEMENTED / WAITING_HUMAN_VISUAL_REVIEW`
- **Branch:** `agent/atomic-pickup-stock-entry-app`
- **Base:** `origin/main` em `bd60909efacf7825c7a0284221535ac1eafaaebd`
- **Dependência:** MIG-ORD-007A `DB_REVIEW_APPROVED / NOT_APPLIED_REMOTE`.

## Contrato alinhado

A UI tradicional e a Assistente tratam toda nova retirada positiva como uma
operação composta:

`retirada do delta + entrada automática do mesmo delta no Estoque`

A disponibilidade operacional é exclusivamente:

`ready_quantity - picked_quantity`

Uma retirada não pode ser reduzida por esse fluxo. `set_total` igual ao valor
atual não cria operação, e `mark_all` considera somente linhas com delta pronto
positivo.

## Backlog histórico

O saldo antigo `picked_quantity - stocked_quantity` permanece separado e deve
ser regularizado pelo fluxo NK-ORD-006. A nova confirmação não absorve esse
backlog.

## Execução

A aplicação mantém uma única chamada mutável por confirmação:

- `set_supplier_order_item_picked_quantity_checked`, para linha;
- `mark_supplier_order_all_picked_checked`, para retirada total.

Não existe segunda chamada a `create_supplier_order_stock_entry`. A entrada
automática pertence à transação da MIG-ORD-007A e seus campos são reconhecidos
no receipt composto sem tornar respostas antigas obrigatoriamente inválidas.

## Segurança e validação

- confirmação somente por botão e proposalToken HMAC;
- `expected_updated_at` mantém precisão integral;
- mensagens textuais como “sim” não executam;
- erros de prontidão, redução e concorrência são sanitizados;
- nenhuma migration nova ou alteração de RPC foi criada;
- nenhuma escrita remota ou operação real foi executada.

## Gate restante

O Preview da Vercel é exclusivamente visual e não mutável enquanto a
MIG-ORD-007A não estiver aplicada no banco remoto. O teste operacional deve
aguardar uma implantação coordenada da migration e autorização humana própria.
