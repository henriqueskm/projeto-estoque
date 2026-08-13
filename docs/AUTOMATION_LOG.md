# Log da esteira autônoma

Este arquivo é append-only. Não registrar tokens, cookies, JWTs, segredos, proposal tokens, payload operacional ou dados pessoais desnecessários.

## 2026-08-01T16:15:44Z — NK-AUTO-001

- **Estado anterior:** READY
- **Estado novo:** IMPLEMENTING
- **Branch:** `codex/automation-framework`
- **Resumo:** pré-voo global aprovado e estrutura documental permanente iniciada.
- **Validações:** `main` e `origin/main` em `a31ba9aedda8fc59f2e980115dc10d06dea30749`; worktree limpa; projeto `isdjboconmwaqipjrjvp`; 22 migrations alinhadas.
- **Commit:** pendente
- **Push:** pendente
- **PR:** pendente
- **Bloqueios:** nenhum para a criação do framework.
- **Próxima ação:** revisar, validar, versionar e enviar a branch documental.

## 2026-08-01T16:35:12Z — NK-AUTO-001

- **Estado anterior:** IMPLEMENTING
- **Estado novo:** PR_READY
- **Branch:** `codex/automation-framework`
- **Resumo:** estrutura permanente revisada, versionada e publicada sem alterações funcionais.
- **Validações:** `git diff --check`, revisão do diff e worktree limpa após o primeiro commit.
- **Commit:** `66dcaf27b8159e9e4984c29bf59ed84e18e30188`
- **Push:** branch enviada e sincronizada
- **PR:** https://github.com/henriqueskm/projeto-estoque/pull/new/codex/automation-framework
- **Bloqueios:** GitHub CLI indisponível; abertura manual do PR necessária.
- **Próxima ação:** registrar a primeira fila de objetivos em segundo commit documental.

## 2026-08-01T16:35:12Z — NK-OUT-001

- **Estado anterior:** READY
- **Estado novo:** DONE
- **Branch:** `main` (somente leitura)
- **Resumo:** saída tradicional auditada; RPC `stock_outbound_items(jsonb, uuid, text)` é transacional, idempotente e segura, com aliases agregados por configuração e montagem automática atômica.
- **Validações:** migrations e aplicação revisadas; nenhuma RPC chamada.
- **Commit:** não aplicável
- **Push:** não aplicável
- **PR:** não aplicável
- **Bloqueios:** nenhum de banco; classificação B por ajustes de aplicação e exigência adicional de perfil com nome.
- **Próxima ação:** implementar NK-OUT-002 em branch própria.

## 2026-08-01T16:35:12Z — NK-OUT-002

- **Estado anterior:** READY
- **Estado novo:** PR_READY
- **Branch:** `codex/assistant-manual-stock-output`
- **Resumo:** parser determinístico, resolução server-side, token HMAC, prévia/resultado estruturados e rota POST fixa implementados; confirmação somente por botão e descrição fixa no servidor.
- **Validações:** 20 testes da saída; 17 testes de regressão da entrada; lint, TypeScript, build e `git diff --check` aprovados.
- **Commit:** `9bc68bee216c8f5f9e17db1d2d591e5cffc40dbb`
- **Push:** branch enviada e sincronizada
- **PR:** https://github.com/henriqueskm/projeto-estoque/pull/new/codex/assistant-manual-stock-output
- **Bloqueios:** validação visual e teste operacional reais exigem aprovação humana.
- **Próxima ação:** NK-OUT-003.

## 2026-08-01T16:35:12Z — NK-ASM-001

- **Estado anterior:** READY
- **Estado novo:** DONE
- **Branch:** `main` (somente leitura)
- **Resumo:** montagem classificada B; consome servo e kit, aumenta configuração, usa locks estáveis, idempotência por usuário/chave, batch e auditoria atômicos.
- **Validações:** wrappers, worker, recibo, grants e interface tradicional revisados.
- **Commit:** não aplicável
- **Push:** não aplicável
- **PR:** não aplicável
- **Bloqueios:** apenas integração de aplicação; validações visual e operacional futuras.
- **Próxima ação:** priorizar NK-ASM-002.

## 2026-08-01T16:35:12Z — NK-DIS-001

- **Estado anterior:** READY
- **Estado novo:** DONE
- **Branch:** `main` (somente leitura)
- **Resumo:** desmontagem classificada B; reduz configuração e devolve servo/kit, com saldo montado validado, locks, idempotência, recibo e rollback atômico.
- **Validações:** wrappers, worker, aliases, movimentos e permissões revisados.
- **Commit:** não aplicável
- **Push:** não aplicável
- **PR:** não aplicável
- **Bloqueios:** apenas integração de aplicação; validações visual e operacional futuras.
- **Próxima ação:** priorizar NK-DIS-002.

## 2026-08-01T16:35:12Z — NK-ORD-001

- **Estado anterior:** READY
- **Estado novo:** DONE
- **Branch:** `main` (somente leitura)
- **Resumo:** leitura e retirada classificadas A; edição de Pedido ativo, linhas, finalização e entrada classificadas B; rascunho, negociação duplicada e cancelamento pela Assistente classificados D.
- **Validações:** schema, snapshots, eventos, locks, idempotência, concorrência, finalização, cancelamento e entrada revisados.
- **Commit:** não aplicável
- **Push:** não aplicável
- **PR:** não aplicável
- **Bloqueios:** decisões DEC-ORD-001, DEC-ORD-002 e DEC-ORD-003.
- **Próxima ação:** resolver decisões antes de NK-ORD-002, NK-ORD-003 ou NK-ORD-005.

## 2026-08-04T03:19:17Z — NK-AUTO-001 / NK-OUT-002

- **Estado anterior:** PR_READY
- **Estado novo:** DONE
- **Branch:** `main`
- **Resumo:** framework da esteira e saída manual pela Assistente revisados e mesclados; PR #1 e PR #2 concluídos.
- **Validações:** `main` sincronizada em `4d5b67f8ad48dfa471269d5a92246bf260a404ff`; worktree limpa antes do próximo objetivo.
- **Commit:** merge `4d5b67f8ad48dfa471269d5a92246bf260a404ff` para o PR #2
- **Push:** realizado pelo merge aprovado
- **PR:** https://github.com/henriqueskm/projeto-estoque/pull/2
- **Bloqueios:** nenhum para o encerramento da saída.
- **Próxima ação:** registrar as validações humanas e iniciar o próximo objetivo READY.

## 2026-08-04T03:19:17Z — NK-OUT-003 / NK-OUT-004

- **Estado anterior:** BLOCKED_VISUAL_VALIDATION / BLOCKED_OPERATIONAL_TEST
- **Estado novo:** DONE / DONE
- **Branch:** `codex/assistant-manual-stock-output`
- **Resumo:** saída manual validada visualmente; teste operacional controlado e smoke test de produção aprovados sem duplicidade.
- **Validações:** prévia, confirmação e resultado conferidos; exatamente uma movimentação para a solicitação autorizada, sem replay ou baixa duplicada.
- **Commit:** não aplicável
- **Push:** não aplicável
- **PR:** https://github.com/henriqueskm/projeto-estoque/pull/2
- **Bloqueios:** nenhum.
- **Próxima ação:** NK-ASM-002.

## 2026-08-04T03:38:11Z — NK-ASM-002

- **Estado anterior:** READY
- **Estado novo:** WAITING_HUMAN_REVIEW
- **Branch:** `agent/assistant-assembly`
- **Resumo:** montagem pela Assistente implementada com parser determinístico, resolução server-side, prévia/resultado estruturados, token HMAC, rota POST fixa, idempotência e confirmação somente por botão.
- **Validações:** 10 testes de montagem, 22 testes de regressão da saída, 17 testes de regressão da entrada, lint, TypeScript, build e `git diff --check` aprovados.
- **Commit:** `b54eba3fed31c285d96dcdbc26801fb17596746c`
- **Push:** branch enviada e sincronizada
- **PR:** https://github.com/henriqueskm/projeto-estoque/pull/3 (draft)
- **Bloqueios:** validação visual e teste operacional real exigem aprovação humana; merge não autorizado.
- **Próxima ação:** publicar PR draft e aguardar revisão autenticada sem executar montagem real.

## 2026-08-04T04:17:09Z — NK-ASM-002

