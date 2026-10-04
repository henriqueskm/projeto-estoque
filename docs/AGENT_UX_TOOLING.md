# Agent UX Tooling — Negócios K

PR #79 prepara ferramentas; não redesenha páginas nem adiciona motion ao produto.
Instalação: **2026-10-03 (America/Sao_Paulo)**. Base main:
`caae861406882ace930c45f274705713c79a2509`.

## Papéis e limites

Emil = critério/design e craft. Transitions = implementação consistente de motion **já aprovado**. Playwright = validação do resultado real, não substituto de testes, TypeScript, lint ou regras de negócio.

Lead define tarefa → `$nk-builder` → Emil quando UI → Transitions se motion → testes focados → Preview → Playwright CLI → Lead/ChatGPT Reviewer → usuário valida → merge humano.

São consultores, não um designer autônomo. Não podem redefinir produto, redesenhar todo o app, substituir escopo do Lead, alterar regras de negócio, fazer merge ou executar mutações remotas. Instruções upstream de alteração automática ficam subordinadas ao escopo e às regras NK. `break-ui` usa fixtures locais/sanitizadas; não autoriza instalar DemoToggle no produto. A skill `pr-pipeline-nk` permanece intacta como fallback; não há segunda rodada automática de Reviewer.

## Skills locais e descoberta

Todas ficam em `.agents/skills/<nome>/SKILL.md`, commitadas no projeto, sem symlinks ou instalação global:

| Origem | Nomes reais | Uso condicional |
| --- | --- | --- |
| NK | `nk-builder` | Escopo definido pelo Lead; preserva regras anteriores |
| Emil | `emil-design-eng` | Hierarquia, spacing, affordance, feedback, foco, menus/modais e craft |
| Emil | `review-animations` | Alterações em animações existentes |
| Emil | `improve-animations` | Auditoria de motion explicitamente pedida |
| Emil | `find-animation-opportunities` | Decidir onde motion ajuda e onde não animar |
| Emil | `mobile-native` | Touch, hover sticky, tap highlight, viewport/safe areas, inputs/teclado |
| Emil | `break-ui` | Estados extremos, textos longos, listas vazias, números altos, viewport pequeno |
| Transitions | `transitions-dev` | Recipes CSS/tokens após decisão de design; nome não é `transitions.dev` |
| Transitions | `transitions-polish` | Refinar motion aprovado, sem redesign automático |
| Microsoft | `playwright-cli` | Browser verification com CLI local |

O instalador oficial `skills list --agent codex --json` reconheceu as dez skills como **project / Codex**. Isso comprova descoberta no filesystem pelo instalador; uma conversa já aberta pode precisar de nova sessão para atualizar seu catálogo de skills. Não alegamos recarga dinâmica desta conversa.

## Supply chain / proveniência

README, licença, comandos, pacote/lifecycle scripts e arquivos gerados foram inspecionados antes da instalação. Somente fontes oficiais; nenhum fork/pacote homônimo. Sem updater automático: atualizações são PRs revisáveis. [Manifesto local](../.agents/skills/ux-tooling-manifest.json) fixa revisões, contagens e SHA-256 das árvores vendorizadas (paths ordenados POSIX + conteúdo textual LF + separadores LF).

