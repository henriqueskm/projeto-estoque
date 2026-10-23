# Pedido por foto — revisão humana (Issue #102)

## Problema e correção

`VISUAL_REVIEW` impedia `Criar Pedido`, mas não possuía uma ação que resolvesse
essa pendência. Corrigir o código não deveria eliminar silenciosamente uma
dúvida visual, especialmente quando há anotação manuscrita.

A própria prévia agora oferece:

- contador e atalho para o primeiro item pendente;
- **Revisar item**, comparando código/descrição extraídos, produto oficial,
  quantidade e aviso original;
- **Confirmar produto e quantidade**, que remove **somente** `VISUAL_REVIEW`;
- **Corrigir produto**, reutilizando a validação canônica do catálogo;
- quantidade editável, inteira, de 1 a 2.147.483.647;
- revisão explícita do número da negociação e data real, preservando zeros.

Cada mudança atualiza o mesmo bloco da conversa. Não há nova chamada de IA,
reenvio de foto ou criação de Pedido durante a revisão. Corrigir a quantidade
não confirma automaticamente uma dúvida visual ou um código incerto.

`CODE_MISSING`, `CODE_NOT_FOUND`, `CODE_UNCERTAIN`, `CODE_AMBIGUOUS`,
`DESCRIPTION_CONFLICT` e `QUANTITY_MISSING` não podem ser ignorados pela
confirmação visual. Duplicados, imagens ilegíveis, documentos incompatíveis e
falhas de análise não se tornam prontos por edição local.

## Segurança preservada

Somente depois de resolver todas as pendências e o cabeçalho é liberado
`Criar Pedido`. O fluxo existente permanece:

1. `prepare-create` relê catálogo/negociação e valida os dados no servidor;
2. apresenta a confirmação separada, com produto oficial e totais;
3. `confirm-create` verifica o token HMAC, usuário, prazo e catálogo, antes de
   chamar o writer existente com sua chave idempotente.

Os endpoints, contratos server-side, writer e token não foram alterados.
Avisos/manuscritos não são transformados em instruções ou observações
operacionais. O botão final mantém o bloqueio de submissão concorrente e o
retry da mesma proposta após resultado incerto.

Os diálogos usam o Semantic Back existente: Back/Escape fecham a revisão,
Forward não restaura uma confirmação antiga. O cleanup compatível com Activity
fecha somente UI transitória e invalida respostas de preparação/catálogo de
uma visita anterior. Correções úteis do bloco permanecem; uma confirmação real
em andamento mantém o gate e sua identidade existentes.

## Mobile e acessibilidade

Sheet no mobile e diálogo central no desktop, com safe areas, rolagem vertical,
botões de pelo menos 44 px, input de 16 px, foco inicial, trap de Tab/Shift+Tab,
Escape e retorno de foco. Não foi adicionada animação. Textos/códigos longos e
o número máximo da negociação quebram sem sobrepor a data ou causar overflow.

## Evidência local — 23/10/2026

312 testes Node passaram, incluindo 25 novos. Os grupos são disjuntos:

| Grupo | Resultado |
| --- | --- |
| Foto/revisão, criação, qualidade, catálogo avulso, conversa contextual e Pedidos | 141/141 |
| Rota de foto com providers simulados | 11/11 |
| Workspace State, Semantic Back, Activity, Instant Navigation e layouts | 155/155 |
| Renderização estruturada e gates compartilhados | 5/5 |

A suíte nova também executa preparação/confirmação reais em memória, com HMAC
e dependências de catálogo/writer simuladas: preparação sem escrita, catálogo
autoritativo, alteração de catálogo bloqueada e retry com a mesma chave.

TypeScript, ESLint dos arquivos alterados (zero warnings), `git diff --check`,
build Webpack e build padrão Next/Turbopack passaram. Cache Components e
Partial Prefetching continuam habilitados.

### Smoke reproduzível, sem dados reais

```sh
node tests/assistant-photo-review.browser-fixture.mjs
```

Abrir `http://127.0.0.1:3102/` no navegador autorizado. O fixture usa o componente
real, Semantic Back real e React Activity, mas intercepta a rede **inteira**:
catálogo, preparação e confirmação são simulados localmente. Nenhum cliente
Supabase ou writer remoto participa. A página exibe as contagens das chamadas,
tokens distintos e gravações fictícias. F8 navega para outra rota local e
esconde o componente via Activity.

| Viewport | Verificação |
| --- | --- |
| 320 × 800 | Revisão, código incerto, quantidade inválida/corrigida, Back/Forward, textos/números máximos; sem overflow horizontal |
| 375 × 812 | Correção de produto, foco inicial/trap/retorno, cabeçalho, Activity preservando correção e fechando revisão; sem overflow |
| 768 × 1024 | Diálogo, conteúdo e controles de 44 px; sem overflow |
| 1440 × 900 | Diálogo central, foco interno, conteúdo e controles; sem overflow |

Também verificados: duas pendências resolvidas separadamente, duplicado e
ilegível sem liberação, preparação exibindo as cinco linhas/11 unidades e
retry incerto. Duplo clique fez uma tentativa; retry fez a segunda chamada
usando o mesmo token: **1 preparação, 2 confirmações, 1 token distinto,
1 resultado simulado**. Console da sessão local: nenhum erro/warning capturado.

Artefatos temporários permanecem em caminhos ignorados. Não se exportou sessão,
cookie, foto privada ou credencial. O fixture não é uma rota da aplicação.

### Limitações

Smoke em Chrome com viewports emulados, não em Android/PWA físico. A validação
end-to-end de criação foi exclusivamente sintética: nenhum Pedido real foi
confirmado. Preview READY comprova o deploy do HEAD, não autoriza nem substitui
uma criação remota. O Lead/usuário deve validar o fluxo no ambiente apropriado
antes de liberar o merge.

Zero migrations, alterações de RPC, Supabase, estoque ou Pedidos reais.
