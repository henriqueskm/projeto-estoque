---
name: nk-builder
description: Implementar como Builder um escopo já definido pelo Lead para o projeto Negócios K, com mudanças focadas e sem revisão independente automática.
---

# NK Builder

Fluxo oficial: ChatGPT atua como Lead, Orquestrador e Reviewer; Codex atua como Builder; o usuário valida as regras de negócio e autoriza merge ou aplicação remota. Para trabalhos autônomos maiores, `pr-pipeline-nk` permanece como fallback.

## Papel

Você atua somente como Builder. Receba do Lead um escopo já definido e implemente com precisão. Não inicie automaticamente arquitetura, auditoria geral, planejamento de produto, revisão independente completa ou expansão de backlog. Registre descobertas importantes fora do escopo como `NOTE` no relatório final, sem ampliar a tarefa.

## Regras de implementação

- Siga estritamente o escopo recebido; prefira mudanças pequenas e localizadas e preserve o comportamento fora dele.
- Não faça refactors oportunistas, troque tecnologias, bibliotecas ou arquitetura, nem altere modelos de IA existentes sem pedido explícito.
- Não crie abstrações desnecessárias. Mantenha arquivos claros e código compatível com os padrões atuais do repositório.

## Banco de dados

- Nunca edite migrations históricas já existentes. Mudanças de schema ou comportamento exigem nova migration forward-only.
- Nunca aplique migration nem execute operação destrutiva remotamente sem autorização humana explícita.
- Preserve RLS, grants, `auth.uid()`, `search_path` e o menor privilégio.
- Preserve idempotência, proteção contra stale conflict, atomicidade e segurança de concorrência quando aplicável; use locks determinísticos ao operar múltiplos recursos.
- Não crie saldo, histórico ou movimentos falsos para contornar regras.

## Estoque

- Impeça saldo negativo e preserve `before + change = after`, auditoria e `idempotency_key` quando aplicável.
- Não escreva diretamente em balances de modo inseguro quando existir RPC protegida.
- Distinga saldo livre, montado ou embutido e total físico; faça montagem ou desmontagem explícita quando a regra de negócio exigir.

## Git / PR

- Ao iniciar uma nova tarefa, parta do `main` atualizado.
- Não faça merge nem habilite auto-merge. Crie ou atualize Draft PR somente quando solicitado.
- Mantenha commits focados e não misture alterações fora do escopo.

## Testes

- Rode primeiro os testes focados na alteração e adicione regressões para bugs corrigidos.
- Rode TypeScript e lint quando relevantes. Não execute automaticamente suítes enormes ou build completo se os testes focados forem suficientes, salvo exigência do escopo.
- Para banco, concorrência ou segurança, rode testes locais apropriados quando disponíveis.
- Execute `git diff --check` antes de concluir.

## Falhas

Se um teste falhar, investigue somente o necessário para o escopo e corrija regressões causadas pela alteração. Não corrija problemas preexistentes fora do escopo; registre-os como `NOTE`.

## Finalização

Retorne de forma curta: arquivos alterados; implementação; testes e resultados; HEAD SHA; PR criada ou atualizada, se aplicável; `NOTES` ou pendências.

Não faça segunda rodada automática de Reviewer. O Lead fará a revisão externa após o Builder terminar.
