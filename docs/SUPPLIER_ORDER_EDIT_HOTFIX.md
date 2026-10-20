# Issue #91 — hotfix de persistência na edição de Pedidos

## Causa comprovada (20/10/2026)

Base: `7be338b7151317ca46cda7618780dabfb14d6220` (main após #90).
Leitura autorizada, somente metadados/DDL, do projeto EstoqueNK confirmou o
defeito em **`private.update_supplier_order` realmente implantada**. MD5 do
corpo sem whitespace: `7bffbdd9664b07987b160e4feee73c10`, igual ao baseline e
ao writer reproduzido no PostgreSQL 17.6 local.

O editor corretamente omite `id` de novas linhas. O writer insere IDs gerados
e, depois, executava DELETE de todas as linhas cujos IDs não estavam no payload.
Isso apagava também as novas linhas, ainda na mesma transação. Recibo/audit eram
calculados depois dessa perda, sem erro SQL: por isso aparecia sucesso mesmo
após atualizar a página inteira. Não era apenas cache/refresh.

Prova local antes da correção: Pedido com duas linhas + ITEM novo + configuração
com alias = **quatro linhas solicitadas, sucesso com `line_count=2`**; SELECT de
outra conexão depois do COMMIT também retornou duas linhas. Nenhum Pedido real
foi criado/editado para investigar.

## Correção pequena e forward-only

Migration: `20261020132636_fix_supplier_order_edit_line_persistence.sql`.

- Captura os IDs preexistentes **após** os locks atuais de Pedido/linhas.
- DELETE fica restrito a esses IDs, mantendo remoção legítima de linha antiga
  omitida e não movimentada. Nunca inclui IDs recém-gerados no mesmo save.
- Asserção transacional verifica quantidade de linhas e correspondência exata
  de IDs existentes/targets/alias/posição/quantidade/notas antes de gravar sucesso.
  Uma divergência causa rollback de header, itens e eventos.
- Não muda wrapper público, assinatura, autenticação, idempotência, lock order,
  snapshots, políticas RLS, triggers ou writers de estoque. Função privada segue
  invoker, `search_path=''` e sem execute para PUBLIC/anon/authenticated/service_role.
- Triggers existentes continuam impedindo remoção/troca de target de linha
  pronta Safisa. Guardas de retirado/estocado/cancelado/evento e quantidade
  mínima são mantidas. Pedidos finalizados/cancelados continuam imutáveis.

Na aplicação, `updateSupplierOrder` só retorna sucesso após validar o recibo e
uma releitura autenticada do header/linhas com correspondência exata do pedido
normalizado. Não faz segundo writer nem atualiza tabelas diretamente. Falhas
registram somente rota, estágio, SQLSTATE validado, classe técnica fixa e duração;
nunca mensagem bruta, conteúdo, IDs, negociação, usuário, token ou descrição.

O editor preserva rascunho/chave em erro/retry. Em stale não fecha silenciosamente
nem sobrescreve: bloqueia Salvar e oferece **Reabrir Pedido atualizado**, que
recarrega o detalhe apenas por escolha explícita. Route Mutation Gate continua
impedindo double submit. Linhas prontas ficam protegidas também no editor.

## Reprodução local segura

Pré-requisito: container local `supabase_db_nk_current_state_baseline` acessível
somente como **fonte de schema**. Preparar um container separado:

```powershell
docker run --name supabase_db_nk_issue91 --label nk.disposable=nk-issue91 --network none -e POSTGRES_PASSWORD=nk91-local-only -d public.ecr.aws/supabase/postgres:17.6.1.165
node scripts/setup-supplier-order-edit-test.mjs
node --test tests/supplier-order-edit-persistence.local.mjs
node --experimental-strip-types --experimental-loader ./tests/supplier-order-stale-conflict-loader.mjs --test tests/supplier-order-edit-persistence.integration.test.mjs
node --experimental-strip-types --experimental-loader ./tests/supplier-order-stale-conflict-loader.mjs --test tests/supplier-order-edit-persistence.test.mjs
```

O setup **recria somente `nk91_test` no container verificado por label e
`network=none`**. Recusa outro destino; não aceita URL remota. Copia apenas DDL
e referência de catálogo versionada, nunca usuários/sessões/Pedidos/saldos da
fonte. Defaults de privilégios dos papéis reservados Supabase são omitidos no
bootstrap; ACLs explícitas/RLS são restauradas e verificadas. Aplica localmente
as migrations após o cutoff do baseline. A suíte reinstala o writer antigo
somente nesse alvo descartável para provar o defeito antes de aplicar o hotfix.

### Cobertura

- SQL real: adicionar ITEM/configuração/alias, múltiplas linhas, remover/editar/
  reordenar, header-only, replay, request diferente com a mesma chave, stale,
  perfil/target inativo, linhas prontas/retiradas legadas/estocadas/canceladas/
  com evento, pedido encerrado, rollback forçado e saldo/movimentos inalterados.
- Duas conexões concorrentes: dois editores → um commit/outro stale; mesma
  chave → mesmo recibo e um único evento. Deadlines curtos, sem deadlock.
- Integração real: builder do payload → Server Action real → RPC PostgreSQL
  pública autenticada → COMMIT → releitura em conexão nova. O transporte HTTP
  Supabase/Next é substituído por ponte local, não a lógica da RPC.
- App: perda de linhas, troca de targets/alias/notas/quantidade/posição/header,
  recibo inválido, erro/transporte/retry, logs sanitizados e rascunho/stale.

## Gates e limites da entrega

Resultados finais e Preview no HEAD exato são registrados na Draft PR vinculada
à Issue #91. Não somar reexecuções dos mesmos testes como testes adicionais.
Na entrega original da #92, smoke operacional de salvar em Preview/produção
**não foi executado pelo Builder**: não havia
autorização para mutar Pedidos reais e o Preview usa o banco remoto, ainda sem
a migration naquele momento. Persistência pós-COMMIT/nova sessão foi comprovada localmente;
não alegamos um save de navegador remoto ou hard reload autenticado com fixture
remota. Nenhum dado foi inserido para fabricar essa evidência.

Posteriormente, a migration foi aplicada com autorização, a #92 foi mergeada e
o usuário confirmou a resolução do incidente #91. Não há backfill/recuperação
automática de alterações perdidas em edições anteriores.

## Issue #93 — alinhamento de histórico (20/10/2026)

Base desta manutenção: main `82bfd2164279210b43f0465a38467d93af56e9bb`.
O Supabase registrou a aplicação autorizada com versão **`20261020132636`** e
nome descritivo `20261020125349_fix_supplier_order_edit_line_persistence`.
O arquivo do Git usava a versão `20261020125349`. A única correção agora é o
rename para `20261020132636_fix_supplier_order_edit_line_persistence.sql`, com
conteúdo SQL byte a byte preservado. O name remoto permanece intacto.

Comparação read-only das **44 versões remotas** com os **44 arquivos locais**:
antes, somente esses dois timestamps diferiam; depois do rename, conjuntos
iguais, zero versões duplicadas, zero versões locais pendentes. Todas as 43
versões anteriores já correspondiam. SHA-256 antes/depois, tanto no checkout
quanto no blob Git:
`157d1b21831698a4849da354c8d402b32141920b0090abeeb1b8328a774752dc`.

O [CLI compara somente timestamps](https://supabase.com/docs/reference/cli/supabase-migration-list),
não o nome descritivo. Logo, esta migration já é reconhecida como aplicada e não
fica pendente para reaplicação no fluxo normal por versões. Não duplicar o
arquivo antigo nem forçar execução do SQL. Um ambiente novo ainda aplica o
arquivo uma vez, como esperado; isso não significa reaplicação em produção.

Não havia contexto linkado neste worktree; a conferência usou exclusivamente o
MCP oficial `list_migrations`, sem criar link/puxar env. Não foram executados
SQL, `db push`, `migration repair`, alteração de histórico remoto ou reexecução
da migration nesta manutenção. Scripts de teste que filtram pelo sufixo
`fix_supplier_order_edit_line_persistence` continuam compatíveis sem alteração.

Zero migrations remotas. Zero alterações de estoque/saldo. Zero mutações de
Pedidos/dados de negócio remotos. Zero alterações de env. Draft, sem auto-merge.
