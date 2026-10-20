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

Migration: `20261020125349_fix_supplier_order_edit_line_persistence.sql`.

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
Smoke operacional de salvar em Preview/produção **não foi executado**: não há
autorização para mutar Pedidos reais e o Preview usa o banco remoto, ainda sem
a migration. Persistência pós-COMMIT/nova sessão está comprovada localmente;
não alegamos um save de navegador remoto ou hard reload autenticado com fixture
remota. Nenhum dado foi inserido para fabricar essa evidência.

**A correção de produção depende de revisão, autorização e aplicação coordenada
da migration + deploy. Esta PR não aplica a migration nem faz merge.** O guard
da aplicação detecta perda de linhas mesmo antes da migration, mas não substitui
a correção SQL. Não há backfill/recuperação automática de alterações perdidas em
edições anteriores; não modificamos os Pedidos existentes.

Zero migrations remotas. Zero alterações de estoque/saldo. Zero mutações de
Pedidos/dados de negócio remotos. Zero alterações de env. Draft, sem auto-merge.
