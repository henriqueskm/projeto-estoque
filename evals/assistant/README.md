# Laboratório de linguagem natural da Assistente NK

O corpus é determinístico, versionado e executa apenas roteadores, parsers e contratos puros com fixtures locais. Nenhuma avaliação chama RPC mutável, Supabase remoto ou confirma uma proposta. Os resultados de execução ficam ignorados em `artifacts/assistant-eval/`; o baseline compacto da primeira rodada está versionado em `baselines/`.

## Comandos

- `npm run eval:assistant:quick`: corpus crítico sem gravar artefatos.
- `npm run eval:assistant`: corpus completo e relatório local ignorado em `artifacts/assistant-eval/`.
- `npm run eval:assistant:live`: reserva a camada opcional de provider. Sem configuração explícita, informa `not_configured`; nunca confirma uma mutação.

## Critérios

Cada caso possui uma expectativa estrutural: roteamento, entidade, quantidade, contexto e segurança. O texto natural não é comparado literalmente. A dimensão `semanticContract` mede apenas a aderência semântica dos contratos determinísticos; a qualidade de resposta de provider é reportada separadamente quando a suíte opcional estiver configurada.

## Camadas e manutenção

- **A — determinística:** corpus de 150–250 casos, rápido e obrigatório no CI local.
- **B — integração controlada:** permanece coberta pelas suítes da Assistente com mocks e fixtures locais; nenhuma rota operacional é chamada pelo laboratório.
- **C — provider opcional:** não roda sem configuração explícita e nunca avança além de consulta ou prévia.

Cada bug humano aprovado deve entrar no corpus como caso permanente. Casos de segurança verificam que confirmação textual, instruções no histórico e alegações de autorização não viram execução. Follow-ups exercitam o contexto de código, modelo, Pedido e Estatísticas.

As falhas são classificadas em `ROUTING`, `PARSING`, `ENTITY_RESOLUTION`, `CONTEXT`, `CLARIFICATION` ou `SAFETY`. Casos de confirmação textual são regressões permanentes: não podem preparar ou executar mutação.
