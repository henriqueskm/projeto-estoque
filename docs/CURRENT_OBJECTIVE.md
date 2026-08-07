# Objetivo atual

- **ID:** MIG-SAF-001
- **Título:** Fundação de banco do Portal da Safisa
- **Prioridade:** alta para o piloto comercial
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** C — migration escrita localmente; aplicação remota exige autorização humana separada
- **Branch de execução:** `agent/safisa-portal-migration`
- **Pull request:** [#5](https://github.com/henriqueskm/projeto-estoque/pull/5) — draft
- **Base integrada:** `origin/main` contendo o merge `883ffa6de5024b8f2d27b1b0be2c047dacd7ae64`
- **Dependências:** NK-SAF-001 e MIG-BASE-001 concluídas; decisões DEC-SAF-001 a DEC-SAF-008 aprovadas

## Baseline aprovado

- o PR #7 foi mesclado na main;
- o baseline reconstrói localmente o schema e o catálogo atual sem executar a cadeia histórica antiga;
- `MIG-HIST-002` permanece `ABANDONED_BY_DECISION`;
- migrations históricas permanecem intactas;
- migrations futuras continuam incrementais após o cutoff `20260729001230`;
- o baseline e `migration repair` remoto nunca serão aplicados ao projeto remoto.

## MIG-SAF-001 escrita, não aplicada remotamente

A migration `supabase/migrations/20260804044500_safisa_portal_foundation.sql`
materializa o contrato aprovado: membership, autorização explícita de Pedidos,
`ready_quantity`, ledger de auditoria/idempotência, constraints, índices, RLS,
grants/revokes, RPCs fixas, backfill sem publicação automática e endurecimento
transacional de retirada, edição e cancelamento.

O timestamp `20260804044500` já é superior ao cutoff e não será renomeado.

## Escopo proibido

- aplicar migration ou `migration repair` no remoto;
- alterar RPC, RLS, grants, Auth ou configuração remota;
- implementar portal ou alertas;
- criar contas Safisa;
- publicar ou alterar Pedidos reais;
- executar operação real de Estoque;
- fazer `db push` ou merge.

## Execução atual

- **Última ação:** baseline aprovado e mesclado; branch do PR #5 integrada à main atual.
- **Próximo passo:** validar MIG-SAF-001 dinamicamente somente em Supabase Local descartável.
- **Decisões concluídas:** DEC-SAF-001 a DEC-SAF-008.
- **Aprovação ainda pendente:** revisão humana após os testes locais; aplicação remota continua separada e não autorizada.

**Ponto de parada:** `WAITING_HUMAN_REVIEW`.
