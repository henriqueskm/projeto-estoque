# Objetivo atual

- **ID:** MIG-BASE-001
- **Título:** Baseline reproduzível do estado atual
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** B — mecanismo local validado; exige revisão humana antes de desbloquear o PR #5
- **Branch:** `agent/current-state-baseline`
- **Pull request:** [#7](https://github.com/henriqueskm/projeto-estoque/pull/7) — draft
- **Base:** `origin/main` em `d06bedb275e4b178fb0e26fb7e6c56f66726a19b`
- **Dependência bloqueada:** retomada e novo timestamp da MIG-SAF-001 / PR #5

## Resultado

- schema atual `public/private`, policy de Storage e catálogo referencial foram capturados em baseline fora de `supabase/migrations`;
- oito tabelas referenciais e um registro de bucket foram incluídos;
- nenhum usuário, perfil, Pedido, saldo, lote, movimento, evento ou objeto de Storage foi copiado;
- duas reconstruções locais independentes produziram as mesmas assinaturas de schema e catálogo;
- checksum, alvo remoto, conteúdo pessoal/operacional e falhas parciais foram rejeitados;
- migrations históricas permanecem intactas e migrations futuras continuam incrementais após `20260729001230`.

## Decisão sobre a ponte histórica

`MIG-HIST-002` foi encerrada como `ABANDONED_BY_DECISION`. O WIP permanece
somente no stash local `stash@{0}` e não integra esta branch. O custo e o risco
de reconstruir todas as identidades históricas foram considerados
desproporcionais para o piloto.

## Próximo passo humano

Revisar o baseline e o restaurador local. Após aprovação e merge, o PR #5 pode
ser retomado com a migration Safisa renomeada para um timestamp superior a
`20260729001230` e novamente testada sobre o baseline.

O baseline nunca será aplicado ao remoto. `migration repair` remoto continua
não autorizado.

**Ponto de parada:** `WAITING_HUMAN_REVIEW`.
