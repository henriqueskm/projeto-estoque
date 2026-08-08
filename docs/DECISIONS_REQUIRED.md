# Decisões e aprovações necessárias

Este documento registra bloqueios que exigem ação humana. Itens concluídos permanecem registrados com seu resultado.

## Decisões pendentes

| ID | Objetivo | Problema | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|
| DEC-ORD-001 | NK-ORD-002/NK-ORD-003 | O schema atual não possui estado `DRAFT`; criar Pedido já cria um Pedido operacional PENDING. | Definir explicitamente o ciclo de vida antes de codificar; um estado próprio provavelmente exige migration. | Alto | Escolher a semântica de rascunho. |
| DEC-ORD-002 | NK-ORD-002/NK-ORD-003 | `negotiation_number` não é único e duplicatas tornam resolução exata ambígua. | Definir a regra comercial antes da criação pela Assistente. | Alto | Escolher a política de duplicidade. |
| DEC-ORD-003 | NK-ORD-005 | Cancelamento total e de saldo restante são operações distintas e o banco aceita nota nula. | Definir modalidade e auditoria; a Assistente não deve inventar motivo. | Crítico | Aprovar regra de cancelamento e texto de auditoria. |

## Migrations Safisa concluídas

| ID | Objetivo | Escopo | Estado |
|---|---|---|---|
| MIG-SAF-001 | NK-SAF-001 | Membership Safisa; autorização explícita de Pedidos; `ready_quantity`; auditoria/idempotência; RLS e RPCs fechadas. | Concluída, mesclada e aplicada remotamente |
| MIG-SAF-003 | NK-SAF-001 | Compatibilidade incremental e irreversível para Pedidos legados. | Concluída, mesclada e aplicada remotamente |
| MIG-BASE-001 | Reprodutibilidade local | Baseline atual fora das migrations, catálogo referencial determinístico e restaurador estritamente local. | Concluído e mesclado no PR #7; uso exclusivamente local |

### Decisões concluídas de reprodutibilidade

- MIG-HIST-002 foi abandonada por decisão humana devido ao custo e risco de remapear 91 identidades;
- migrations históricas permanecem preservadas e não serão reescritas;
- o baseline é somente para reconstrução e testes locais;
- migrations futuras permanecem incrementais e normais.

## RPCs Safisa aplicadas

- RPCs fixas de leitura do portal;
- incremento idempotente de quantidade pronta;
- correção absoluta com `expected_updated_at`;
- validação de prontidão nas RPCs internas de retirada;
- proteções de prontidão em edição e cancelamento.

As RPCs foram aplicadas remotamente pelas MIG-SAF-001 e MIG-SAF-003 sob
protocolo controlado. Esta branch consome apenas os wrappers públicos já
existentes e não altera banco, Auth ou RPCs.

### Contrato documental especificado para MIG-SAF-001

- tabelas: membros do portal, autorizações de Pedido e ledger idempotente/auditável;
- coluna: `supplier_order_items.ready_quantity`, com backfill igual a `picked_quantity`;
- constraints: prontidão não negativa, nunca abaixo do retirado e nunca acima do total não cancelado;
- índices: associação por usuário, autorização por Pedido, pendência pronta e eventos por Pedido/linha/data;
- RLS/grants: nenhuma escrita direta; `anon`/`PUBLIC` sem acesso; contas Safisa somente nas RPCs próprias;
- RPCs: leitura paginada, incremento de prontidão e correção absoluta, todas com contratos fixos;
- endurecimento: retirada limitada ao pronto, edição preservando prontidão e cancelamento apenas do saldo não pronto;
- implantação: migration revisada, testes SQL locais, aplicação remota autorizada, frontend, validação concorrente e piloto.

## Testes operacionais Safisa aguardando autorização

O próximo teste operacional depende de criar administrativamente uma conta
Safisa e publicar explicitamente um Pedido; ambos exigem autorização específica.

## Validações visuais aguardando usuário

O Portal Safisa MVP está implementado na branch `agent/safisa-portal-ui` e
aguarda revisão humana do [PR #9](https://github.com/henriqueskm/projeto-estoque/pull/9)
em draft antes de merge, provisionamento ou piloto.

## Merges aguardando aprovação

MIG-SAF-001 e MIG-SAF-003 foram mescladas e aplicadas. O Portal Safisa MVP
aguarda revisão humana; merge da interface ainda não está autorizado.

## Decisões concluídas

| ID | Objetivo | Resultado |
|---|---|---|
| DEC-AUTO-MERGE | NK-AUTO-001 | PR #1 revisado e mesclado em `main`. |
| DEC-OUT-003 | NK-OUT-003 | Saída manual validada visualmente em sessão autenticada. |
| DEC-OUT-004 | NK-OUT-004 | Teste operacional e smoke test de produção aprovados sem duplicidade. |
| DEC-OUT-MERGE | NK-OUT-002 | PR #2 revisado e mesclado em `main`. |
| DEC-ASM-003 | NK-ASM-002 | Montagem validada visualmente. |
| DEC-ASM-004 | NK-ASM-002 | Teste operacional aprovado: uma montagem, sem replay, duplicidade ou efeito colateral. |
| DEC-ASM-MERGE | NK-ASM-002 | PR #3 revisado e mesclado em `main`. |
| DEC-SAF-001 | NK-SAF-001 | Contas individuais, provisionamento administrativo, membership próprio e ativação/desativação individual; conta Safisa não é perfil interno. |
| DEC-SAF-002 | NK-SAF-001 | Signup público será desabilitado futuramente em alteração remota separada; contas serão criadas administrativamente. |
| DEC-SAF-003 | NK-SAF-001 | **SUPERSEDED por DEC-SAF-010.** Publicação e revogação explícitas foram preservadas apenas como histórico/compatibilidade. |
| DEC-SAF-004 | NK-SAF-001 | Incremento atômico/idempotente; correção absoluta com justificativa, confirmação, versão e auditoria, inclusive por usuário interno autorizado. |
| DEC-SAF-005 | NK-SAF-001 | Ação “Retirar tudo que está pronto”, limitada ao pronto ainda não retirado e validada transacionalmente. |
| DEC-SAF-006 | NK-SAF-001 | Cancelamento silencioso de prontidão bloqueado; somente saldo ainda não pronto pode ser cancelado separadamente. |
| DEC-SAF-007 | NK-SAF-001 | Pedidos encerrados ficam somente leitura enquanto autorizados; revogação remove acesso sem apagar dados ou auditoria. |
| DEC-SAF-008 | NK-SAF-001 | Portal em `/safisa` no mesmo deploy, com layout, navegação, guards e autorização server-side/banco separados. |
| DEC-SAF-009 | MIG-SAF-003 | **SUPERSEDED por DEC-SAF-010.** A transição legado foi necessária para a implantação inicial e permanece como histórico da decisão. |
| DEC-SAF-010 | NK-SAF-003 | Safisa é o único fornecedor: todo `supplier_order` é automaticamente Safisa-managed e visível a memberships ativas enquanto tiver quantidade pendente de retirada. |
| DEC-SAF-011 | NK-SAF-003 | “Excluir pedido” significa cancelamento lógico auditado, nunca `DELETE` físico; cancelados saem das listas ativas e permanecem no histórico. |
