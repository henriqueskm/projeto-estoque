# Template de objetivo autônomo

## Identificação

- **Objetivo:**
- **ID:**
- **Contexto:**
- **Commit base:**
- **Branch:**
- **Dependências:**
- **Estado inicial:** READY

## Escopo autorizado

- _Preencher._

## Escopo proibido

- _Preencher._

## Arquivos esperados

- _Preencher._

## Auditoria necessária

- arquitetura e padrões existentes;
- banco, RPCs, segurança e permissões, quando aplicável;
- concorrência, idempotência e atomicidade;
- performance e ausência de N+1;
- dados e regras de negócio relevantes.

## Critérios de aceitação

- _Preencher._

## Testes e validações

- testes específicos com mocks;
- `npm run lint`;
- `npx tsc --noEmit`;
- `npm run build` quando aplicável;
- `git diff --check`;
- revisão integral do diff e do staging.

## Segurança

- nenhum segredo, token, cookie, JWT ou arquivo de ambiente;
- nenhuma escrita remota sem aprovação;
- nenhuma autoridade confiada ao cliente;
- erros e logs sanitizados;
- operação somente após confirmação explícita, quando aplicável.

## Performance

- consultas direcionadas e limitadas;
- sem N+1, polling ou catálogo integral desnecessário;
- sem chamadas duplicadas ou retry automático de escrita.

## Pontos de parada

- migration/RPC/RLS/grant;
- regra de negócio ambígua;
- teste operacional real;
- validação visual autenticada;
- merge ou push direto em `main`;
- operação destrutiva.

## Comandos Git

1. preflight e `git fetch origin`;
2. criar branch a partir de `origin/main`;
3. staging seletivo;
4. revisão de `git diff --cached`;
5. commit de finalidade única;
6. push da branch;
7. PR sem merge automático;
8. confirmar branch limpa.

## Relatório final

- escopo executado;
- arquivos;
- arquitetura e segurança;
- testes e validações;
- classificação A/B/C/D, quando aplicável;
- commit, push e PR;
- bloqueios e decisões humanas;
- confirmação das ações não executadas.

## Estado final

- **Estado:**
- **Última ação:**
- **Próximo passo:**
- **Bloqueios:**
