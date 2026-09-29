# NK-PR-68 — Reset operacional de implantação

Este procedimento remove dados de teste exclusivamente após autorização humana e comprovação dos gates abaixo. Não é uma funcionalidade da aplicação; não recria o banco, reaplica migrations ou altera arquitetura. A exceção de catálogo é exatamente o conjunto de cinco peças avulsas aprovado no contrato, com seus cinco parents em items. Todo o restante é preservado.

**Não houve Execute remoto nem purge remoto nesta etapa.** Todo SQL de auditoria/DryRun foi read-only. Houve um incidente inicial de infraestrutura: o CLI inicializou uma login-role temporária antes das consultas read-only. Não afirmar genericamente “nenhuma escrita remota”. Não foi feita limpeza/removal de role. O transporte posterior evita esse efeito, conforme explicado abaixo.

## Contrato auditado

Main `50af5996ff0fb7e36c2c3ae08d20ca3232df6cdc`; projeto real EstoqueNK / `isdjboconmwaqipjrjvp`; banco postgres. Foram comparadas 38 migrations locais/remotas, última `20260917120000`, 33 tabelas public/private e quatro views públicas, antes de editar. As sete migrations posteriores ao contrato anterior foram auditadas. As duas novas tabelas, vehicle_application_brands e vehicle_applications, são preservadas integralmente.

O [relatório sanitizado](DEPLOYMENT_OPERATIONAL_RESET_AUDIT.json) registra o snapshot real, identidades autorizadas, dependências e guards. Qualquer divergência legítima exige nova auditoria explícita; nunca inventar fingerprint ou afrouxar guard.

| Conjunto | PRE | POST obrigatório |
| --- | ---: | ---: |
| items / loose_parts | 106 / 5 | 101 / 0 |
| servos / instalação / reparos | 22 / 74 / 5 | iguais |
| configurações / códigos / compatibilidades | 80 / 80 / 22 | iguais |
| brands / aplicações | 8 / 295 | iguais |
| Auth / profiles / memberships | 3 / 3 / 1 | iguais |
| imagens referenciadas / Storage objects | 76 / 76 | iguais |
| saldos físicos / configurações (linhas) | 15 / 12 | 0 / 0 |
| mínimos positivos (items / configurações) | 7 / 4 | 0 / 0 |

Dos sete items com mínimo positivo, um parent aprovado será removido e seis preservados terão mínimo zerado. Somas atuais dos saldos: 76 items e 42 configurações, separadamente. Ausência de saldo significa zero; nunca fabricar quantity=0 rows. 7INV está ausente e não é presumido como identidade atual.

## Preservação e remoção exata

Preservar todos os outros items/IDs/códigos/subtipos/composição/compatibilidades/aplicações/brands/metadados completos; Auth/profiles/memberships; bucket/objects/imagens; migrations/schema/RLS/policies/functions/RPCs/views/índices/triggers.

O fingerprint de catálogo cobre to_jsonb(row) completo nas dez tabelas. Somente minimum_stock de items/configurações é excluído e validado separadamente. PRE inclui as cinco peças; EXPECTED POST deriva do PRE excluindo somente seus UUIDs em items/loose_parts. Não omitir a tabela loose_parts nem enfraquecer o fingerprint. Os demais campos/linhas/tabelas devem permanecer exatos.

Todas as peças atuais foram declaradas testes pelo usuário. Conferir UUID, código exato (inclusive 091/VF), descrição, tipo, ativo e notes. Referências em estruturas oficiais/subtipos/configurações/compatibilidade/aplicações devem ser zero. Referência não operacional, tabela/FK nova ou dependência não classificada: **STOP FOR DECISION**.

Resetar as vinte tabelas explícitas/411 linhas no relatório: saldos/movimentos físicos e de configurações; batches/linhas/assembly; pedidos/itens/eventos/entradas vinculadas/linhas; autorizações/eventos Safisa; eventos push; auditorias de mínimo; duas idempotências privadas exclusivamente operacionais. Essa remoção de histórico é a exceção administrativa autorizada para dados de teste, nunca regra operacional normal.

