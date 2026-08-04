# Decisões e aprovações necessárias

Este documento registra bloqueios que exigem ação humana. Itens concluídos permanecem registrados com seu resultado.

## Decisões pendentes

| ID | Objetivo | Problema | Evidência | Opções | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|---|---|
| DEC-ORD-001 | NK-ORD-002/NK-ORD-003 | O schema atual não possui estado `DRAFT`; criar Pedido já cria um Pedido operacional PENDING. | `supplier_orders` deriva status das quantidades e não possui coluna de rascunho. | Tratar PENDING como rascunho; criar ciclo de rascunho próprio; remover objetivo. | Definir explicitamente o ciclo de vida antes de codificar; um estado próprio provavelmente exige migration. | Alto | Escolher a semântica de rascunho. |
| DEC-ORD-002 | NK-ORD-002/NK-ORD-003 | `negotiation_number` possui índice, mas não unicidade; duplicatas tornam resolução exata ambígua. | Schema permite duas negociações com o mesmo texto. | Permitir e sempre esclarecer; proibir duplicata ativa; unicidade global. | Definir a regra comercial antes da criação pela Assistente. | Alto | Escolher a política de duplicidade. |
| DEC-ORD-003 | NK-ORD-005 | Cancelamento total e de saldo restante são operações distintas e a interface exige motivo, mas o banco aceita nota nula. | RPCs `cancel_supplier_order` e `cancel_supplier_order_remaining` têm regras diferentes. | Exigir texto do usuário; usar descrição fixa server-side; não habilitar no chat. | Definir modalidade e auditoria; a Assistente não deve inventar motivo. | Crítico | Aprovar regra de cancelamento e texto de auditoria. |

## Migrations aguardando aprovação

Nenhuma migration proposta.

## Alterações de RPC aguardando aprovação

Nenhuma alteração de RPC proposta.

## Regras de negócio ambíguas

As ambiguidades de rascunho, duplicidade da negociação e cancelamento estão registradas em DEC-ORD-001, DEC-ORD-002 e DEC-ORD-003 acima. Nenhuma implementação desses objetivos deve começar antes das decisões.

## Testes operacionais aguardando autorização

| ID | Objetivo | Problema | Evidência | Opções | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|---|---|
| DEC-ASM-004 | NK-ASM-002 | A montagem pela Assistente precisará de teste real controlado depois da validação visual. | Operações reais consomem Servo e Kit e aumentam o saldo montado. | Autorizar teste específico ou adiar. | Autorizar somente com Cód., quantidade, baseline e critérios de verificação definidos. | Crítico | Aprovar um roteiro operacional futuro. |

## Validações visuais aguardando usuário

| ID | Objetivo | Problema | Evidência | Opções | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|---|---|
| DEC-ASM-003 | NK-ASM-002 | A prévia e o resultado de montagem precisam de validação autenticada em mobile e desktop. | A validação exige sessão e julgamento visual humano. | Aprovar, solicitar ajuste ou rejeitar. | Validar sem clicar em Confirmar montagem. | Médio | Revisar o PR draft após implementação. |

## Merges aguardando aprovação

| ID | Objetivo | Problema | Evidência | Opções | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|---|---|
| DEC-ASM-MERGE | NK-ASM-002 | A montagem será publicada em branch, sem merge automático. | Política de autonomia nível 3 e risco operacional crítico. | Revisar e fazer merge ou pedir ajustes. | Validar visualmente antes do merge. | Crítico | Revisar o PR draft funcional. |

## Decisões concluídas

| ID | Objetivo | Resultado |
|---|---|---|
| DEC-AUTO-MERGE | NK-AUTO-001 | PR #1 revisado e mesclado em `main`. |
| DEC-OUT-003 | NK-OUT-003 | Saída manual validada visualmente em sessão autenticada. |
| DEC-OUT-004 | NK-OUT-004 | Teste operacional e smoke test de produção aprovados sem duplicidade. |
| DEC-OUT-MERGE | NK-OUT-002 | PR #2 revisado e mesclado em `main`. |
