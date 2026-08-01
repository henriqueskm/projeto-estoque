# Objetivo atual

- **ID:** NK-OUT-001
- **Título:** Auditar saída manual
- **Estado:** READY
- **Branch de execução:** a criar a partir de `origin/main` após publicar o framework
- **Commit base:** `a31ba9aedda8fc59f2e980115dc10d06dea30749`
- **Dependências:** NK-AUTO-001 publicado em branch própria

## Escopo permitido

- leitura da página, componentes, Server Actions e serviços da saída;
- leitura integral das migrations e funções relacionadas;
- inspeção read-only de schema, permissões, locks, idempotência e retorno;
- classificação A/B/C/D;
- relatório e atualização do roadmap.

## Escopo proibido

- chamada de RPC de escrita;
- saída real ou alteração de saldo;
- migration, `db push`, mudança de RPC, RLS ou grants;
- alteração de regra de negócio;
- commit ou push em `main`.

## Critérios de aceitação

- operação oficial, assinatura, payload e retorno identificados;
- autenticação, perfil, permissões e segurança revisados;
- atomicidade, locks, saldo negativo, concorrência, aliases e idempotência confirmados;
- descrição operacional futura avaliada;
- classificação técnica justificada com evidências.

## Comandos de validação

- `git status --short --branch`
- buscas e leitura estática do código/migrations
- consultas remotas somente leitura quando necessárias
- `git diff --check`

## Pontos de parada

- necessidade de migration/RPC: `BLOCKED_DATABASE`;
- regra de negócio ambígua: `BLOCKED_BUSINESS_RULE`;
- risco não mitigado: `BLOCKED_SECURITY`;
- qualquer operação real: aprovação humana obrigatória.

## Execução

- **Última ação:** framework documental preparado na branch `codex/automation-framework`.
- **Próximo passo:** validar, versionar e publicar o framework; depois retornar à `main` e iniciar a auditoria.
- **Decisões humanas pendentes:** revisão/merge do framework; validações visual e operacional de qualquer implementação futura.
