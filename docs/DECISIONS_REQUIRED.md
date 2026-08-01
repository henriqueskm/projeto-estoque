# Decisões e aprovações necessárias

Este documento registra bloqueios que exigem ação humana. Itens concluídos permanecem registrados com seu resultado.

## Decisões pendentes

Nenhuma decisão de negócio identificada até o momento.

## Migrations aguardando aprovação

Nenhuma migration proposta.

## Alterações de RPC aguardando aprovação

Nenhuma alteração de RPC proposta.

## Regras de negócio ambíguas

Nenhuma ambiguidade registrada até o momento.

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
