# Decisões e aprovações necessárias

Este documento registra bloqueios que exigem ação humana. Itens concluídos permanecem registrados com seu resultado.

## Decisões pendentes

| ID | Objetivo | Problema | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|
| DEC-SAF-001 | NK-SAF-001 | Novos perfis nascem ativos e não existe tipo de conta. | Adotar default deny; contas Safisa usam membership próprio e não são perfis internos ativos. | Crítico | Aprovar o modelo de provisionamento e ativação. |
| DEC-SAF-002 | NK-SAF-001 | Cadastro por e-mail está habilitado no Supabase Auth. | Desabilitar signup público e provisionar contas por fluxo administrativo controlado. | Crítico | Aprovar ou rejeitar a alteração de configuração. |
| DEC-SAF-003 | NK-SAF-001 | “Pedidos autorizados” ainda não possui regra de publicação. | Criar autorização explícita por Pedido; backfill inicial sem publicação automática. | Alto | Aprovar publicação/revogação explícita. |
| DEC-SAF-004 | NK-SAF-001 | Correção absoluta pode reduzir ou substituir um total informado. | Exigir conflito por versão e justificativa curta para toda correção; incremento continua sem motivo. | Alto | Definir justificativa obrigatória e quem corrige. |
| DEC-SAF-005 | NK-SAF-001 | “Marcar tudo como retirado” hoje ignora prontidão. | Retirar somente as unidades prontas; nunca marcar unidades ainda não prontas. | Crítico | Aprovar a nova semântica ou exigir bloqueio até tudo estar pronto. |
| DEC-SAF-006 | NK-SAF-001 | Cancelar saldo pode colidir com unidades prontas ainda não retiradas. | Bloquear cancelamento dessas unidades até decisão explícita; nunca reduzir prontidão silenciosamente. | Crítico | Definir tratamento comercial do saldo pronto. |
| DEC-SAF-007 | NK-SAF-001 | Falta regra para Pedidos finalizados, cancelados ou revogados no portal. | Manter consulta histórica somente enquanto autorizado; bloquear qualquer atualização encerrada. | Alto | Aprovar visibilidade e retenção histórica. |
| DEC-SAF-008 | NK-SAF-001 | Endereço e implantação do piloto não foram definidos. | Usar `/safisa` no mesmo deploy, com layout e guard separados. | Médio | Confirmar a URL/arquitetura do piloto. |
| DEC-ORD-001 | NK-ORD-002/NK-ORD-003 | O schema atual não possui estado `DRAFT`; criar Pedido já cria um Pedido operacional PENDING. | Definir explicitamente o ciclo de vida antes de codificar; um estado próprio provavelmente exige migration. | Alto | Escolher a semântica de rascunho. |
| DEC-ORD-002 | NK-ORD-002/NK-ORD-003 | `negotiation_number` não é único e duplicatas tornam resolução exata ambígua. | Definir a regra comercial antes da criação pela Assistente. | Alto | Escolher a política de duplicidade. |
| DEC-ORD-003 | NK-ORD-005 | Cancelamento total e de saldo restante são operações distintas e o banco aceita nota nula. | Definir modalidade e auditoria; a Assistente não deve inventar motivo. | Crítico | Aprovar regra de cancelamento e texto de auditoria. |

## Migrations aguardando aprovação

| ID | Objetivo | Escopo | Estado |
|---|---|---|---|
| MIG-SAF-001 | NK-SAF-001 | Membership Safisa, autorização de Pedidos, quantidade pronta, backfill, constraints, auditoria, índices, RLS/RPCs e endurecimento das operações atuais. | Proposta; não criada |

## Alterações de RPC aguardando aprovação

- RPCs fixas de leitura do portal;
- incremento idempotente de quantidade pronta;
- correção absoluta com `expected_updated_at`;
- validação de prontidão nas RPCs internas de retirada;
- proteções de prontidão em edição e cancelamento.

Nenhuma alteração foi implementada.

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
