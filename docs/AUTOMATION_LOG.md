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
