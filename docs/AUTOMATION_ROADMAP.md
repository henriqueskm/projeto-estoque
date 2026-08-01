# Roadmap autônomo do Negócios K

Estados e classificações seguem `AUTOMATION_RULES.md`. Implementação depende de auditoria A ou B; validação visual, teste operacional, migration e merge sempre exigem aprovação humana.

| ID | Objetivo | Tipo | Dependências | Classificação | Estado | Branch | PR | Risco | Validação humana | Próxima ação |
|---|---|---|---|---|---|---|---|---|---|---|
| NK-AUTO-001 | Estrutura de automação do repositório | Documentação | Nenhuma | A | IMPLEMENTING | `codex/automation-framework` | Pendente | Baixo | Revisão e merge | Validar e publicar a branch |
| NK-OUT-001 | Auditoria da saída manual existente | Auditoria | NK-AUTO-001 | Pendente | READY | — | — | Alto | Não | Auditar operação oficial |
| NK-OUT-002 | Implementação da saída manual pela Assistente | Aplicação | NK-OUT-001 A/B | Pendente | READY | `codex/assistant-manual-stock-output` | Pendente | Alto | Revisão de código | Implementar somente se A/B |
| NK-OUT-003 | Validação visual da saída manual | Validação | NK-OUT-002 | — | BLOCKED_VISUAL_VALIDATION | — | — | Médio | Obrigatória | Usuário validar autenticado |
| NK-OUT-004 | Teste operacional controlado da saída manual | Operação real | NK-OUT-003 | — | BLOCKED_OPERATIONAL_TEST | — | — | Crítico | Obrigatória | Solicitar autorização específica |
| NK-ASM-001 | Auditoria da montagem | Auditoria | NK-AUTO-001 | Pendente | READY | — | — | Alto | Não | Auditar infraestrutura existente |
| NK-ASM-002 | Implementação da montagem pela Assistente | Aplicação | NK-ASM-001 A/B | Pendente | READY | A definir | Pendente | Crítico | Visual e operacional | Aguardar auditoria |
| NK-DIS-001 | Auditoria da desmontagem | Auditoria | NK-AUTO-001 | Pendente | READY | — | — | Alto | Não | Auditar infraestrutura existente |
| NK-DIS-002 | Implementação da desmontagem pela Assistente | Aplicação | NK-DIS-001 A/B | Pendente | READY | A definir | Pendente | Crítico | Visual e operacional | Aguardar auditoria |
| NK-ORD-001 | Auditoria da criação e edição de Pedido | Auditoria | NK-AUTO-001 | Pendente | READY | — | — | Alto | Não | Classificar cada subfluxo |
| NK-ORD-002 | Criação de Pedido em rascunho pela Assistente | Aplicação | NK-ORD-001 A/B | Pendente | READY | A definir | Pendente | Alto | Visual e operacional | Aguardar auditoria |
| NK-ORD-003 | Edição de Pedido em rascunho | Aplicação | NK-ORD-001 A/B | Pendente | READY | A definir | Pendente | Alto | Visual e operacional | Aguardar auditoria |
| NK-ORD-004 | Finalização de Pedido | Aplicação | NK-ORD-001 A/B | Pendente | READY | A definir | Pendente | Crítico | Visual e operacional | Aguardar auditoria |
| NK-ORD-005 | Cancelamento de Pedido | Aplicação | NK-ORD-001 A/B | Pendente | READY | A definir | Pendente | Crítico | Visual e operacional | Aguardar auditoria |
| NK-QA-001 | Regressão completa das ações operacionais da Assistente | QA | Ações implementadas | Pendente | READY | A definir | Pendente | Alto | Visual | Planejar depois das ações |
| NK-PROD-001 | Smoke tests em produção | Operação real | NK-QA-001 | — | BLOCKED_OPERATIONAL_TEST | — | — | Crítico | Obrigatória | Solicitar autorização específica |

## Regras de dependência

- Implementação funcional só começa após auditoria classificada A ou B.
- Classificação C registra necessidade de migration/RPC e bloqueia desenvolvimento.
- Classificação D registra decisão de negócio e bloqueia desenvolvimento.
- PR não autoriza merge.
- Testes com escrita real nunca fazem parte da validação autônoma.