Push subscriptions é decisão humana separada: PRESERVE (default) mantém todos os campos/registros/FIDs/estado; DISABLE mantém registros/FIDs e desabilita; DELETE remove. Hoje há três, duas habilitadas. Não escolher outra policy automaticamente.

## DryRun remoto — somente leitura

Uma conexão read-only pode ser fornecida em variável NK_RESET_DATABASE_URL configurada localmente, sem senha no chat/argv/log. A alternativa linked aceita **somente DryRun**, nunca Execute:

```powershell
./scripts/deployment-operational-reset.ps1 -Mode DryRun `
  -SupabaseCliPath '<CLI já instalado>' `
  -LinkedWorkspacePath '<checkout legitimamente linked>' `
  -PushSubscriptions PRESERVE
```

Exigir versão auditada **2.112.0**, ref linked igual ao contrato e metadata real confirmada pela API. O handler oficial resolve configuração DB e descarta-a antes de usar Management API SQL. Sem senha, esse resolver inicializa login-role — incidente inicial registrado. Com sentinela local não secreta NK_MANAGEMENT_API_ONLY_NO_DB_CONNECT em SUPABASE_DB_PASSWORD, o resolver retorna antes de criar role/unban/verify. A sentinela não é credencial nem é enviada para DB auth; o wrapper restaura o valor anterior em finally. Não mudar versão/fluxo sem reaudição do código oficial. Não usar --debug, service_role, credenciais de navegador ou criar objetos temporários remotamente.

SQL: BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY, SELECTs, COMMIT. JSON é vinculado uma única vez no template original e enviado por stdin UTF-8 com escape de literal, nunca argv ou segundo bind do conteúdo inserido. Exigir todos os guards verdadeiros, inclusive transaction_read_only. DryRun bem-sucedido não autoriza execução.

Fontes primárias auditadas: [query handler CLI 2.112.0](https://github.com/supabase/cli/blob/v2.112.0/apps/cli/src/legacy/commands/db/query/query.handler.ts) e [resolver de configuração DB da mesma versão](https://github.com/supabase/cli/blob/v2.112.0/apps/cli/src/legacy/shared/legacy-db-config.layer.ts). O GET de backups foi verificado separadamente no código oficial; não reutiliza esse resolver.

## Atomicidade e guards de Execute futuro

Execute remoto exige conexão DB apropriada, nunca transporte linked/Management API, contrato padrão versionado, árvore rastreada limpa, base correta, migrations locais/remotas idênticas, projeto/banco corretos, AllowRemoteExecution, frase exata CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK, BackupValidated e OperationsPaused. LocalTest nunca relaxa guard remoto.

A única transação bloqueia explicitamente tabelas operacionais/protegidas antes do snapshot. Valida schema/FKs/migrations/PRE/POST derivado/identidades/contagens/imagens. Cada DELETE/UPDATE compara GET DIAGNOSTICS ROW_COUNT ao snapshot exato, com ledger completo. Ordem explícita por FK: eventos push/Safisa; autorizações/entry lines/entries/order events; normalização readiness/retirada/estoque/cancelamento; itens/pedidos; requests privados/assembly/linhas/movimentos; batches; saldos/auditorias; mínimos; cinco subtipos/parents; policy subscriptions.

Somente safisa_portal_events_reject_mutation é nominalmente desabilitado pelo menor intervalo para tipos conhecidos e imediatamente reativado. Readiness segue o trigger normal, sem bypass. Tipos novos causam ROW_COUNT divergente e rollback. Proibidos session_replication_role, DISABLE TRIGGER ALL, service_role como atalho e CASCADE genérico.

Antes do COMMIT: vinte tabelas vazias, mínimos zero, catálogo exatamente EXPECTED POST (só cinco subtipos/parents ausentes e 101 items), ledger completo; schema/FKs/migrations idênticos; hashes completos de Auth/profiles/membership/bucket/objects idênticos; Safisa trigger ativo e policy push exata. Qualquer diferença, inclusive mutação por trigger durante DELETE, causa rollback integral.

## Backup — cópia lógica restaurada; reset continua proibido

O GET anterior retornou PITR false, WAL-G true, backups nulo/vazio e physical_backup_data={} sem janela declarada. Isso não comprovou ausência definitiva de mecanismo físico nem recuperabilidade. Na etapa posterior explicitamente autorizada, foi produzido um backup lógico independente REAL e restaurado integralmente em outro container descartável. Evidência, janela, hashes, suplementos obrigatórios e limitações: [DEPLOYMENT_BACKUP_VALIDATION.md](DEPLOYMENT_BACKUP_VALIDATION.md). O incidente histórico da role CLI continua registrado acima; o backup novo usou DSN direta read-only, sem CLI linked/mint de role ou alteração remota.

Antes de qualquer Execute FUTURO: nova autorização separada; conferir disponibilidade/integridade do conjunto completo (dump + roles sem senhas + ACLs/owners suplementares + bytes Storage/manifesto), freshness/deltas desde a janela do backup e DryRun fresco; manter os demais gates de manutenção/drain/cache. Não usar dump CLI que cria role/senha sem autorização específica. BackupValidated é acknowledgement, não evidência e não é autorizado automaticamente por este ensaio.

PITR habilitado não é requisito de arquitetura: um dump/snapshot validado e restaurável pode cumprir o gate, com seu ponto de recuperação/janela registrado. Não ativar PITR automaticamente nem presumir que WAL-G sozinho prova recuperação.

## Manutenção e cache — nenhuma ação remota agora

A preparação atual usa **OFF humano da Data API**, não alteração de authenticator/NOLOGIN ou Pause Project. Instrumentação read-only, evidências de escritores/timeouts, exceção Auth estrita, comandos após OFF e limites do drain estão em [DEPLOYMENT_DATA_API_MAINTENANCE.md](DEPLOYMENT_DATA_API_MAINTENANCE.md). Os28s conhecidos não provam horizonte HTTP completo; Retry-After desconhecido é STOP. O transporte DatabaseUrl agora fixa Docker local e cliente17.6 existente, remove credenciais de Env/argv e envia somente por stdin, mantendo SQL/bind/contract/guards.

1. Aprovação humana explícita do relatório fresco, cinco identidades e policy push; backup/restauração comprovados.
2. Bloquear novas requests operacionais de **todos** os consumidores do DB: produção, Previews, localhost e workers. Drenar requests em voo antes do SQL/purge para impedir refill tardio de catálogo velho.
3. Repetir DryRun imediatamente antes; divergência exige parar/reavaliar. Executar somente no futuro autorizado, mantendo manutenção até validação independente.
4. Confirmar projeto Vercel correto por .vercel/project.json/flags efetivamente suportadas no help. Depois do reset futuro, purge Data Cache desse projeto: `vercel cache purge --type data`. Não executar agora. [Documentação oficial](https://vercel.com/docs/cli/cache).
5. SQL direto não chama invalidateNkCatalog (tag nk-shared-catalog-v1, user-scoped, TTL3600). Novo deploy, TTL, SWR ou cache invalidate --tag (stale/background) não são garantia pós-reset. Nenhum endpoint/arquitetura nova.
6. Purge Vercel não limpa outros projetos, cache local ou memória de processos. Manter processos locais antigos desligados; retomar só ambiente/cache comprovadamente frio (checkout/build limpo ou limpeza específica validada).
7. Validação read-only controlada com sessões novas; fechar/recarregar completamente clientes (Router Cache, recomendações efêmeras #65 e recursos/fotos locais #67). Não apagar automaticamente histórico persistido de conversas.
8. Confirmar cinco UUIDs ausentes em Estoque/pesquisa/listas/detalhes/Assistente/cards/recomendações/fotos e todos os readers; saldos vazios, mínimos zero, pedidos/movimentos vazios, oficiais/Auth/imagens intactos. Somente depois liberar. Não cachear saldo.

## Ensaio local reproduzível

Bootstrap/teste exigem alvo exclusivo supabase_db_nk_pr_68_reset (ou sufixo) e label nk.disposable=deployment-reset-pr-68. Recusam baseline existente; nunca atingir supabase_db_nk_current_state_baseline. Readiness TCP aguarda servidor final, não init server temporário da imagem.

Imagem Supabase já existente, baseline aprovado e migrations posteriores inalterados; schema Storage sem linhas de outro container local. Todas as leituras SQL/JSON e stdin são explicitamente UTF-8. O digest oficial da migration de aplicações impediu encoding errado antes de corrigir o transporte. Auth/profiles/membership são sintéticos example.invalid e objects sintéticos representam paths oficiais de catálogo. Nenhum export/fixture inclui Auth real, hashes de senha real, PII, tokens push reais ou secrets de functions.

```powershell
# Somente local: nome novo/ausente, imagem já existente, nenhum host port.
# Se o nome já existir, não reutilizar nem remover sem verificar a label exata.
docker run --detach --name supabase_db_nk_pr_68_reset `
  --label nk.disposable=deployment-reset-pr-68 `
  --env POSTGRES_PASSWORD=nk-pr-68-local-fixture-only `
  public.ecr.aws/supabase/postgres:17.6.1.165
./tests/deployment-operational-reset.bootstrap.local.ps1 `
  -StorageSchemaSourceContainer '<container local somente fonte de schema>'
