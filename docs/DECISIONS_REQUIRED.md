# Decisões e aprovações necessárias

Este documento registra bloqueios que exigem ação humana. Itens concluídos permanecem registrados com seu resultado.

## Decisões pendentes

| ID | Objetivo | Problema | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|
| DEC-ORD-001 | NK-ORD-002/NK-ORD-003 | O schema atual não possui estado `DRAFT`; criar Pedido já cria um Pedido operacional PENDING. | Definir explicitamente o ciclo de vida antes de codificar; um estado próprio provavelmente exige migration. | Alto | Escolher a semântica de rascunho. |
| DEC-ORD-002 | NK-ORD-002/NK-ORD-003 | `negotiation_number` não é único e duplicatas tornam resolução exata ambígua. | Definir a regra comercial antes da criação pela Assistente. | Alto | Escolher a política de duplicidade. |
| DEC-ORD-003 | NK-ORD-005 | Cancelamento total e de saldo restante são operações distintas e o banco aceita nota nula. | Definir modalidade e auditoria; a Assistente não deve inventar motivo. | Crítico | Aprovar regra de cancelamento e texto de auditoria. |

## Migrations aguardando aprovação

| ID | Objetivo | Escopo | Estado |
|---|---|---|---|
| MIG-SAF-001 | NK-SAF-001 | Membership Safisa; autorização explícita de Pedidos; `ready_quantity`; ledger de auditoria/idempotência; constraints e índices; RLS, grants/revokes e RPCs fechadas; backfill sem publicação; endurecimento de retirada, edição e cancelamento; testes de isolamento e concorrência. | Especificada; criação ainda não autorizada |
| MIG-HIST-001 | Reprodutibilidade histórica | Migration-ponte anterior a `20260718175621`, com remapeamento de 19 identidades, reserva de 5 UUIDs, no-op pós-correção e rollback integral. | Auditoria concluída; SQL não autorizado; bloqueia MIG-SAF-001 |

### Decisões pendentes de MIG-HIST-001

- aprovar a combinação de tabela temporária de mapeamento e FKs temporariamente diferíveis;
- aprovar timestamp e nome da migration-ponte entre `20260718134339` e `20260718175621`;
- aprovar a lista fechada de FKs e os locks `NOWAIT`;
- aprovar o no-op estrito para estado pós-correção completo;
- autorizar futuramente, em tarefa separada, a avaliação de `migration repair --status applied` no remoto;
- autorizar rebase e novos testes do PR #5 somente após a ponte ser implementada e revisada.

## Alterações de RPC aguardando aprovação

- RPCs fixas de leitura do portal;
- incremento idempotente de quantidade pronta;
- correção absoluta com `expected_updated_at`;
- validação de prontidão nas RPCs internas de retirada;
- proteções de prontidão em edição e cancelamento.

Nenhuma alteração foi implementada.

### Contrato documental especificado para MIG-SAF-001

- tabelas: membros do portal, autorizações de Pedido e ledger idempotente/auditável;
- coluna: `supplier_order_items.ready_quantity`, com backfill igual a `picked_quantity`;
- constraints: prontidão não negativa, nunca abaixo do retirado e nunca acima do total não cancelado;
- índices: associação por usuário, autorização por Pedido, pendência pronta e eventos por Pedido/linha/data;
- RLS/grants: nenhuma escrita direta; `anon`/`PUBLIC` sem acesso; contas Safisa somente nas RPCs próprias;
- RPCs: leitura paginada, incremento de prontidão e correção absoluta, todas com contratos fixos;
- endurecimento: retirada limitada ao pronto, edição preservando prontidão e cancelamento apenas do saldo não pronto;
- implantação: migration revisada, testes SQL locais, aplicação remota autorizada, frontend, validação concorrente e piloto.

## Testes operacionais aguardando autorização

Nenhum teste operacional Safisa deve ser preparado antes da aprovação da arquitetura, migration e interface.

## Validações visuais aguardando usuário

Nenhuma interface Safisa foi implementada. A validação visual será definida somente depois das fases de banco e aplicação.

## Merges aguardando aprovação

Nenhum merge está preparado para NK-SAF-001.

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
| DEC-SAF-003 | NK-SAF-001 | Publicação e revogação explícitas por Pedido, sem publicação automática e sem apagar auditoria. |
| DEC-SAF-004 | NK-SAF-001 | Incremento atômico/idempotente; correção absoluta com justificativa, confirmação, versão e auditoria, inclusive por usuário interno autorizado. |
| DEC-SAF-005 | NK-SAF-001 | Ação “Retirar tudo que está pronto”, limitada ao pronto ainda não retirado e validada transacionalmente. |
| DEC-SAF-006 | NK-SAF-001 | Cancelamento silencioso de prontidão bloqueado; somente saldo ainda não pronto pode ser cancelado separadamente. |
| DEC-SAF-007 | NK-SAF-001 | Pedidos encerrados ficam somente leitura enquanto autorizados; revogação remove acesso sem apagar dados ou auditoria. |
| DEC-SAF-008 | NK-SAF-001 | Portal em `/safisa` no mesmo deploy, com layout, navegação, guards e autorização server-side/banco separados. |
