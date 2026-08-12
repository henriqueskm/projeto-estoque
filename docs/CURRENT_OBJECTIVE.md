# Objetivo atual

- **ID:** NK-ORD-007
- **Título:** Retirada com entrada automática no Estoque
- **Prioridade:** crítica
- **Fase:** validação operacional
- **Estado:** `WAITING_HUMAN_OPERATIONAL_TEST`
- **Migration:** `20260812023500_atomic_supplier_order_pickup_stock_entry.sql`
- **Aplicação:** `APPLIED_REMOTE / VERIFIED` em `isdjboconmwaqipjrjvp`
- **Aplicação web:** PR [#18](https://github.com/henriqueskm/projeto-estoque/pull/18) `MERGED / DEPLOYED`
- **Main implantada:** `86d3f3ad72ebe129ec2d2cc2ca5099bf9624e815`

## Contrato em produção

Toda nova retirada positiva de Pedido executa, na mesma transação PostgreSQL:

`retirada do delta + entrada automática do mesmo delta no Estoque`

A disponibilidade operacional continua sendo `ready_quantity - picked_quantity`.
O backlog histórico `picked_quantity - stocked_quantity` anterior ao rollout não
foi absorvido e permanece separado no fluxo explícito NK-ORD-006.

## Validação concluída

- migration remota presente e histórico local/remoto alinhado;
- primitive privado sem EXECUTE para `public`, `anon` ou `authenticated`;
- workers individual e total chamam o primitive físico compartilhado;
- wrappers públicos e entrada standalone de backlog preservados;
- fingerprints, contagens e totais operacionais permaneceram inalterados;
- PR #18 mesclado e deploy de produção da nova `main` aprovado;
- smoke test anônimo confirmou login interno, redirecionamentos autenticados e
  login Safisa.

## Gate restante

O usuário deve executar uma única retirada controlada de uma unidade pronta e
confirmar Pedido, Estoque e Histórico. O Codex não executou retirada, entrada ou
qualquer operação operacional durante o rollout.
