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
| DEC-OUT-004 | NK-OUT-004 | A saída pela Assistente precisará de teste real controlado depois da validação visual. | Operações reais alteram saldo e auditoria. | Autorizar teste específico ou adiar. | Autorizar somente com código, quantidade, baseline e critérios de verificação definidos. | Crítico | Aprovar um roteiro operacional futuro. |

## Validações visuais aguardando usuário

| ID | Objetivo | Problema | Evidência | Opções | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|---|---|
| DEC-OUT-003 | NK-OUT-003 | Uma futura interface de saída precisa de validação autenticada em mobile e desktop. | A validação exige sessão e julgamento visual humano. | Aprovar, solicitar ajuste ou rejeitar. | Validar antes de qualquer teste real. | Médio | Revisar a PR/branch após implementação. |

## Merges aguardando aprovação

| ID | Objetivo | Problema | Evidência | Opções | Recomendação | Risco | Ação do usuário |
|---|---|---|---|---|---|---|---|
| DEC-AUTO-MERGE | NK-AUTO-001 | O framework será publicado em branch, sem merge automático. | Política de autonomia nível 3. | Revisar e fazer merge ou pedir ajustes. | Revisar o PR documental. | Baixo | Aprovar o merge em `main`. |
| DEC-OUT-MERGE | NK-OUT-002 | A saída manual está publicada em branch, sem merge automático. | Commit `9bc68bee216c8f5f9e17db1d2d591e5cffc40dbb` passou nas validações locais. | Revisar e fazer merge ou pedir ajustes. | Validar visualmente antes do merge. | Alto | Revisar a branch funcional. |
