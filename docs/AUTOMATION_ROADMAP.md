# Roadmap autônomo do Negócios K

Estados e classificações seguem `AUTOMATION_RULES.md`. Implementação depende de auditoria A ou B; validação visual, teste operacional, migration e merge sempre exigem aprovação humana.

| ID | Objetivo | Tipo | Dependências | Classificação | Estado | Branch | PR | Risco | Validação humana | Próxima ação |
|---|---|---|---|---|---|---|---|---|---|---|
| NK-AUTO-001 | Estrutura de automação do repositório | Documentação | Nenhuma | A | DONE | `codex/automation-framework` | [#1](https://github.com/henriqueskm/projeto-estoque/pull/1) | Baixo | Aprovada | Mesclado em `main` |
| NK-OUT-001 | Auditoria da saída manual existente | Auditoria | NK-AUTO-001 | B | DONE | — | — | Alto | Não | Operação oficial aprovada para integração de aplicação |
| NK-OUT-002 | Implementação da saída manual pela Assistente | Aplicação | NK-OUT-001 B | B | DONE | `codex/assistant-manual-stock-output` | [#2](https://github.com/henriqueskm/projeto-estoque/pull/2) | Alto | Aprovada | Mesclado em `main` |
| NK-OUT-003 | Validação visual da saída manual | Validação | NK-OUT-002 | — | DONE | `codex/assistant-manual-stock-output` | [#2](https://github.com/henriqueskm/projeto-estoque/pull/2) | Médio | Aprovada | Fluxo validado visualmente |
| NK-OUT-004 | Teste operacional controlado da saída manual | Operação real | NK-OUT-003 | — | DONE | `codex/assistant-manual-stock-output` | [#2](https://github.com/henriqueskm/projeto-estoque/pull/2) | Crítico | Aprovada | Smoke test de produção aprovado sem duplicidade |
| NK-ASM-001 | Auditoria da montagem | Auditoria | NK-AUTO-001 | B | DONE | — | — | Alto | Não | Integração de aplicação pode ser planejada |
| NK-ASM-002 | Implementação da montagem pela Assistente | Aplicação | NK-ASM-001 B | B | DONE | `agent/assistant-assembly` | [#3](https://github.com/henriqueskm/projeto-estoque/pull/3) | Crítico | Aprovada | PR #3 mesclado; teste operacional e smoke test aprovados sem duplicidade ou efeito colateral |
| NK-SAF-001 | Auditoria e especificação do Portal da Safisa — prioridade alta do piloto | Auditoria e arquitetura | NK-AUTO-001; Pedidos existentes | C | WAITING_HUMAN_REVIEW | `agent/safisa-portal-audit` | [#4](https://github.com/henriqueskm/projeto-estoque/pull/4) | Crítico | Decisões de domínio aprovadas | Revisar e aprovar o desenho documental da MIG-SAF-001 antes de criar SQL |
| NK-DIS-001 | Auditoria da desmontagem | Auditoria | NK-AUTO-001 | B | DONE | — | — | Alto | Não | Integração de aplicação pode ser planejada |
| NK-DIS-002 | Implementação da desmontagem pela Assistente | Aplicação | NK-DIS-001 B | B | READY | A definir | Pendente | Crítico | Visual e operacional | Criar branch própria após priorização |
| NK-ORD-001 | Auditoria da criação e edição de Pedido | Auditoria | NK-AUTO-001 | A/B/D por subfluxo | DONE | — | — | Alto | Não | Resolver decisões de rascunho, negociação e cancelamento |
| NK-ORD-002 | Criação de Pedido em rascunho pela Assistente | Aplicação | NK-ORD-001 | D | BLOCKED_BUSINESS_RULE | A definir | Pendente | Alto | Regra e possível migration | Definir o que é rascunho e a unicidade da negociação |
| NK-ORD-003 | Edição de Pedido em rascunho | Aplicação | NK-ORD-001 | D | BLOCKED_BUSINESS_RULE | A definir | Pendente | Alto | Regra e possível migration | Definir ciclo de vida do rascunho; edição do Pedido ativo é B |
| NK-ORD-004 | Finalização de Pedido | Aplicação | NK-ORD-001 | B | READY | A definir | Pendente | Crítico | Visual e operacional | Integrar RPC existente em branch própria |
| NK-ORD-005 | Cancelamento de Pedido | Aplicação | NK-ORD-001 | D | BLOCKED_BUSINESS_RULE | A definir | Pendente | Crítico | Motivo e modalidade | Definir cancelamento total versus saldo restante e texto de auditoria |
| NK-QA-001 | Regressão completa das ações operacionais da Assistente | QA | Ações implementadas | Pendente | READY | A definir | Pendente | Alto | Visual | Planejar depois das ações |
| NK-PROD-001 | Smoke tests em produção | Operação real | NK-QA-001 | — | BLOCKED_OPERATIONAL_TEST | — | — | Crítico | Obrigatória | Solicitar autorização específica |

## Regras de dependência

- Implementação funcional só começa após auditoria classificada A ou B.
- Classificação C registra necessidade de migration/RPC e bloqueia desenvolvimento.
- Classificação D registra decisão de negócio e bloqueia desenvolvimento.
- PR não autoriza merge.
- Testes com escrita real nunca fazem parte da validação autônoma.
