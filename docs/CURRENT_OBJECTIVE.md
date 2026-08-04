# Objetivo atual

- **ID:** NK-ASM-002
- **Título:** Implementar montagem pela Assistente NK
- **Estado:** WAITING_HUMAN_REVIEW
- **Branch de execução:** `agent/assistant-assembly`
- **Commit base:** `4d5b67f8ad48dfa471269d5a92246bf260a404ff`
- **Dependências:** NK-ASM-001 concluído como B; framework e saída manual mesclados em `main`

## Escopo implementado

- roteamento determinístico de pedidos de montagem;
- resolução server-side de configuração, aliases, Servo, Kit e saldos;
- prévia estruturada com consumo dos componentes e saldo montado estimado;
- token HMAC vinculado ao usuário, ação, alvo, quantidade e idempotência;
- rota fixa `POST /api/assistant/actions/configuration-assembly`;
- confirmação somente por botão e chamada única da RPC oficial;
- resultado estruturado, replay idempotente e sucesso preservado com `refreshWarning`;
- persistência segura: prévia restaurada expira e perde o token.

## Escopo proibido nesta etapa

- confirmar uma montagem real ou chamar a RPC de escrita durante validação autônoma;
- migration, `db push`, mudança de RPC, RLS ou grants;
- implementar desmontagem junto da montagem;
- merge automático em `main`.

## Critérios de aceitação humana

- prévia legível em mobile e desktop, sem overflow ou conteúdo coberto pelo composer;
- aliases da mesma configuração apresentados juntos e sem duplicidade física;
- componentes, capacidade, saldo atual e projeções conferidos;
- cancelamento faz zero chamada operacional;
- nenhuma confirmação por texto como “sim” ou “confirme”.

## Comandos de validação já aprovados

- `npm run test:assistant-configuration-assembly`
- `npm run test:assistant-stock-output`
- `npm run test:assistant-stock-entry`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

## Pontos de parada

- revisão e validação visual: `WAITING_HUMAN_REVIEW`;
- teste com montagem real: aprovação operacional específica obrigatória;
- merge: aprovação humana obrigatória.

## Execução

- **Última ação:** NK-OUT-003 e NK-OUT-004 registrados como concluídos; PR #2 e smoke test de produção aprovados; NK-ASM-002 implementado e validado localmente.
- **Próximo passo:** revisar o PR draft e validar a prévia autenticada sem clicar em `Confirmar montagem`.
- **Decisões humanas pendentes:** validação visual, futuro teste operacional controlado e merge da montagem.