- **Estado anterior:** WAITING_HUMAN_REVIEW
- **Estado novo:** DONE
- **Branch:** `main`
- **Resumo:** montagem validada visual e operacionalmente; PR #3 mesclado e smoke test de produção aprovado sem duplicidade ou efeito colateral.
- **Validações:** exatamente um POST e uma operação `ASSEMBLY/MANUAL`; configuração 1H `4 → 5`, Servo 1DESL `4 → 3` e Kit KT-29 `3 → 2`; um batch, uma operação, dois movimentos físicos e um movimento de configuração; nenhuma alteração em Pedido, entrada, saída, catálogo ou outro saldo.
- **Commit:** merge `2038b232ab1d0deb5aed793587a97165f79a962a`
- **Push:** realizado pelo merge aprovado
- **PR:** https://github.com/henriqueskm/projeto-estoque/pull/3
- **Bloqueios:** nenhum.
- **Próxima ação:** NK-SAF-001.

## 2026-08-04T04:17:09Z — NK-SAF-001

- **Estado anterior:** READY
- **Estado novo:** WAITING_HUMAN_REVIEW
- **Branch:** `agent/safisa-portal-audit`
- **Resumo:** banco, Auth, perfis, Pedidos, views, RLS, grants e RPCs auditados somente por leitura; arquitetura do Portal Safisa especificada.
- **Validações:** 22 migrations alinhadas; projeto `isdjboconmwaqipjrjvp`; 2 perfis ativos, 6 Pedidos, 17 linhas e 19 eventos; invariantes atuais íntegras; nenhuma estrutura de prontidão existente.
- **Classificação:** C/D — exige migration/RPC e decisões humanas sobre provisionamento, publicação, correção, retirada, cancelamento, histórico e URL.
- **Commit:** pendente
- **Push:** pendente
- **PR:** pendente
- **Bloqueios:** DEC-SAF-001 a DEC-SAF-008 e aprovação de MIG-SAF-001.
- **Próxima ação:** revisar `docs/SAFISA_PORTAL_SPEC.md` e decidir os bloqueios antes de qualquer implementação.

## 2026-08-04T04:39:34Z — NK-SAF-001

- **Estado anterior:** WAITING_HUMAN_REVIEW
- **Estado novo:** WAITING_HUMAN_REVIEW
- **Branch:** `agent/safisa-portal-audit`
- **Resumo:** DEC-SAF-001 a DEC-SAF-008 aprovadas; MIG-SAF-001 detalhada exclusivamente em documentação, sem SQL ou implementação.
- **Validações:** decisões registram contas individuais, provisionamento administrativo, publicação explícita, prontidão concorrente, correção controlada, retirada somente do pronto, cancelamento seguro, histórico somente leitura e portal isolado em `/safisa`.
- **Commit:** pendente neste registro
- **Push:** pendente neste registro
- **PR:** https://github.com/henriqueskm/projeto-estoque/pull/4 (draft)
- **Bloqueios:** revisão e autorização específica da MIG-SAF-001; alteração remota de signup continua não autorizada.
- **Próxima ação:** revisar o contrato documental e somente depois autorizar ou rejeitar a criação da migration.

## 2026-08-05T01:18:38Z — NK-SAF-001 / MIG-SAF-001

- **Estado anterior:** NK-SAF-001 `WAITING_HUMAN_REVIEW`; MIG-SAF-001 autorizada para escrita local.
- **Estado novo:** NK-SAF-001 `DONE`; MIG-SAF-001 `WAITING_HUMAN_REVIEW`.
- **Branch:** `agent/safisa-portal-migration`
- **Resumo:** PR #4 mesclado em `main`; contrato aprovado transformado em uma migration única para membership, publicação explícita, prontidão, auditoria/idempotência, isolamento, RPCs fixas e endurecimento de retirada/edição/cancelamento.
- **Validações:** base `6beeb4e16d36b5591ffa5b26db95b16229fea5d8`; 22 migrations anteriores alinhadas antes da criação; teste estático de contrato e `git diff --check` aprovados; SQL não executado.
- **Migration:** `supabase/migrations/20260804044500_safisa_portal_foundation.sql`, criada e não aplicada.
- **Banco remoto:** inalterado; signup público inalterado; nenhuma conta Safisa criada; nenhum Pedido publicado.
- **Portal:** não implementado.
- **Commit:** pendente neste registro.
- **Push:** pendente neste registro.
- **PR:** draft pendente.
- **Bloqueios:** revisão humana integral do SQL; aplicação remota exige nova autorização explícita.
- **Próxima ação:** revisar a MIG-SAF-001 no PR draft e permanecer em `WAITING_HUMAN_REVIEW`.

## 2026-08-06 — MIG-HIST-001

- **Estado anterior:** AUDITING
- **Estado novo:** WAITING_HUMAN_REVIEW
- **Branch:** `agent/migration-history-reproducibility-audit`
- **Resumo:** falha histórica reproduzida em Supabase local descartável; carga mestre gera UUIDs aleatórios e a correção posterior exige UUIDs fixos.
- **Validações:** pontos de corte `20260716000925`, `20260716002426` e `20260718134339` aplicados; `20260718175621` falhou com SQLSTATE `23514`; 24 UUIDs fixos e o grafo de FKs foram inventariados.
- **Commit:** `657bec0523402d790f2b63363c7a376032efcf0b`
- **Push:** branch enviada e sincronizada.
- **PR:** https://github.com/henriqueskm/projeto-estoque/pull/6 (draft)
- **Bloqueios:** escrita da migration-ponte, alinhamento do histórico remoto e retomada da MIG-SAF-001 exigem aprovação humana.
- **Próxima ação:** revisar `docs/MIGRATION_HISTORY_REPRODUCIBILITY.md`.

## 2026-08-06 — MIG-HIST-002

- **Estado anterior:** IMPLEMENTING
- **Estado novo:** ABANDONED_BY_DECISION
- **Branch:** `agent/historical-catalog-identity-bridge`
- **Resumo:** a ponte aprovada de 19 identidades corrigiu o primeiro bloqueio, mas o reset local revelou outras 72 configurações históricas exigidas pela migration de imagens.
- **Validações:** `20260718175621` passou localmente; `20260718191812` abortou de forma segura; nenhum acesso remoto ocorreu.
- **Backup:** WIP preservado em stash local e removido da worktree; nenhum commit ou push da ponte.
- **Motivo:** custo e risco desproporcionais de ampliar o remapeamento para 91 identidades.
- **Próxima ação:** substituir a reconstrução histórica por baseline local do estado atual.

## 2026-08-06 — MIG-BASE-001