npm run test:deployment-reset
npm run test:deployment-reset:local
```

A imagem fornece as roles/schema Auth locais padrão; o bootstrap provisiona somente os três usuários/profiles sintéticos, sem Auth real. Ele aguarda readiness TCP e exige public.items ausente antes da carga. O container fonte é apenas fonte read-only de schema Storage (no ensaio, supabase_db_nk_current_state_baseline); seu conteúdo, lifecycle e dados não são alterados. Para repetir, remover/recriar somente o alvo disposable depois de comprovar nome exato e label, nunca o baseline.

25 checks DB reais passaram: DryRun hash de estado inteiro inalterado; aspas/acento; guards de identidade/schema/PRE/POST/FKs/Auth/storage/backup/manutenção; tabela/FK inesperada; referência estrutural; trigger Safisa; sabotagem ROW_COUNT e catálogo POST; falha final com rollback de tudo; sucesso removendo só conjunto autorizado; zeros operacionais/mínimos e três policies push. Os 11 testes unit/transport incluem mocks sem rede para pin/ref/Execute proibido/restauração da sentinela/erro seguro. Overrides locais correspondem somente à fixture sintética, nunca substituir contrato remoto.

Build padrão passou após trocar junction node_modules fora do root por cópia local das dependências existentes, sem instalar dependência/alterar Nextconfig/app. TypeScript/lint e 52 regressões de catálogo/apps/images passaram; lint com três warnings preexistentes.

## Stop humano e implantação

Após revisão independente, no máximo **RESET READY FOR HUMAN AUTHORIZATION**, nunca “reset executado”. Aprovação humana sozinha não dispensa backup, manutenção/drain, DryRun fresco, transporte adequado e validações/cache. Nunca merge automático.

Após reset futuro validado, manter saídas congeladas durante contagem inicial. Separar Caixas montadas de componentes avulsos sem dupla contagem, lançar pela Entrada oficial com Contagem inicial de implantação, conciliar com contagem física assinada e corrigir diferenças pelo fluxo auditado antes da operação normal.
