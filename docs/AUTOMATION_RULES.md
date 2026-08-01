# Esteira autônoma do Negócios K

Este documento define os limites permanentes para tarefas longas executadas pelo Codex. O `AGENTS.md` e a instrução explícita mais recente do usuário continuam prevalecendo.

## Níveis de autonomia

### Nível 0 — somente leitura

Autorizado sem aprovação adicional:

- ler e auditar código, migrations e documentação;
- inspecionar schema, funções, permissões, índices e metadata;
- realizar consultas remotas estritamente read-only;
- analisar segurança, concorrência, idempotência e performance;
- produzir relatórios e registrar evidências sem dados sensíveis.

### Nível 1 — desenvolvimento local

Autorizado quando estiver no escopo do objetivo:

- criar ou alterar arquivos locais;
- refatorar somente o necessário;
- criar testes e mocks sem escrita remota;
- executar testes, lint, TypeScript, build e `git diff --check`;
- corrigir falhas relacionadas ao objetivo;
- revisar integralmente o diff.

### Nível 2 — versionamento em branch

Autorizado quando solicitado pelo objetivo:

- criar branch baseada em `origin/main`;
- fazer staging seletivo;
- criar commits de finalidade única;
- enviar somente a branch;
- abrir Pull Request sem merge automático quando a CLI já estiver instalada e autenticada;
- atualizar roadmap, logs e decisões.

### Nível 3 — aprovação humana obrigatória

Parar antes de:

- criar ou alterar migration;
- executar `supabase db push` ou alterar RPC remota;
- chamar RPC de escrita ou realizar operação real em Estoque ou Pedido;
- executar montagem, desmontagem, teste operacional ou validação visual autenticada;
- alterar RLS, grants, projeto Supabase ou variável da Vercel;
- executar operação destrutiva;
- fazer merge, push direto para `main`, force push ou excluir branch;
- decidir regra de negócio relevante e ambígua.

## Classificação técnica

- **A — pronta:** a infraestrutura existente permite implementação segura.
- **B — pronta com ajustes de aplicação:** pode implementar sem alterar banco ou regra de negócio.
- **C — exige banco/migration/RPC:** registrar bloqueio e pedir aprovação; não implementar automaticamente.
- **D — exige decisão de negócio:** registrar opções e pedir decisão; não implementar automaticamente.

As classificações A e B permitem desenvolvimento local e versionamento em branch. C e D bloqueiam a implementação. Nenhuma classificação autoriza migration automática.

## Fluxo de estado

Fluxo padrão:

`READY → AUDITING → IMPLEMENTING → VALIDATING → REVIEWING_DIFF → COMMITTED → PUSHED → PR_READY → WAITING_HUMAN_REVIEW → DONE`

Estados alternativos:

- `BLOCKED_DATABASE`
- `BLOCKED_BUSINESS_RULE`
- `BLOCKED_SECURITY`
- `BLOCKED_EXTERNAL_SERVICE`
- `BLOCKED_VISUAL_VALIDATION`
- `BLOCKED_OPERATIONAL_TEST`
- `FAILED_VALIDATION`

## Política de branches, commits e PRs

- Nunca desenvolver diretamente em `main`.
- Uma mudança funcional por branch e uma finalidade clara por commit.
- Toda branch funcional deve partir diretamente de `origin/main` limpo.
- Fazer preflight antes de cada objetivo.
- Fazer staging por lista explícita e revisar o diff staged integralmente.
- Enviar somente a branch; nunca usar force push.
- Abrir PR somente quando a CLI já estiver disponível e autenticada; nunca instalar ou iniciar login automaticamente.
- Nunca fazer merge automático. O merge em `main` exige aprovação humana.
- Concluir cada branch com worktree e staging limpos.

## Banco, Supabase e migrations

- Auditorias read-only são permitidas, sem `service_role` no frontend.
- Mudança estrutural exige migration revisada e autorização específica.
- Nunca alterar schema remoto manualmente nem executar `db push` autonomamente.
- Nunca alterar RPC, RLS ou grants remotos sem aprovação.
- Nunca criar dados de teste no banco real sem autorização operacional explícita.

## Operações reais

- Nenhum texto natural, inclusive “sim”, pode executar operação.
- IA interpreta; backend resolve e valida; usuário confirma por controle explícito; banco executa e audita.
- Entradas, saídas, Pedidos, montagens e desmontagens reais exigem aprovação humana.
- Nunca repetir automaticamente uma operação real para testar idempotência.

## Segredos, logs e privacidade

- Nunca versionar `.env`, credenciais, tokens, cookies, JWTs, proposal tokens ou segredos HMAC.
- Nunca registrar body operacional integral, payload de RPC, idempotency key completa ou dados pessoais desnecessários.
- Logs podem conter apenas objetivo, rota/ação, resultado sanitizado, duração e identificador interno seguro.
- Não incluir screenshots, dumps, caches, arquivos de túnel ou temporários.

## Testes e validação

- Testes locais devem usar mocks e não chamar RPC remota de escrita.
- Antes de commit: testes específicos, lint, TypeScript, build quando aplicável e `git diff --check`.
- Falha relacionada ao objetivo deve ser corrigida e toda validação afetada, repetida.
- Validação visual autenticada e teste operacional real são pontos de aprovação humana.

## Rollback e recuperação

- Não usar `git reset --hard`, `git clean`, `git checkout .` ou descarte abrangente.
- Reverter somente arquivo explicitamente autorizado e somente após conferir seu diff.
- Mudança já publicada deve ser corrigida por novo commit ou revert explícito aprovado, preservando histórico.
- Operação real nunca é “desfeita” apagando histórico; deve gerar movimentação inversa oficial.

## Estado final obrigatório

- branch de trabalho enviada e limpa;
- staging vazio;
- documentação e roadmap atualizados;
- bloqueios registrados em `DECISIONS_REQUIRED.md`;
- PR aberta ou claramente pronta para abertura;
- `main` sem commit, push ou merge autônomo;
- nenhuma configuração temporária ou processo de validação deixado ativo.