| Ferramenta | Fonte/revisão instalada | Licença e arquivos |
| --- | --- | --- |
| Emil | [emilkowalski/skills](https://github.com/emilkowalski/skills), `e8a175de22ae1e49370fc144c1f3bb9aeedf988d` | MIT; somente seis diretórios selecionados e seus recursos. `LICENSE.txt` upstream adicionado em cada diretório |
| Transitions | [Jakubantalik/transitions.dev](https://github.com/Jakubantalik/transitions.dev), `3bc58021c69725d8bf42108632ac6cf14f2b1d3c` | Licença própria gratuita, não MIT para as skills. Dois diretórios com `LICENSE.txt`, recipes/references CSS/Markdown |
| Playwright CLI | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli), npm `@playwright/cli@0.1.22`; README/source inspecionados em `b85c7a736bb473bf55b584e54a09ffa698d6d871` | Apache-2.0; devDependency exata, lockfile; skill/references vendorizadas e LICENSE/NOTICE preservados |
| Skill Playwright | Bundle oficial `playwright-core@1.64.0-alpha-1790635538000`, npm gitHead `e8149b8257d32dcf8f72573ecc43e72439da7080` do [microsoft/playwright](https://github.com/microsoft/playwright) | Instalador oficial `install --skills=agents`; proveniência real da skill é este pacote, não o HEAD do repo CLI |
| Instalador de skills | [vercel-labs/skills](https://github.com/vercel-labs/skills), `skills@1.7.0`; source inspecionado em `18f96ea131dab3b0fcc9b27cf7c6f6cbb6174680` | MIT; ferramenta transitória via npx, não dependência do app |

### Licenças / ajustes locais

Transitions permite uso/cópia/modificação em projetos pessoais/comerciais, sem plano. Proíbe republicar a coleção como biblioteca concorrente, template pack ou component kit. Aqui ela integra o workflow deste produto, não uma distribuição standalone da coleção. Licença original permanece em cada skill; não relabelar como MIT. [Termos referenciados pela licença](https://transitions.dev/terms.html). Recursos Pro/Agent pagos não foram instalados/usados.

Patch semântico único no conteúdo upstream: a `description` de `transitions-dev` tinha 1.730 caracteres, acima do limite 1.024 da validação de skills. Foi resumida somente no frontmatter; nome, corpo, recipes e licença permanecem. Formatação adicional: remover linhas vazias excedentes no EOF de 32 recipes Markdown e oito cópias de LICENSE/NOTICE para passar `git diff --check`; nenhum CSS/recipe foi alterado semanticamente. Os hashes refletem esse patch, a normalização de EOF e as cópias de notices. O lock transitório do instalador não é necessário para descoberta; proveniência commitada fica no manifesto dentro de `.agents/skills` e nos comandos fixados abaixo.

### Execução, rede e contas

- Skills Emil/Transitions: arquivos consultados pelo agente, sem executável ou dependência runtime adicionada ao app. Nenhuma conta necessária para estas skills gratuitas. O agente usado pode enviar contexto ao seu próprio provedor; instalar uma skill não muda essa política.
- `skills` executa JavaScript via npm/npx e baixa repos. Telemetria/auditorias externas do instalador foram desativadas com `DISABLE_TELEMETRY=1` e `DO_NOT_TRACK=1`. Nenhum conteúdo de código do aplicativo foi enviado a serviço de design.
- Playwright executa localmente via npm/npx; browser acessa os sites requisitados. Não exige conta Microsoft; login do app continua humano quando necessário. Não há upload de código documentado para esse CLI local. `NO_UPDATE_NOTIFIER=1` desliga checagem de update; não foi instalado updater automático.
- O pacote CLI não tem install/postinstall/prepare; dependências diretas Playwright/core também não tinham lifecycle scripts de instalação. `skills` tem scripts de desenvolvimento como prepare, mas todas as instalações usaram `ignore-scripts`. Nenhum fix automático, audit fix, Pro login ou export de sessão foi executado.
- CLI 0.1.22 depende oficialmente de `playwright` e `playwright-core` **alpha** `1.64.0-alpha-1790635538000`, ambos fixados no lock. Não são dependências runtime do app. Essa versão alpha transitiva é uma limitação explícita; atualizar conscientemente em PR futura.
- Transitions Agent foi investigado somente pelo README: scan local sem IA é separado dos fixes hospedados/pagos que enviam arquivos afetados. Nenhum scan, fix, revamp ou PR automática foi executado. O scan é opcional e não é necessário para provar esta instalação.

### Reprodução da instalação

Checkout + `npm ci --ignore-scripts` disponibiliza o CLI local e as skills já commitadas. Não precisa baixar skills novamente. Não usar `latest` para atualizar silenciosamente.

Na instalação original, primeiro `npx skills@latest --help` confirmou `--skill`, `--agent codex`, `--copy` e escopo project sem `--global`. A versão resolvida foi 1.7.0; as instalações seguintes foram fixadas:

```powershell
$env:npm_config_ignore_scripts = 'true'
$env:DISABLE_TELEMETRY = '1'
$env:DO_NOT_TRACK = '1'
$env:NO_UPDATE_NOTIFIER = '1'
npx --yes skills@1.7.0 add https://github.com/emilkowalski/skills/tree/e8a175de22ae1e49370fc144c1f3bb9aeedf988d --skill emil-design-eng review-animations improve-animations find-animation-opportunities mobile-native break-ui --agent codex --copy --yes
npx --yes skills@1.7.0 add https://github.com/Jakubantalik/transitions.dev/tree/3bc58021c69725d8bf42108632ac6cf14f2b1d3c --skill transitions-dev transitions-polish --agent codex --copy --yes
npm install --save-dev --save-exact --ignore-scripts @playwright/cli@0.1.22
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
npx --no-install playwright-cli install --skills=agents
node scripts/verify-agent-ux-tooling.mjs
```

Reinstalar upstream pode sobrescrever o patch de metadata, a normalização de EOF e notices adicionados: revalidar, reaplicar apenas os ajustes documentados e revisar hashes/diff em PR. Nunca atualizar o manifesto só para ocultar divergência.

O workspace local `.playwright/` foi inicializado; nenhum estado do browser é commitado. Chrome já instalado foi usado no smoke, sem baixar browser. Em outra máquina, providencie browser compatível via procedimento oficial e revise downloads antes de executar. Use sempre `npx --no-install playwright-cli`, não instalação global nem fallback automático para baixar outra versão.

## Motion policy

1. Função antes de decoração.
2. Motion explica mudança, hierarquia ou consequência; não é obrigatório em toda interação.
3. Interações frequentes devem ser rápidas.
4. Evitar animações longas que bloqueiem uso.
5. Preferir transform/opacity quando apropriado.
6. Respeitar `prefers-reduced-motion`, inclusive sem perder feedback funcional.
7. Não mascarar latência real com animação artificial.
8. Não prejudicar shells, streaming ou Instant Navigation da #78.

## Playwright — workflow NK

### Segurança e autenticação

Smokes comuns são **read-only** ou interrompidos antes do botão de confirmação. Nunca confirmar automaticamente Entrada, Saída, Venda, Ajuste, Montagem, Desmontagem, estoque mínimo ou criação/edição/finalização/cancelamento/entrada de Pedidos. Operação real exige autorização humana explícita.

Não criar usuário/senha/token hardcoded, não usar service_role, não exportar cookies/Supabase session/access ou refresh tokens. Para Preview autenticado, usar sessão humana/Codex disponível somente pelo mecanismo permitido no ambiente. CLI `open` cria sessão isolada: não assume que herda o login do browser integrado. Se attachment autorizado/sessão não estiver disponível, pedir login humano ou registrar limitação; nunca copiar storage state para resolver. Não habilitar debugging remoto em browser humano automaticamente.

`.playwright/`, `.playwright-cli/`, `artifacts/agent-ux/`, `playwright-report/` e `test-results/` são ignorados. Guardar artefatos exclusivamente nesses caminhos. Não publicar secrets, capturas com dados sensíveis ou arquivos de sessão. `.gitignore` não protege artefatos gravados em caminhos arbitrários: conferir `git status` antes de commit. Sem uploads/attachments automáticos.

### Smoke visual de futuras tarefas

Abrir Preview e verificar Assistente, Estoque, Pedidos, Entrada, Saída, Aplicações, Estatísticas e Histórico conforme escopo. Viewports padrão: **320×800, 375×812, 768×1024, 1440×900**.

- Página/título/conteúdo principal; largura documentElement não excede viewport.
- Drawer mobile, navegação, Back/Forward, scroll e retorno via Activity.
- Workspace State útil preservado; modais transacionais não reaparecem ao retornar.
- Modal/menu: abrir sem confirmar, Escape, foco inicial/retorno, Tab/Shift+Tab e teclado quando apropriado.
- Console errors, exceções e requests falhados. Reportar observação concreta, não inferir ausência de erro sem ler logs.
- Mobile/touch e teclado: emulação não prova comportamento do teclado virtual real; complementar com smoke humano em aparelho quando necessário.
- Reduced motion: `set-reduced-motion reduce`; validar novamente interação/feedback.

Comandos locais (trocar refs a partir do snapshot atual; nunca reutilizar ref às cegas):

```powershell
$env:NO_UPDATE_NOTIFIER = '1'
npx --no-install playwright-cli -s=nk-visual open <PREVIEW_URL> --browser=chrome
npx --no-install playwright-cli -s=nk-visual resize 375 812
npx --no-install playwright-cli -s=nk-visual snapshot
npx --no-install playwright-cli -s=nk-visual find 'Estoque'
# Inspecionar snapshot e clicar somente navegação/controle seguro.
npx --no-install playwright-cli -s=nk-visual go-back
npx --no-install playwright-cli -s=nk-visual go-forward
npx --no-install playwright-cli -s=nk-visual eval 'document.documentElement.scrollWidth <= window.innerWidth'
npx --no-install playwright-cli -s=nk-visual console error
npx --no-install playwright-cli -s=nk-visual requests --static
npx --no-install playwright-cli -s=nk-visual close
```

Snapshot/refs são preferidos a scripts arbitrários. `run-code` só para uma verificação necessária e inspecionada, não bypass de writers/autorizações. Screenshots somente quando ajudam a revisão, locais e temporárias. Traces/vídeos somente para diagnóstico específico de motion, foco, navegação, race, Activity ou layout shift; não gravar tudo, não commitar grandes artefatos.

### Smoke técnico desta PR

2026-10-03: Chrome isolado headless, sessão `nk79-smoke`, superfície pública produção, sem login:

1. `open https://estoquenk.vercel.app/apresentacao --browser=chrome` → título `NK Estoque | Gestão inteligente de Estoque e Pedidos`.
2. Snapshot e `find 'Manual'` → link principal observado ref `e16`.
3. Clique seguro `e16` → `/manual`, título `Manual NK Estoque | Central de ajuda`.
4. `go-back` → `/apresentacao`.
5. Screenshot temporária `.playwright-cli/nk79-public-smoke.png`, não commitada.
6. Console: **0 mensagens / 0 errors / 0 warnings**. Requests incluindo estáticos: **30 GET, todos 200**, nenhum writer acionado.
7. Somente a sessão criada pelo smoke foi fechada.

Isso prova CLI funcional, não auditoria completa, benchmark nem smoke autenticado do app. Viewports internos, Activity autenticado e revisão de motion pertencem à #80. Não foi necessário acessar/copiar a sessão humana.

## Validação / manutenção

`node scripts/verify-agent-ux-tooling.mjs` verifica frontmatter/names, links locais, hashes, licença, arquivos não executáveis, pacote exato dev-only, regras condicionais do Builder, ignore dos artefatos e preservação do Builder anterior/fallback. Usa somente Node built-ins; não cria framework nem instala YAML. O validator Python do skill-creator não estava executável sem PyYAML neste ambiente; parsing YAML foi conferido adicionalmente com o parser já disponível no checkout, sem nova dependência.

Resultados: **13/13 source contracts**, `npx tsc --noEmit` aprovado, `npx eslint scripts/verify-agent-ux-tooling.mjs --max-warnings 0` aprovado, `git diff --check` aprovado e `npm run build -- --webpack` aprovado (53 páginas geradas; Cache Components e Partial Prefetching continuam enabled). Nenhuma suite de app desnecessária foi executada.

Conferência upstream: 59 arquivos idênticos (normalizando CRLF/LF e linhas vazias no EOF), um patch de descrição documentado e oito arquivos adicionais de LICENSE/NOTICE. `pr-pipeline-nk` não é arquivo versionado nesta base main; sua cópia local no checkout principal não foi tocada/incluída nesta PR.

NOTE supply chain: `npm audit` informou 21 avisos (7 moderate / 14 high). Todos os nodes afetados são entradas idênticas às do lockfile da base main; nenhum advisory foi informado para os três pacotes Playwright adicionados. Nenhum `audit fix` ou mudança fora do escopo foi executado. Isso não é garantia de ausência de vulnerabilidades desconhecidas.

TypeScript, lint e build são gates porque houve alteração de devDependency. Não rodar auditoria geral de produto nem suites enormes para arquivos Markdown. Não corrigir dependências preexistentes com `npm audit fix` neste escopo.

## Próxima PR #80 — Design & Motion Review (proposta, não executada)

Auditoria read-only/sanitizada de Assistente, Estoque, Pedidos, Entrada, Saída, Aplicações, Estatísticas, Histórico, menu mobile, modais, accordions, cards, loading shells e success/error feedback. Avaliar hierarquia/densidade, hover/focus, touch/mobile, motion e reduced motion nos quatro viewports. Emil define critérios; Transitions somente para recommendations de motion justificado; Playwright documenta evidências reais e limitações. Priorizar findings por impacto observado, inclusive onde **não** animar. Lead escolhe correções pequenas antes de qualquer implementação. Não redesenhar automaticamente nem tocar regras de negócio/stock/auth.
