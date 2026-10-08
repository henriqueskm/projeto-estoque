# Relatório de estoque — NK PR #86

## Escopo e fonte única

`/relatorio-estoque`, acessível pelo botão **Relatório** no Estoque, é somente leitura de estoque. Não oferece preço, operação de estoque ou escrita em saldo.

O Server Component aguarda `connection()` e perfil ativo. O loader reutiliza `loadInventoryData`: catálogo estrutural existente, paginação existente e saldos/mínimos frescos. Não cria cache de saldo nem solicita URLs assinadas. Somente a opção explícita `includeInactivePhysical` inclui itens físicos inativos no relatório; o Estoque normal mantém seu comportamento.

| Categoria | Quantidade da linha |
| --- | --- |
| Servos com kit | `assembledQuantity` |
| Servo sem kit | `looseQuantity` |
| Kits avulsos | `looseQuantity` |
| Reparos | `looseQuantity` |
| Peças avulsas | `looseQuantity` |
| Conjuntos | `readyQuantity` |

Só aparecem quantidades positivas. Uma configuração ou conjunto pronto representa uma unidade na sua categoria; não é decomposto novamente. `mountedQuantity`, `embeddedQuantity`, `totalQuantity` e capacidade de montagem não aumentam linhas livres. O resumo soma exclusivamente as linhas deduplicadas por identidade física.

Aliases não duplicam linha nem saldo. O código canônico é o primeiro alias **ativo** na ordenação natural `pt-BR`, numérica e sem distinção de caixa. Empates usam código original e identidade. Se não existir alias ativo, um código histórico é conservado para não ocultar saldo físico ainda existente; ausência completa de código com saldo positivo faz o relatório falhar fechado, em vez de entregar um relatório incompleto.

## Ordem compartilhada e migration

Migration forward-only: `supabase/migrations/20261008115955_inventory_report_settings.sql`.

**Não aplicada remotamente nesta PR.** Cria apenas o singleton de apresentação `public.inventory_report_settings`. As seis categorias são obrigatórias exatamente uma vez. RLS permite SELECT/UPDATE somente a perfis ativos; authenticated recebe UPDATE somente de `category_order`, sem INSERT/DELETE ou alteração direta de autoria. Trigger SECURITY INVOKER, `search_path = ''`, deriva `updated_by` de `auth.uid()` e o horário no banco. Não existe RPC/SECURITY DEFINER novo.

Organizar mantém uma cópia local não salva. ↑/↓ e Restaurar padrão alteram somente essa cópia; apenas **Salvar ordem** executa a server action com cliente normal/RLS e revalida a rota. Todos os usuários leem o mesmo singleton, sem localStorage como fonte oficial. Edições simultâneas da ordem seguem última gravação confirmada, sem alterar estoque.

Enquanto a tabela ainda não existe, somente os erros específicos de relação ausente permitem ordem padrão e aviso explícito. Salvar fica indisponível. Erros de acesso, singleton ausente ou ordem inválida não recebem fallback silencioso. A autorização/aplicação humana da migration será necessária para testar salvamento compartilhado no Preview real. Um futuro refresh do contrato estrito de deployment reset deve classificar essa configuração como estrutural/preservar, sem afrouxar guards.

## Tela, exportação e impressão

- Desktop/tablet ≥768 px: tabela compacta, código monoespaçado, quantidade à direita; índice sticky ≥1024 px.
- Mobile: lista própria código/quantidade, sem comprimir tabela; Organizar abre bottom sheet. Alvos dos controles têm pelo menos 44 px, teclado, trap de foco, Escape e foco restaurado.
- Busca usa a normalização compartilhada do catálogo, sem modificar código oficial. É somente visual.
- CSV completo, não filtrado: UTF-8 BOM, `;`, CRLF, colunas Categoria/Código/Quantidade. Células textuais são escapadas e protegidas contra fórmula. Nome/data usam Brasília.
- Imprimir/PDF usa impressão nativa e A4. `beforeprint` prepara sincronamente o relatório **completo** em portal direto no body; CSS oculta todo o restante. `afterprint` encerra o portal. Cabeçalhos/linhas evitam quebras ruins quando suportado pelo navegador.
- Desktop, mobile, CSV e impressão recebem a mesma ordem compartilhada e ordenação natural de códigos.

## Navegação e Activity

Loading shell estático, dado operacional após `connection()`, Cache Components e Partial Prefetching preservados. A rota participa das allowlists existentes de href, métricas e referrer seguro.

Workspace State v1 mantém somente pesquisa/scroll do relatório, nunca ordem compartilhada, dados ou diálogos. Organizar usa o coordenador Semantic Back existente, com bloqueio durante salvamento. Back fecha; Forward não ressuscita confirmação. O overlay pertence ao DOM da rota e é ocultado imediatamente por Activity; cleanup encerra o estado transitório ao retornar. Listeners de impressão desconectam em Activity hidden, evitando que uma rota retida imprima sobre outra.

## Validação local reproduzível

```powershell
node --experimental-strip-types --experimental-loader ./tests/inventory-report-loader.mjs --test tests/inventory-report.test.mjs
node --test tests/inventory-report.local.mjs
node --experimental-strip-types --experimental-loader ./tests/bundle-inventory-loader.mjs --test tests/bundle-inventory.test.mjs tests/workspace-state.test.mjs tests/mobile-semantic-back.test.mjs tests/route-transient-state.test.mjs tests/instant-navigation.test.mjs tests/mobile-ux-polish.test.mjs tests/ui-layout-regressions.test.mjs
npx tsc --noEmit
git diff --check
npm run build -- --webpack
npm run build
```

A suíte SQL usa um banco **novo e descartável no PostgreSQL Docker local** com perfis sanitizados e o helper canônico de perfil ativo. Não usa URL remota. São 8 testes reais de constraints, RLS/grants e autoria. A suíte do relatório contém 33 testes; regressões relacionadas contêm 260, incluindo uma nova regressão do opt-in de itens físicos inativos: **301 passed, 0 failed** (42 novos, incluindo SQL).

Fixture de navegador isolada, sem Supabase, somente para evidência visual do componente real:

```powershell
node tests/inventory-report.browser-fixture.mjs
# http://127.0.0.1:3086/relatorio-estoque
# ?fixture=stress | ?fixture=empty | ?fixture=many
```

Validado no Chrome pelo navegador integrado/Cua, locators Playwright e CDP, em 320×800, 375×812, 768×1024 e 1440×900: apresentação própria mobile/desktop e Organizar sem overflow horizontal; alvos ≥44 px; Save com contraste carvão/branco; ↑/↓, salvar somente na fixture, pesquisa compacta, foco/Tab/Shift+Tab/Escape, Back/Forward e Activity. Capturas sanitizadas foram exibidas na sessão, não commitadas.

Break UI: código longo e quantidade `2147483647` em 320 px mantiveram código/número visíveis sem overflow. PDF via CDP conteve 7 linhas/todas as 6 categorias com pesquisa exibindo só MBF-015. CSV completo/BOM/ordem/escape são validados pela suíte; captura do evento download pelo navegador integrado não ficou disponível, portanto não é apresentada como prova de download real. Não houve erros/warnings de console na fixture.

Limitações: viewport emulado não comprova teclado físico Android; diálogo nativo de impressão, paginação final e impressora devem ser conferidos pelo usuário. Fixture não substitui leitura autenticada do Preview. Nenhuma gravação da ordem, migration ou operação de estoque será executada remotamente no smoke.