- **Estado anterior:** READY
- **Estado novo:** WAITING_HUMAN_REVIEW
- **Branch:** `agent/current-state-baseline`
- **Pull request:** [#7](https://github.com/henriqueskm/projeto-estoque/pull/7) — draft
- **Resumo:** schema atual e catálogo referencial sanitizado materializados fora de `supabase/migrations`, com restaurador estritamente local.
- **Allowlist:** oito tabelas públicas referenciais e metadado fixo do bucket privado; nenhuma pessoa, Pedido, saldo, movimento, lote, evento ou objeto de Storage.
- **Validações:** duas reconstruções independentes equivalentes; assinaturas de schema e catálogo idênticas; sete cenários negativos aprovados; containers removidos.
- **Remoto:** somente dumps de leitura de schema `public/private` e dados da allowlist; nenhuma escrita, `db push`, `migration repair` ou alteração remota.
- **Próxima ação:** revisão humana do PR draft; PR #5 continua bloqueado e inalterado.

## 2026-08-06 — MIG-SAF-001

- **Estado anterior:** WAITING_HUMAN_REVIEW, bloqueada pela ausência de baseline reproduzível.
- **Estado novo:** WAITING_HUMAN_REVIEW, validada dinamicamente em Supabase Local.
- **Branch:** `agent/safisa-portal-migration`.
- **Base integrada:** PR #7 mesclado na `main` em `883ffa6de5024b8f2d27b1b0be2c047dacd7ae64`.
- **Migration:** `20260804044500_safisa_portal_foundation.sql`, sem renomeação e sem aplicação remota.
- **Correções reais:** alias SQL reservado `authorization` substituído por `order_authorization`; dumps do baseline fixados como LF para preservar hashes aprovados em checkout Windows; filtragem de diagnóstico local refinada sem expor segredos.
- **Validações dinâmicas:** grupos A–H aprovados para membership, publicação/revogação, prontidão, correção absoluta, retirada interna, cancelamento/edição, auditoria e permissões/RLS.
- **Concorrência:** cinco cenários com duas conexões PostgreSQL reais aprovados — dois incrementos, incremento versus correção, duas retiradas, retirada versus incremento e correção versus retirada — sem `lost update` ou violação das invariantes.
- **Reconstruções:** duas execuções independentes de baseline + MIG-SAF-001 produziram `SchemaSignature 99ee80fb616ac2849204dd63dd4954ae` e `CatalogSignature 9e010282ce86835cb5973da9b50a5d52`.
- **Regressões:** testes estáticos Safisa e baseline, oito testes negativos locais do baseline, Assistente Entrada/Saída/Montagem, lint, TypeScript, build e `git diff --check` aprovados.
- **Remoto:** nenhum acesso ao Supabase remoto, `db push`, `migration repair`, conta Safisa, publicação de Pedido ou operação real.
- **Pull request:** [#5](https://github.com/henriqueskm/projeto-estoque/pull/5) permanece draft.
- **Próxima ação:** revisão humana do PR #5; aplicação remota continua não autorizada.

## 2026-08-07 — MIG-SAF-003

- **Estado anterior:** MIG-SAF-001 mesclada, com aplicação remota bloqueada pelo gate de Pedidos ativos.
- **Estado novo:** WAITING_HUMAN_REVIEW.
- **Branch:** `agent/safisa-legacy-order-transition`.
- **Pull request:** [#8](https://github.com/henriqueskm/projeto-estoque/pull/8) — draft.
- **Migration:** `20260807091653_safisa_legacy_order_transition.sql`.
- **Decisão:** DEC-SAF-009 aprovada — ausência de autorização preserva retirada legada; a primeira publicação torna o Pedido Safisa-managed permanentemente; revogação não restaura o regime legado.
- **Comportamento legado:** retirada mantém os limites históricos e autoavança `ready_quantity` até `picked_quantity` na mesma transação, sem autorização, membership ou evento Safisa implícito.
- **Comportamento gerenciado:** retirada individual e em massa permanece limitada a `ready_quantity`, independentemente de `is_authorized`.
- **Validações dinâmicas:** Safisa A–H, cinco concorrências existentes, transição legado/publicação/revogação, alertas e cinco novas concorrências com duas conexões aprovadas.
- **Reconstruções:** duas execuções independentes produziram `SchemaSignature e5b32608e246d03522d8e06b0cadcf4f` e `CatalogSignature 9e010282ce86835cb5973da9b50a5d52`.
- **Remoto:** nenhum acesso ou escrita; nenhum `db push`, `migration repair`, conta Safisa, publicação real, Pedido ou Estoque alterado.
- **Próxima ação:** revisão humana do PR #8; merge e aplicação remota permanecem proibidos.

## 2026-08-07 — NK-SAF-002

- **Estado anterior:** READY após aplicação remota controlada da MIG-SAF-001 e MIG-SAF-003.
- **Estado novo:** WAITING_HUMAN_REVIEW.
- **Branch:** `agent/safisa-portal-ui`.
- **Resumo:** Portal Safisa MVP implementado em `/safisa`, com login e layout próprios, guard server-side independente do perfil interno, lista/detalhe por RPCs oficiais e ações incrementais/corretivas confirmadas.
- **Segurança:** nenhuma seleção ou escrita direta nas tabelas Safisa; nenhuma conta Safisa real, publicação real, mutação remota, migration, `db push` ou alteração de Auth.
- **Validação local:** usuário sem membership negado; duas contas Safisa independentes; Pedidos publicados compartilhados; ocultos e revogados invisíveis; encerrados somente leitura; incremento, replay/double-submit, correção, conflito e marcação do restante aprovados.
- **Responsividade:** 320, 375, 768 e 1440 px sem overflow horizontal; console do navegador sem erros; foco, labels, estados desabilitados e mensagens `aria-live` verificados.
- **Banco local:** baseline + MIG-SAF-001 + MIG-SAF-003, fixtures exclusivamente fictícias; A–H, cinco concorrências e transição legado aprovadas.
- **Pull request:** [#9](https://github.com/henriqueskm/projeto-estoque/pull/9) (draft).
- **Próxima ação:** revisão humana do PR draft antes de qualquer provisionamento ou publicação do piloto.

## 2026-08-07 — NK-SAF-003

- **Estado novo:** WAITING_HUMAN_REVIEW.
- **Branch:** `agent/safisa-automatic-orders`.
- **Pull request:** [#10](https://github.com/henriqueskm/projeto-estoque/pull/10) (draft).
- **Resumo:** MIG-SAF-004 torna todo Pedido automaticamente Safisa-managed, cria leitores sem autorização por Pedido, separa Portal em Em andamento/Concluídos, aplica prontidão estrita universal e protege cancelamento auditado contra prontidão pendente.
- **Validação local:** baseline + MIG-SAF-001 + MIG-SAF-003 + MIG-SAF-004; A–O aprovados com quatro cenários concorrentes PostgreSQL reais e fixtures fictícias.
- **Remoto:** nenhuma leitura, escrita, `db push`, alteração de Auth, membership, Pedido, Estoque ou RPC remota.
- **Próxima ação:** revisão humana do PR draft antes de qualquer merge ou operação de piloto.

## 2026-08-08 — NK-SAF-003 / NK-SAF-004

- **NK-SAF-003:** `DONE`. PR #10 mesclado em `main` (`3bc7ffc69583d6f97056d477ced59b8486422863`); MIG-SAF-004 aplicada em produção sob protocolo controlado; Portal Safisa validado em produção, incluindo ciclo automático, abas `Em andamento`/`Concluídos` e layout compacto.
- **NK-SAF-004:** auditoria documental concluída em `agent/safisa-pickup-alerts`.
- **Arquitetura:** alertas internos atuais são derivados por `ready_quantity - picked_quantity`; total preparado usa o agregado de `ready_quantity + cancelled_quantity`; cancelados e Pedidos sem retirada pendente não geram alerta.
- **Contratos reutilizáveis:** `supplier_order_summaries`, `supplier_order_item_details`, `safisa_portal_events` e `public.list_safisa_ready_pickup_alerts(p_limit)`; a RPC atual já exige perfil interno ativo e retorna dados por linha suficientes para agrupamento por Pedido.
- **Decisão técnica:** `NO_MIGRATION_REQUIRED`; persistência somente será reavaliada se forem aprovados estados individuais persistentes, como lido/não lido ou dismiss.
- **Escopo desta fase:** nenhuma implementação, migration, consulta ou escrita remota, alteração de Vercel, operação real ou merge.
- **Próxima ação:** revisão humana da UX, do ciclo de alerta e do plano de implementação A–E.

## 2026-08-08 — NK-SAF-004 implementação A–E

- **Estado anterior:** `WAITING_HUMAN_REVIEW` após auditoria documental.
- **Estado novo:** `WAITING_HUMAN_REVIEW` aguardando validação visual humana.
- **Branch:** `agent/safisa-pickup-alerts-implementation`, a partir de `origin/main` em `7783b436072b0864fc29537c96dc6eb01b4f7477`.
- **Dados:** `public.list_safisa_ready_pickup_alerts(500)` é a fonte oficial por linha; uma leitura batelada de `supplier_order_summaries` complementa somente os agregados necessários para distinguir Pedido total e parcialmente preparado, sem N+1.
- **Interface:** sino interno no shell desktop/mobile, painel somente leitura e navegável, bloco condicional na Home, priorização/badge em Pedidos e indicação da quantidade pronta aguardando retirada no detalhe.
- **Atualização:** foco da janela e intervalo de 60 segundos apenas quando a aba está visível; nenhuma atualização global com `router.refresh()`, para não interromper formulários operacionais.
- **Segurança:** endpoint interno somente leitura exige sessão e perfil interno ativo; Portal Safisa não recebe o sino; nenhum service role, estado de lido, tabela de notificações, ação mutável, migration, acesso remoto ou operação real.
- **Próxima ação:** concluir validações locais, criar PR draft e aguardar revisão visual humana.

## 2026-08-08 — NK-ORD-004

- **NK-DIS-002:** `DONE`; PR #13 mesclado, validação visual aprovada e
  Vercel/main green, sem migration necessária.
- **Hardening técnico:** a cobertura local passou a exercitar resolução,
  prévia, token, confirmação mockada, replay, conflito e falha de releitura;
  a releitura também rejeita versão ou elegibilidade alteradas antes de chamar
  a ação oficial.
- **Contrato oficial:** `public.finalize_supplier_order(uuid, timestamptz, text,
  uuid)` exige Pedido `COMPLETED` sem retirada pendente, aplica lock do Pedido e
  linhas, compara `updated_at` integral e registra idempotência/evento.
- **Implementação:** intenção determinística, prévia HMAC curta, confirmação
  exclusiva por botão, endpoint POST fixo e resultado estruturado para a
  finalização; `finalization_note` permanece `null`.
- **Estado novo:** `WAITING_HUMAN_VISUAL_REVIEW`; nenhuma migration, escrita
  remota ou finalização real foi executada.

## 2026-08-08 — NK-SAF-004 / NK-DIS-002

- **NK-SAF-004:** `DONE`. PR #12 mesclado em `main`; produção e Vercel green;
  alertas de retirada Safisa permanecem derivados, sem migration.
- **NK-DIS-002:** implementação local iniciada em `agent/assistant-disassembly` a
  partir de `a6aa8f28eb7b20e82d7ce963b97064979db1b794`.
- **Arquitetura:** desmontagem é ação independente de montagem, com intenção
  determinística, proposta HMAC curta, confirmação exclusiva por botão, rota
  POST fixa e contrato oficial `disassembleCommercialConfiguration`.
- **Segurança:** aliases identificam a configuração física única; proposalToken,
  idempotency key e saldo não são persistidos na conversa; texto não executa.
- **Estado novo:** `WAITING_HUMAN_VISUAL_REVIEW` após validações locais.

## 2026-08-08 — NK-ORD-004 / NK-ORD-006

- **NK-ORD-004:** `DONE`; PR #14 mesclado, com validação visual e teste
  operacional humano aprovados. Nenhuma migration ou alteração de RPC foi
  necessária.
- **NK-ORD-006:** correção local iniciada para a entrada no Estoque a partir de
  Pedido. A projeção de `waiting_stock_quantity` foi incluída na leitura de
  linhas, e a seleção usa exclusivamente `picked_quantity - stocked_quantity`.
- **Execução:** a confirmação HMAC pela rota fixa reutiliza
  `createSupplierOrderStockEntryAction`; a chamada direta duplicada à RPC foi
  removida da Assistente. Permanecem a revalidação, a idempotência e o recibo
  oficial.
- **Estado novo:** `WAITING_HUMAN_VISUAL_REVIEW`; nenhuma entrada real,
  chamada remota de escrita ou migration foi executada.

## 2026-08-11 — NK-ORD-006 / NK-ORD-007

- **NK-ORD-006:** `DONE`; PR #15 mesclado em `main`. A projeção de
  `waiting_stock_quantity`, as entradas individual e total, a prévia e a
  confirmação real foram validadas. Pedido e Estoque permaneceram consistentes
  e nenhuma migration foi necessária.
- **NK-ORD-007:** auditoria de retirada com entrada automática concluída em
  `agent/pickup-auto-stock-audit`, baseada em `origin/main` no commit
  `8f2a044e2fd94a3720ef9800432496f5f2eaf549`.
- **Estado atual:** retirada e entrada por Pedido são transações independentes.
  A retirada altera `picked_quantity` e grava evento; a entrada posterior usa
  `picked_quantity - stocked_quantity`, cria batch `INBOUND/MANUAL`, movimentos,
  vínculos e atualiza `stocked_quantity`.
- **Regra aprovada para o desenho:** somente
  `new_picked_quantity - previous_picked_quantity` entra automaticamente. O
  backlog anterior permanece inalterado e continua sendo regularizado pelo
  NK-ORD-006.
- **Bloqueio arquitetural:** duas RPCs não oferecem atomicidade e os eventos de
  Pedido possuem unicidade por usuário/chave. Uma chave não pode representar
  ingenuamente `PICKED_QUANTITY_CHANGED` e `STOCK_ENTRY_CREATED`, enquanto duas
  chaves permitiriam sucesso parcial ou duplicidade.
- **Recomendação:** migration com worker privado composto e uma única fronteira
  de idempotência; wrappers canônicos de retirada delegam a esse worker, que
  reutiliza um primitive privado compartilhado de entrada física. O evento de
  retirada permanece como ledger primário, e entrada/batch/movimentos preservam
  a trilha técnica.
- **Safisa:** toda prévia e execução deve limitar o novo delta a
  `ready_quantity - picked_quantity`. Foi registrada a lacuna atual da prévia da
  Assistente que ainda usa `ordered_quantity - cancelled_quantity` em parte do
  caminho e deve ser corrigida na implementação.
- **Concorrência:** ordem recomendada de locks é idempotência, Pedido, linhas em
  UUID crescente, catálogo e saldos físicos em ordem determinística. A versão
  integral do Pedido é validada sob lock; falha em qualquer etapa reverte
  retirada, entrada, saldo e auditoria.
- **Classificação:** C — `MIGRATION_REQUIRED`.
- **Remoto:** nenhuma consulta ou escrita remota, operação real, migration,
  `db push`, alteração de RPC, commit ou merge ocorreu durante a auditoria.
- **Próxima ação:** revisão humana da arquitetura antes da escrita de SQL ou
  código operacional.

## 2026-08-11 — MIG-ORD-007A

- **NK-ORD-007:** `ARCHITECTURE_APPROVED`; PR #16 mesclado em `main` no commit
  `393f989d85a83d0051172d37fffee7e96263b819`.
- **Estado novo:** `WAITING_DB_REVIEW`.
- **Branch:** `agent/atomic-pickup-stock-entry`.
- **Migration:**
  `20260812023500_atomic_supplier_order_pickup_stock_entry.sql`, SHA-256
  `040f6ec6aa50ffd7062f20c2229bd098194662fc245fceff456c95428c39c343`.
- **Arquitetura:** novo primitive privado compartilhado aplica a entrada física;
  retirada individual e `mark_all` passam a lançar somente o delta recém-retirado
  dentro da mesma transação; o standalone do NK-ORD-006 reutiliza o primitive.
- **Backlog:** `picked_quantity - stocked_quantity` anterior permanece
  inalterado. Nenhum backfill ou absorção automática foi criado.
- **Safisa:** o teto é `ready_quantity`; redução de retirada é rejeitada;
  `mark_all` cria um batch e uma entrada para todos os deltas positivos.
- **Idempotência:** o evento de retirada continua como ledger primário; a
  operação composta não cria `STOCK_ENTRY_CREATED` com a mesma chave. Replay e
  conflito de payload foram aprovados localmente.
- **Validação dinâmica:** A–M aprovados, incluindo ITEM, configuração, aliases,
  backlog, redução, mark-all, dois tipos de rollback, standalone, finalização,
  wrappers checked e três concorrências com duas conexões reais.
- **Reconstruções:** duas execuções independentes produziram
  `SchemaSignature 888958aa8d3058dfa0ace13ffe17a02a` e
  `CatalogSignature 9e010282ce86835cb5973da9b50a5d52`.
- **Remoto:** nenhuma leitura ou escrita remota, `db push`, migration aplicada,
  retirada real, entrada real, alteração de Auth/Vercel ou merge.
- **Próxima ação:** revisão humana do SQL e dos testes antes de qualquer
  autorização de aplicação remota ou integração da UI/Assistente.

## 2026-08-12 — NK-ORD-007B

- **MIG-ORD-007A:** `DB_REVIEW_APPROVED / NOT_APPLIED_REMOTE`; PR #17 mesclado
  em `main` no commit `bd60909efacf7825c7a0284221535ac1eafaaebd`; migration
  `20260812023500_atomic_supplier_order_pickup_stock_entry.sql` permanece
  pendente no histórico remoto.
- **Estado novo:** `IMPLEMENTED / WAITING_HUMAN_VISUAL_REVIEW`.
- **Branch:** `agent/atomic-pickup-stock-entry-app`.
- **PR draft:** [#18](https://github.com/henriqueskm/projeto-estoque/pull/18).
- **UI tradicional:** redução bloqueada no valor já retirado, teto definido por
  `ready_quantity`, delta positivo e entrada automática exibidos, e retirada
  total renomeada para “Retirar tudo que está pronto”.
- **Assistente:** preview e revalidação usam `ready_quantity - picked_quantity`;
  `increment`, `set_total` e `mark_all` deixam explícita a entrada automática e
  mantêm o backlog histórico separado.
- **Execução:** uma única RPC mutável oficial por confirmação; nenhuma segunda
  chamada de entrada; receipt composto reconhece entrada, batch, quantidade,
  timestamp, delta e replay com compatibilidade para retornos anteriores.
- **Segurança:** HMAC, vínculo ao usuário, expiração, microssegundos,
  idempotência, confirmação por botão e mensagens sanitizadas preservados.
- **Remoto:** zero escrita, zero operação real, zero `db push`, zero migration
  nova e zero alteração de RPC.
- **Preview Vercel:** somente visual e não mutável até aplicação coordenada da
  MIG-ORD-007A; teste operacional aguarda autorização posterior.

## 2026-08-12 — NK-ORD-007B1

- **Estado:** refinamento visual implementado; NK-ORD-007B permanece
  `WAITING_HUMAN_VISUAL_REVIEW` no PR draft #18.
- **Ações globais:** retirada total aparece somente com quantidade pronta
  aguardando retirada; entrada no estoque aparece somente com backlog histórico.
- **Layout:** o rodapé largo foi substituído por dock compacto, sticky e interno
  à região rolável, com retirada como ação principal e regularização como ação
  secundária.
- **Escopo:** nenhuma regra operacional, action, RPC, migration ou estado remoto
  foi alterado.

## 2026-08-12 — NK-ORD-007B2

- **Estado:** compactação mobile implementada no PR draft #18; NK-ORD-007B
  permanece `WAITING_HUMAN_VISUAL_REVIEW`.
- **Mobile:** dock limitado a `17rem`, padding e gap reduzidos, ações empilhadas
  de forma densa e área de toque preservada; uma única ação encolhe naturalmente.
- **Desktop:** composição horizontal anterior preservada a partir de `sm`.
- **Escopo:** somente classes responsivas e testes estruturais; nenhuma regra de
  visibilidade, operação, action, RPC, migration ou estado remoto foi alterado.

## 2026-08-12 — NK-ORD-007C

- **MIG-ORD-007A:** `APPLIED_REMOTE / VERIFIED` no projeto
  `isdjboconmwaqipjrjvp` às 09:15 BRT, usando exclusivamente `supabase db push
  --linked` para a migration `20260812023500_atomic_supplier_order_pickup_stock_entry.sql`.
- **Integridade:** SHA-256
  `040f6ec6aa50ffd7062f20c2229bd098194662fc245fceff456c95428c39c343`;
  histórico local/remoto alinhado e dry-run posterior sem pendências.
- **Contrato remoto:** primitive compartilhado `SECURITY INVOKER`, `search_path`
  vazio e sem EXECUTE para `public`, `anon` ou `authenticated`; workers de linha
  e retirada total chamam o primitive e retornam o receipt da entrada automática.
- **Zero efeito operacional:** `picked_total=17`, `stocked_total=9`, fingerprints
  dos saldos, 46 movement batches, 5 entradas vinculadas, 7 linhas de entrada e
  contagens de movimentos permaneceram idênticos antes/depois; nenhum backfill.
- **NK-ORD-007B:** PR [#18](https://github.com/henriqueskm/projeto-estoque/pull/18)
  mesclado com HEAD aprovado `69df6544d2b7bbf4dbc46d8a44baaea13104f8eb`;
  merge commit `86d3f3ad72ebe129ec2d2cc2ca5099bf9624e815` implantado com sucesso na Vercel.
- **Smoke test:** alias de produção carregou login interno e Safisa; `/pedidos`,
  `/estoque` e a Home redirecionaram corretamente sem sessão. A inspeção
  autenticada não foi contornada.
- **Operações:** nenhuma retirada, entrada, alteração manual de saldo ou
  regularização do backlog foi executada pelo Codex.
- **Estado novo:** NK-ORD-007 `WAITING_HUMAN_OPERATIONAL_TEST`.

## 2026-08-12 — NK-ORD-007D / NK-ORD-007E

- **NK-ORD-007D:** `DONE`; PR
  [#20](https://github.com/henriqueskm/projeto-estoque/pull/20) mesclado em
  `main` no commit `f3f20ca4dfdf2db6df2346fce4fc88fc90fae380`, com validação visual
  aprovada. “Retire N” e “Retirar N” representam incremento direto; comandos
  explícitos de total continuam separados e frases genuinamente ambíguas ainda
  pedem esclarecimento.
- **Teste operacional humano:** o usuário confirmou uma única vez a retirada
  de `1` unidade do `Cód. 11A` no Pedido `1212`. A interface apresentou retirada
  `1`, entrada automática `+1`, total retirado `1` e nenhuma unidade pronta
  restante; a ação global desapareceu após zerar a disponibilidade.
- **Verificação remota read-only:** o Pedido `1212` foi resolvido de forma única;
  a linha `11A` ficou com `ready=1`, `picked=1`, `stocked=1`,
  `waiting_pickup=0` e `waiting_stock=0`.
- **Cadeia auditável:** um único evento `PICKED_QUANTITY_CHANGED` registrou
  `0→1`; uma única entrada vinculada de quantidade `1` criou um único batch
  `INBOUND / MANUAL` e um único movimento da configuração física `0→1`.
  Evento, entrada, batch e movimento compartilham o mesmo instante, usuário e
  chave de idempotência. Não houve duplicidade nem movimento em item avulso.
- **Backlog histórico:** a linha `Cód. 11E` permaneceu com
  `waiting_stock_quantity=1`, comprovando que a operação composta do `11A` não
  absorveu a pendência anterior.
- **Estado final:** MIG-ORD-007A `DONE / APPLIED_REMOTE / VERIFIED`,
  NK-ORD-007B `DONE / MERGED / DEPLOYED` e NK-ORD-007 `DONE`.
- **Próxima prioridade:** NK-ORD-008 — Criar Pedido a partir de foto pela
  Assistente — `READY_FOR_AUDIT`. NK-QA-001 permanece válido, mas foi adiado até
  NK-ORD-008 por decisão explícita de prioridade.
- **Segurança:** toda a verificação utilizou somente `SELECT`; nenhuma nova
  retirada, entrada, alteração de estoque, RPC mutável, migration ou `db push`
  foi executado pelo Codex.

## 2026-08-12 — NK-ORD-008

- **Estado:** `AUDITED / WAITING_ARCHITECTURE_REVIEW`; classificação **D**.
- **Base/branch:** `origin/main` em
  `2d0c7a6802b63eaaa9663f564d3a21ee1d4ebc5e`, branch
  `agent/assistant-photo-order-audit`.
- **Câmera/galeria:** os inputs locais existem e geram preview por object URL,
  mas o anexo não sai do browser. O chat envia apenas JSON textual; não existe
  endpoint multipart/base64 nem resize, MIME real, limite de bytes ou chamada
  multimodal.
- **Amostras reais:** duas fotos foram inspecionadas somente no host, sem upload
  ou persistência. Negociação, `Data Negociação`, códigos, descrições impressas,
  quantidades e ordem das linhas parecem extraíveis. Manuscritos sobrepostos,
  recortes, baixo contraste e caracteres semelhantes exigem revisão humana.
- **Provider:** o projeto já usa Google Gemini Developer API com
  `gemini-3.6-flash`, modelo GA multimodal e com structured output. Recomendado
  preservar esse provider/modelo, `store: false`, imagem inline descartável e
  validação server-side; fallback seguro é nova foto/revisão, não escolha
  automática por outro modelo.
- **Contrato oficial:** `createSupplierOrder` exige sessão, profile interno
  ativo com nome e chama `public.create_supplier_order`. O worker valida o
  catálogo ativo antes da primeira escrita, cria Pedido/linhas, snapshots e
  `ORDER_CREATED` na mesma transação e possui idempotência por usuário/chave.
  O lifecycle Safisa automático é preservado por esse contrato.
- **Catálogo:** somente o backend resolve `ITEM` ou
  `COMMERCIAL_CONFIGURATION`; o código comercial lido é preservado para aliases.
  Zero match, conflito descrição/código ou ambiguidade bloqueiam confirmação;
  fuzzy match não escolhe alvo.
- **Bloqueio:** `negotiation_number` aceita 1–120 caracteres após `trim`, possui
  índice não único e o worker permite duplicatas. Um preflight não elimina
  corrida concorrente. É necessária decisão humana sobre escopo/normalização da
  unicidade; `MIGRATION_REQUIRED = UNCERTAIN` até essa decisão.
- **Arquitetura:** NK-ORD-008A implementará apenas upload, visão, schema,
  catálogo, preview e correção. NK-ORD-008B adicionará HMAC e confirmação por
  botão depois da decisão. NK-ORD-008C fará validação visual e NK-ORD-008D, teste
  operacional controlado.
- **Privacidade/custo:** JPEG/PNG, máximo bruto recomendado de 10 MiB e
  processado de 4 MiB, lado maior até 2.400–2.560 px, uma análise concorrente e
  rate limit por usuário. Estimativa inicial para `gemini-3.6-flash` standard:
  US$ 0,005–0,02/foto, a medir no dataset real. Nenhuma foto deve ir a Storage,
  banco, sessão ou logs.
- **Escopo preservado:** nenhuma migration, RPC, código funcional, Pedido,
  escrita Supabase, configuração Vercel, imagem versionada ou merge.

## 2026-08-12 — NK-ORD-008 / decisão de identidade da negociação

- **Decisão humana aprovada:** a negociação permanece texto, aceita somente
  dígitos ASCII `0–9`, preserva zeros à esquerda e é única globalmente em todos
  os estados do Pedido, inclusive concluído ou cancelado.
- **Comparação:** exata após trim externo; `001212` e `1212` são identidades
  diferentes. Espaços internos, letras, hífens, barras e demais caracteres são
  inválidos. Não há fuzzy matching.
- **Não reutilização:** negociação de Pedido cancelado continua reservada; uma
  negociação já usada nunca pode criar outro Pedido silenciosamente.
- **Classificação nova:** NK-ORD-008 passa de D para **C**, com estado
  `ARCHITECTURE_APPROVED` e `MIGRATION_REQUIRED`.
- **Garantia atômica:** preflight na aplicação continua obrigatório para UX, mas
  não substitui constraint de formato e unicidade global no PostgreSQL.
- **Próxima etapa:** MIG-ORD-008A — unicidade global e contrato numérico da
  negociação. Antes de escrever a migration, auditar read-only duplicatas,
  valores não numéricos, espaços e todo dado legado incompatível, sem alterar
  dados automaticamente.
- **Escopo desta decisão:** somente documentação no PR #21; nenhuma migration,
  RPC, alteração funcional, escrita Supabase ou merge.

## 2026-08-12 — MIG-ORD-008A

- **Estado:** `IMPLEMENTED_LOCAL / WAITING_DB_REVIEW`; branch
  `agent/supplier-order-negotiation-identity`, baseada no merge da PR #21 em
  `97c02174eedb545544c7b8397e1115033dc212bb`; PR draft
  [#22](https://github.com/henriqueskm/projeto-estoque/pull/22).
- **Auditoria remota read-only:** projeto `EstoqueNK`
  (`isdjboconmwaqipjrjvp`) confirmou sete Pedidos, zero duplicata exata, os
  quatro pares ID/negociação aprovados e zero colisão com `99990000`,
  `99990001`, `99990003` e `99990004`.
- **Mapeamento aprovado:** `teste 00 → 99990000` para
  `26e08e22-a2fb-4e8d-8605-4ccdb57d4773`; `teste 01 → 99990001` para
  `db02621b-b6c1-4e7a-8fef-b63fc3e60d50`; `teste 03 → 99990003` para
  `e92bc06f-5721-4082-b77a-def6954e3300`; `Teste 04 → 99990004` para
  `af7a39f6-c4a2-4e92-b183-d8196aa775d1`.
- **Persistência:** as views leem a negociação dinamicamente por UUID. Os 19
  eventos que guardam o valor antigo são snapshots históricos e permanecem
  imutáveis; quatro novos eventos técnicos `ORDER_HEADER_UPDATED` documentam a
  transição sem atribuí-la a usuário humano.
- **Migration:**
  `20260812133046_enforce_supplier_order_negotiation_identity.sql` aplica
  guardas exatas, updates fechados, CHECK ASCII digits-only de 1–120, UNIQUE
  global sem filtro e remove o índice não único redundante somente depois.
- **Contrato oficial:** wrappers públicos mantêm assinatura, autenticação,
  profile ativo, `SECURITY DEFINER`, `search_path` e grants; formato e colisão
  retornam erros sanitizados, enquanto o worker privado preserva idempotência e
  catálogo.
- **Testes locais:** rollback forçado, preservação de itens/quantidades/status/
  finalização/Safisa, instalações com e sem legado, leading zeros, inválidos,
  duplicata, cancelado, finalizado, replay, conflito de payload e concorrência
  com duas conexões foram aprovados. Reconstrução limpa terminou com zero
  Pedidos/eventos e a nova UNIQUE presente; `db lint` retornou zero erro.
- **Remoto:** zero dado alterado, zero migration aplicada, zero Pedido criado,
  zero quantidade/estoque alterados, zero RPC mutável e zero backfill fora do
  mapeamento local aprovado.
- **Próxima ação:** revisão humana do SQL, estratégia de lock e testes antes de
  qualquer autorização separada de aplicação remota. NK-ORD-008B não foi
  iniciado.

## 2026-08-12 — MIG-ORD-008A DB review final

- **Estado novo:** `DB_REVIEW_APPROVED / NOT_APPLIED_REMOTE`; PR #22 pronta
  para revisão humana, sem merge e sem autorização de rollout remoto.
- **Executor comprovado:** Supabase CLI `2.112.0`, resolvida pelo
  `npx --no-install` e executada pelo binário Windows do cache local. O cenário
  principal usou `db push --local --yes`; history e segunda execução foram
  verificados com `migration list --local` e `db push --local --dry-run`.
- **Cenário A:** os quatro legados aprovados foram convertidos, os quatro
  eventos técnicos foram criados e itens, quantidades, lifecycle, Safisa e
  snapshots históricos permaneceram preservados.
- **Cenário B:** a divergência deliberada de uma precondição falhou pelo mesmo
  runner; nenhum update, evento, constraint, wrapper ou registro de history
  ficou parcialmente aplicado.
- **Cenário C:** o rebuild limpo com zero legados aplicou CHECK, UNIQUE e
  wrappers, registrou history uma vez e ficou sem migration pendente.
- **Transação:** `KEEP_EXPLICIT_TRANSACTION = YES`; zero warning relacionado a
  transação, pipeline ou history. O lock bloqueia writers e permite readers;
  não foi adicionado `lock_timeout` após a validação completa do arquivo.
- **Preflight remoto read-only:** projeto `isdjboconmwaqipjrjvp` permaneceu com
  exatamente os quatro pares aprovados, zero colisão dos destinos, zero grupo
  duplicado, zero outro valor incompatível e zero colisão das chaves técnicas.
  Nenhuma RPC mutável ou escrita remota foi executada.
- **Regressões:** identidade estática/local, fundação de Pedidos atualizada ao
  contrato de retirada+entrada atômica, Safisa, finalização, retirada, entrada,
  concorrência/rollback atômicos e `db lint` local foram aprovados. A fixture
  de fundação continua rollback-only e nenhum worker foi alterado.
- **Próxima ação:** revisão humana e merge do PR #22. Qualquer rollout remoto
  exige autorização própria e preflight de produção estrito com exatamente
  4/4 identidades legadas.

## 2026-08-12 — MIG-ORD-008A rollout remoto controlado

- **Estado:** `DONE / APPLIED_REMOTE / VERIFIED`; PR #22 mesclado em
  `88378d524ef70dab51de565ba3bb0ada0c139b8d` e migration `20260812133046`
  alinhada no histórico local/remoto do projeto `EstoqueNK`
  (`isdjboconmwaqipjrjvp`).
- **Integridade:** SHA-256 do conteúdo Git aprovado
  `24160a71dc7501f5f65a08668c082a5b1836bd85d29b6eed9bf031bd603c9dc9`;
  arquivo e migrations históricas permaneceram inalterados.
- **Preflight:** sete Pedidos; 4/4 pares legados exatos; zero colisão dos novos
  números; zero duplicata, incompatibilidade adicional ou colisão das chaves
  técnicas; zero writer ativo e zero evento recente de Pedido na janela final.
- **Aplicação:** Supabase CLI `2.112.0`; dry-run listou somente
  `20260812133046_enforce_supplier_order_negotiation_identity.sql`; um único
  `db push --linked` foi executado entre 16:38:16 e 16:38:41
  (America/São_Paulo); dry-run posterior ficou vazio.
- **Resultado:** os quatro UUIDs foram preservados e as negociações passaram a
  `99990000`, `99990001`, `99990003` e `99990004`. `updated_at` avançou nos
  quatro registros pelo trigger vigente, sem alteração de lifecycle ou
  quantidades.
- **Auditoria:** exatamente quatro eventos `ORDER_HEADER_UPDATED`, com
  `user_id = NULL`, snapshot `MIG-ORD-008A`, motivo
  `legacy_negotiation_identity_migration` e pares anterior/novo corretos.
- **Contrato remoto:** `negotiation_number` continua `TEXT NOT NULL`; CHECK
  ASCII digits-only de 1–120 e UNIQUE global não parcial estão presentes; o
  índice comum anterior foi removido. Wrappers de criação/edição continuam
  `SECURITY DEFINER`, `search_path` vazio, com EXECUTE apenas para
  `authenticated` e `service_role`, sem `anon`/`PUBLIC`.
- **Preservação:** itens, quantidades, status, finalização, cancelamento,
  vínculos Safisa, stock entries, lotes, movimentos, saldos físicos e todos os
  eventos anteriores mantiveram contagens, totais e fingerprints. Nenhum Pedido,
  retirada, entrada de Estoque ou operação Safisa foi executado.
- **Próxima etapa:** NK-ORD-008B — foto → Gemini → validação → preview, sem
  criação real de Pedido.
## 2026-08-12 — NK-ORD-008B / implementação da prévia por foto

- **Base:** `origin/main` em
  `56cf09f9a0e7bcb7503ef58512112969aa19af7b`, contendo os PRs #22 e #23 e o
  rollout verificado de MIG-ORD-008A.
- **Branch:** `agent/assistant-photo-order-preview`.
- **PR:** [#24](https://github.com/henriqueskm/projeto-estoque/pull/24) (draft).
- **Escopo:** câmera/galeria/arquivo → preparação client-side → multipart
  same-origin → Gemini 3.6 Flash com structured output → validação server-side
  contra catálogo → `supplier_order_photo_preview`.
- **Segurança:** arquivo somente em memória; MIME + magic bytes; limite de
  3,9 MB no servidor; profile interno ativo; `store: false`; zero ferramenta;
  prompt visual tratado como dado; zero fuzzy matching; zero UUID exposto;
  zero imagem/base64/token em storage ou logs.
- **Contrato visual:** estados `READY_FOR_REVIEW`, `NEEDS_REVIEW`,
  `DUPLICATE_NEGOTIATION`, `NOT_A_SUPPLIER_ORDER`, `UNREADABLE` e `ERROR`,
  sempre com banner explícito de que nenhum Pedido foi criado.
- **Bloqueio operacional:** esta etapa não contém proposal token, botão de
  criação, rota de confirmação, import de `createSupplierOrder`, RPC mutável ou
  escrita no Supabase.
- **UX tradicional:** negociação continua `text`, com `inputMode=numeric`,
  pattern digits-only e a mesma validação preventiva na Server Action; zeros à
  esquerda permanecem significativos.
- **Estado:** `IMPLEMENTED / WAITING_HUMAN_PHOTO_REVIEW`.
- **Próxima etapa:** NK-ORD-008C, validação visual com fotos reais controladas.
  NK-ORD-008D só poderá habilitar confirmação/criação após nova autorização.

## 2026-08-12 — MIG-ORD-008C3A / contrato catalog-only de Peça avulsa

- **Base:** `origin/main` em
  `03a4e7840c92a96ca2b0872ddf3ccf291134aa26`, merge do PR #24; commit
  `b6cfcad6feed1b718150e4ac44345639bea42089` alcançável.
- **Branch:** `agent/catalog-only-loose-part-creation`.
- **PR:** [#25](https://github.com/henriqueskm/projeto-estoque/pull/25) (draft).
- **Estado:** `IMPLEMENTED_LOCAL / WAITING_DB_REVIEW`.
- **Migration:**
  `20260812223114_add_catalog_only_loose_part_creation.sql`, incremental e sem
  alteração de migrations históricas.
- **Contrato:** `public.create_loose_part(text, text)` exige autenticação e
  profile interno ativo com nome; `private.resolve_or_create_loose_part`
  centraliza trim, limites, lock, colisões, subtipo, estado ativo e descrição.
- **Autoria:** `items.created_by` e `created_by_name_snapshot` são nulos para o
  legado e obrigatoriamente preenchidos pelas novas criações catalog-only e
  `NEW_LOOSE_PART`.
- **Separação física:** cadastro catalog-only cria somente `items` e
  `loose_parts`; não cria `stock_balances`, lotes, movimentos ou Pedidos. Saldo
  é lido como zero pelos loaders oficiais, que tratam a ausência de balance
  como quantidade zero.
- **Compatibilidade:** `private.stock_inbound_lines_with_loose_parts` passou a
  reutilizar a primitiva e continua chamando o worker oficial de inbound uma
  única vez, com replay idempotente e saldo correto.
- **Validação local:** duas reconstruções independentes tiveram assinaturas de
  schema e catálogo idênticas; 7 testes estáticos e 21 cenários dinâmicos
  passaram, incluindo duas conexões concorrentes e rollback forçado do subtipo.
  Regressões de Entrada, Saída, montagem, desmontagem, foto e Pedidos passaram;
  `db lint` local retornou zero erro.
- **Remoto:** nenhuma migration aplicada, item/Pedido criado, saldo alterado ou
  RPC mutável chamada.
- **Próxima etapa:** NK-ORD-008C3B — modal “Cadastrar peça avulsa” na prévia da
  foto, bloqueado até DB review e rollout separado. Criação real de Pedido
  continua bloqueada.

## 2026-08-12 — MIG-ORD-008C3A / DB review final

- **Estado:** `DB_REVIEW_APPROVED / NOT_APPLIED_REMOTE`.
- **Preflight remoto somente leitura:** 3 profiles totais, 2 ativos, zero
  profile ativo sem nome e zero colisões exatas entre `items.code` e
  `commercial_configuration_codes.code`; nenhuma mutação remota foi executada.
- **Autoria:** `items_created_by_idx` cobre a FK; os quatro estados permitidos
  foram testados e `ON DELETE SET NULL` preservou o snapshot nominal após a
  exclusão local do profile.
- **Namespace compartilhado:** preflight rejeita colisão existente; uma única
  função-trigger privada nos dois catálogos usa o mesmo advisory lock por
  código para proteger `INSERT` e `UPDATE` nos dois sentidos. A auditoria
  encontrou apenas writers históricos/de referência para códigos comerciais e
  nenhum writer mutável da aplicação.
- **Validação local:** corrida cruzada em duas conexões, ordem commercial-first
  e item-first, UPDATE nos dois sentidos e replay inbound com payload divergente
  passaram. Supabase CLI 2.112.0 aplicou a migration exatamente uma vez e
  retornou dry-run vazio; o cenário incompatível falhou com rollback integral
  de história e objetos.
- **Separação física:** cadastro catalog-only permaneceu com zero lote,
  movimento, entrada de Pedido ou saldo; `NEW_LOOSE_PART` tradicional continuou
  criando exatamente um inbound e seu replay não duplicou efeito.
- **Próxima etapa:** rollout remoto controlado separado; depois,
  NK-ORD-008C3B — modal/bottom sheet “Cadastrar peça avulsa”.

## 2026-08-13 — MIG-ORD-008C3A / rollout remoto final

- **Base:** `main` em `e2e95bd76cff530d5b6c61dc6174f9c4360d47f4`, merge
  do PR #25.
- **Estado:** `DONE / APPLIED_REMOTE / VERIFIED`.
- **Projeto:** `EstoqueNK` (`isdjboconmwaqipjrjvp`).
- **Migration:** `20260812223114_add_catalog_only_loose_part_creation.sql`,
  SHA-256 canônico
  `a15b6f21be76843f7c4be7a56d03cc205cbe2e24a2d0cc8ce8ef5e68b64b3e3f`.
- **Preflight:** 2 profiles ativos, zero ativo sem nome, zero colisão exata de
  namespace e somente a migration autorizada no dry-run.
- **Aplicação:** um único `db push --linked`, entre 11:46:27 e 11:46:34 BRT;
  histórico com uma ocorrência e dry-run posterior vazio.
- **Contrato remoto:** colunas, FK `ON DELETE SET NULL`, check de autoria,
  `items_created_by_idx`, wrapper público, primitiva privada, grants e os dois
  triggers compartilhados foram introspectados e aprovados. O inbound continua
  delegando à primitiva e ao worker oficial, sem `INSERT` paralelo em `items`.
- **Integridade:** counts e fingerprints de catálogo, saldos físicos,
  movimentos, Pedidos e entradas de Pedido ficaram idênticos antes/depois;
  `db lint --linked` retornou zero erro.
- **Efeito operacional:** zero peça/item/Pedido criado ou alterado, zero entrada,
  movimento, saldo ou operação Safisa. O único write remoto foi a migration.
- **Warning:** a CLI não conseguiu cachear o catálogo localmente porque o Docker
  Desktop estava indisponível; o push remoto concluiu com sucesso e todas as
  verificações posteriores passaram.
- **Próxima etapa:** NK-ORD-008C3B — modal/bottom sheet “Cadastrar peça avulsa”
  na prévia de Pedido por foto; criação real de Pedido continua fora do escopo.

## 2026-08-13 — NK-ORD-008C3B / correção e cadastro na prévia da foto

- **Base:** `origin/main` em `351962c18e1c1d091d371e27f2c773e4a30eae71`.
- **Branch:** `agent/assistant-photo-loose-part-registration`.
- **PR:** [#27](https://github.com/henriqueskm/projeto-estoque/pull/27) (draft).
- **Estado:** `IMPLEMENTED / WAITING_HUMAN_TEST`.
- **Contrato da prévia:** motivos bloqueantes tipados distinguem código ausente,
  desconhecido, ambíguo ou incerto, conflito, quantidade e revisão visual.
- **Correção:** consulta exata e read-only reutiliza o catálogo oficial; não há
  fuzzy matching nem nova chamada Gemini.
- **Cadastro:** endpoint estrito, same-origin e autenticado chama somente
  `public.create_loose_part(code, description)`; `created=true` e replay
  compatível são sucesso.
- **UX:** modal desktop/bottom sheet mobile pré-preenchido, tipo fixo Peça
  avulsa, foco restaurado e duplo envio bloqueado.
- **Separação operacional:** a mensagem existente é atualizada sem persistir a
  imagem; nenhuma criação de Pedido, entrada, saldo, lote ou movimento foi
  habilitada.
- **Próxima etapa:** NK-ORD-008D permanece separada e depende de validação
  humana desta fase.
- **Hardening C3B1:** linhas desconhecidas inequivocamente logísticas ou de
  cobrança são classificadas server-side como `NON_STOCK_CHARGE`, excluídas do
  total e mantidas apenas como warning informativo. Match exato de catálogo
  sempre prevalece; produtos físicos desconhecidos continuam registráveis.

## 2026-08-13 — NK-ORD-008D / criação segura a partir da prévia da foto

- **Base:** `origin/main` em `cb1f82c2e8402eab6a794f210efb7207097d8b61`,
  merge do PR #27 e do commit funcional aprovado `1b0d3d3...`.
- **Branch:** `agent/assistant-photo-order-create`.
- **PR:** [#28](https://github.com/henriqueskm/projeto-estoque/pull/28) (draft).
- **Estado:** `IMPLEMENTED / WAITING_HUMAN_CREATE_TEST`.
- **Fechamento C3B:** `DONE / HUMAN_TEST_APPROVED / MERGED`; correção exata,
  cadastro catalog-only e exclusão de encargos foram preservados.
- **Preparação:** endpoint fixo e same-origin aceita somente negociação, data e
  linhas código/quantidade, exige profile ativo com nome, re-resolve o catálogo
  exato e recusa duplicidade antes de assinar.
- **Proposta:** HMAC-SHA256 com ação específica, versão, user binding, validade
  de dez minutos e idempotency key criada no servidor; limite da criação por
  foto em 100 linhas e token/body próprios de até 64/70 KiB.
- **Confirmação:** endpoint fixo aceita exatamente `proposalToken`, revalida
  usuário, tempo e identidade atual de cada target e reutiliza a Server Action
  oficial `createSupplierOrder`/`public.create_supplier_order`.
- **UX:** primeiro clique apenas prepara; modal desktop/bottom sheet mobile
  mostra resumo canônico. Somente “Confirmar criação” executa, com bloqueio de
  duplo clique, foco, Escape, Tab trap, backdrop e retorno de foco.
- **Persistência:** token fica somente em memória e não entra na conversa. O
  resultado persistível contém negociação, totais, status e link interno, sem
  UUID exposto na apresentação.
- **Segurança operacional:** zero Gemini na preparação/confirmação, nenhuma
  foto/base64 persistida, `notes = null`, nenhuma movimentação de Estoque e
  nenhuma operação Safisa.
- **Testes:** contrato estrito, leading zeros, catálogo exato, unknown,
  ambiguidade, duplicidade, token adulterado/expirado/cruzado, mudança de
  catálogo, replay, corrida de negociação e transport uncertainty cobertos por
  mocks locais. Nenhum Pedido remoto foi criado.
- **Próxima etapa:** revisão do PR draft e um teste humano controlado separado.

## 2026-08-13 — NK-ORD-008D / teste humano e verificação remota

- **PR:** [#28](https://github.com/henriqueskm/projeto-estoque/pull/28) (draft).
- **Estado:** `HUMAN_CREATE_TEST_PASSED / REMOTE_VERIFIED`.
- **Pedido:** negociação `40959`, data `2026-07-22`, status `PENDING`, quatro
  linhas e cinco unidades.
- **Linhas:** `6F × 1`, `10A × 1`, `091 × 1` e `091/VF × 2`; zero linha
  `FR-01` ou descrição de frete/SEDEX.
- **Catálogo:** snapshots das quatro linhas coincidem com o catálogo oficial;
  `091` e `091/VF` são Peças avulsas ativas, catalog-only e saldo efetivo zero.
- **Auditoria:** exatamente um `ORDER_CREATED`, com usuário real, snapshot de
  nome e idempotency key UUID válida; request/result registram quatro linhas e
  cinco unidades.
- **Sem efeitos laterais:** `picked = 0`, `stocked = 0`, `ready = 0`; zero stock
  entry, linha de entrada, batch ou movimento vinculado; zero authorization ou
  evento Safisa.
- **Método:** somente consultas `SELECT` no projeto remoto vinculado; nenhuma
  RPC mutável, edição, retirada, entrada, migration, repair ou seed.
- **Próxima etapa:** revisão humana para merge; o PR permanece draft.

## 2026-08-13 — NK-ORD-009 / redesign responsivo do detalhe do Pedido

- **Base:** `origin/main` em `a3212135e521b58a3733ac6920972f93b1413d98`,
  merge do PR #28.
- **Branch:** `agent/supplier-order-detail-responsive-redesign`.
- **Estado:** `DETAIL_RESPONSIVE_REDESIGN / WAITING_HUMAN_UI_TEST`.
- **Desktop/tablet largo:** tabela semântica full-width com identidade do item,
  cinco métricas e retirada na mesma linha.
- **Mobile:** blocos compactos sem overflow horizontal, métricas em grades 3+2
  e controle de retirada com alvo de toque preservado.
- **Hierarquia:** “Disponível agora” tem prioridade operacional; “Pronto
  Safisa” continua visível como informação secundária.
- **Ação:** botão curto “Retirar” com ícone e nome acessível completo; a entrada
  automática no estoque é explicada uma única vez no cabeçalho dos itens.
- **Escopo:** somente apresentação e testes estruturais; cálculos, ações, RPCs,
  migrations, idempotência e concorrência permaneceram inalterados.
- **Próxima etapa:** validação visual humana read-only nos breakpoints móveis,
  tablet e desktop.
