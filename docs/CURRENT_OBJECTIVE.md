# Objetivo atual

- **ID:** NK-OUT-003
- **Título:** Validar visualmente a saída manual pela Assistente
- **Estado:** BLOCKED_VISUAL_VALIDATION
- **Branch de execução:** `codex/assistant-manual-stock-output`
- **Commit base:** `a31ba9aedda8fc59f2e980115dc10d06dea30749`
- **Dependências:** NK-OUT-001 concluído como B; NK-OUT-002 implementado e publicado no commit `9bc68bee216c8f5f9e17db1d2d591e5cffc40dbb`

## Escopo permitido

- revisão humana autenticada da prévia, esclarecimentos, cancelamento e resultado;
- inspeção em mobile e desktop sem confirmar operação;
- registro de defeitos visuais ou funcionais para correção local posterior.

## Escopo proibido

- clique em `Confirmar saída` ou chamada da rota operacional;
- saída real ou alteração de saldo;
- migration, `db push`, mudança de RPC, RLS ou grants;
- alteração de regra de negócio;
- commit ou push em `main`.

## Critérios de aceitação

- prévia de Servo sem kit, Servo com kit, kit e peça legível;
- esclarecimento de modelo ambíguo sem executar operação;
- montagem automática prevista apresentada corretamente;
- composer não cobre botões e não existe overflow;
- cancelamento local realiza zero chamada operacional.

## Comandos de validação

- `git status --short --branch`
- inspeção autenticada em 390×844, 844×390 e 1440×1000;
- nenhuma confirmação operacional.

## Pontos de parada

- necessidade de migration/RPC: `BLOCKED_DATABASE`;
- regra de negócio ambígua: `BLOCKED_BUSINESS_RULE`;
- risco não mitigado: `BLOCKED_SECURITY`;
- qualquer operação real: aprovação humana obrigatória.

## Execução

- **Última ação:** saída manual implementada e publicada em branch; montagem, desmontagem e subfluxos de Pedido auditados.
- **Próximo passo:** usuário revisar a branch funcional e executar validação visual autenticada sem confirmar saída.
- **Decisões humanas pendentes:** merges do framework e da saída; teste operacional da saída; semântica de rascunho, negociação duplicada e cancelamento de Pedido.
