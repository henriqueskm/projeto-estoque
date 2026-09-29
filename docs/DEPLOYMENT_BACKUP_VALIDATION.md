# NK-PR-68 — Backup real e restore independente

O dump lógico foi restaurado integralmente; os 76 objetos reais foram baixados e conferidos byte a byte, sem upload para Storage. **RESET STILL NOT EXECUTED.** Este resultado não autoriza reset, purge, merge nem mudanças de produção. A revisão independente da mesma Draft PR continua obrigatória.

## Evidência real

Projeto confirmado: EstoqueNK / `isdjboconmwaqipjrjvp`. PostgreSQL servidor e pg_dump: **17.6**; imagem já instalada `public.ecr.aws/supabase/postgres:17.6.1.165`. Base main `50af5996ff0fb7e36c2c3ae08d20ca3232df6cdc`, 38 migrations, última `20260917120000`. A coleta ocorreu sobre a base de código `a3b48044cca85558f074abe8ebd704858a062106` mais o tooling novo desta PR.

Diretório privado único, fora de todos os checkouts/Git:

`C:\Users\PICHAU\AppData\Local\NK-Private-Backups\pr68-20260929000637303-8476a552`

ACL NTFS protegida: apenas usuário local atual e SYSTEM, FullControl herdável. Verificação Git fora de repositório confirmou exit128. Arquivos reais de Auth, sessões, hashes de senha, tokens de push e SQL/dados sensíveis ficam SOMENTE ali. Nada disso foi inserido no Git, fixtures, frontend, URLs públicas ou relatório sanitizado. Os três valores administrativos também não integram os arquivos de metadata/manifestações; nunca são argumentos Docker/psql ou logs.

Janela UTC conservadora: **2026-09-29T00:06:37.303Z → 2026-09-29T00:07:55.460Z**. O início é a criação do identificador de diretório, anterior ao snapshot exportado; não é alegação de uma única transação para DB, roles e Storage. Dump escrito 00:06:50.450Z; validação local escrita 00:07:53.386Z. O relatório original de execução foi preservado como backup-report.execution.json; backup-report.json agrega hashes/tamanhos dos sidecars e explica a janela. Ambos são privados.

| Artefato privado | Bytes | SHA256 |
| --- | ---: | --- |
| database.dump | 1158638 | cf80b1e9b52d3a205b0e85208e9af7e72a2db8522eced1f92572fca5c6f03687 |
| roles-no-passwords.sql | 5643 | cc2ac0a5b5a5014fdccfbb91bf37bc636dbd0420b5f9112e57d25740e49dad8b |
| namespace-acls.json | 10016 | 94391533bd8f6b000baa525aad916423ca5c72c2b04723cff780d0d8eecf007e |
| namespace-acls.sql | 1553 | 2c41807b95851e36b1516d631a60acf578952adaebe226f5a9a653151bcdf9e5 |
| extension-owners.json | 563 | 87491862fbaf4c85ae68baf108850ebc9f844d9668b001ed47c7c30885ff1f83 |
| database-restoration.sql | 2027424 | 540fb0a50cc34c96dc93e97d19b7cf0af388fae15eaad102f3866cb07600cfc7 |
| source-snapshot.json / restore-validation.json (cada) | 19243 | f1708bc39564c3fccc93de82dfcc07fed81c863e7b38ef12ac03079cd6935c4e |
| storage-manifest.json | 14526 | 81ab2bde32db4ae8e65b8479060f90351d884e5f26ff301080763be3b90a467b |

Bucket privado commercial-catalog-images: **76 listados / 76 baixados / 76 SHA256 válidos**, total **11747536 bytes**. Manifesto privado contém path literal, identidade, bytes e SHA256; não contém signed URLs/tokens. Paths/tamanhos/IDs conferem com storage.objects; cada arquivo foi relido e rehashado. Sem PUT, DELETE, assinatura de URL ou nova credencial S3. Os bytes são a cópia local recuperável, independente da metadata SQL; não houve upload para o Storage de produção.

## Snapshot, drift e equivalência

Uma conexão persistente iniciou BEGIN REPEATABLE READ READ ONLY e exportou snapshot. pg_dump custom completo (`--format=custom --create --snapshot=...`) e hashes fonte compartilham esse snapshot. Todas as tabelas não-sistema arquiváveis são incluídas, também auth/storage/realtime/supabase_migrations/private, não apenas public. A exportação de roles é separada (`pg_dumpall --roles-only --no-role-passwords`); foi conferida contra os atributos/memberships fonte e destino, sem exportar senha de role.

Sequências não são MVCC: last_value/is_called foram comparados antes/durante/depois, no restore e fresh final. Storage não compartilha a transação: listagens completas antes/depois/final, identidade/tamanho DB/API e hashes dos bytes locais foram iguais. Snapshots fresh depois de dump/Storage e depois do restore não detectaram drift de tabelas, schema, roles ou sequências. Qualquer diferença teria impedido PASS; não foi escolhido dado volátil fora do archive para simular igualdade.

Restore validou **73 tabelas**, hash completo de cada linha (to_jsonb ordenado), **2756 componentes semânticos de schema**, roles/memberships e duas sequências. O fingerprint compara owners, grants de objetos/defaults, RLS/force-RLS, policies, definições de funções/RPC, triggers/estado, constraints/FKs, índices/views, tipos/enums/domínios, parâmetros de sequência e nome/ordem lógica/tipo/default/nullability/identity/generated/collation de cada coluna viva. Isso não é alegação de comparação de todo atributo interno do PostgreSQL; os objetos suportados completos continuam no archive. ACLs comparadas mantêm cada grantor/grantee/privilege/grantable; não se ignora grant ausente. Colunas são lidas por pg_catalog (sem visibility variável de information_schema), ordenadas logicamente: lacunas físicas attnum de colunas removidas não são reconstituídas pelo dump lógico.

Hash agregado completo dos dados: `c4882dddc3b2a9b8d7e7421c3fa85a0a1ec2c6b8d2a7759305bd7edaf05a4557`; schema `d2d5d1c9b6bc6f892e2b11c33824ebad`; roles `54bce720a8a05081004ae4f4474aeb40`; memberships `cfaba45fc338d249f68052e59c03c8f6`. Arquivos de snapshot e restore são idênticos byte a byte conforme SHA acima.

PRE restaurado e conferido independentemente pelo Lead: items106/loose5; servo22/instalação74/reparo5; configurações80/códigos80/compatibilidade22; aplicações295/brands8; Auth3/profiles3/membership1; Storage76; push subscriptions3. Saldos físicos15/soma76 e configurações12/soma42; mínimos positivos7+4; código110 mantém saldo7 e mínimo7. As vinte tabelas operacionais continuam com **411 linhas**, preservadas. Nada foi resetado.

## Por que o conjunto precisa de suplementos

O primeiro restore bloqueou PASS corretamente: dados/roles/sequências já coincidiam, mas owners de pgcrypto/uuid-ossp/pg_stat_statements passaram de postgres para o executor supabase_admin e grants de graphql/graphql_public não reapareceram no clone cru. O archive original não foi editado nem essa divergência ignorada. Foram capturados, read-only no snapshot, owners/versões de todas as extensões e ACLs completas de namespaces. A restauração precisa de **dump + roles + owners/ACL sidecars + bytes Storage/manifesto**; o dump isolado não basta para recuperação equivalente.

Receita efetivamente executada, somente em clone novo:

1. Criar alvo aleatório `supabase_db_nk_pr_68_backup_71790f2a52f2`, label `nk.disposable=backup-restore-pr-68`, network none, nenhuma porta. Imagem inicia cluster novo via initdb, admin supabase_admin, auth local trust/host reject, listen_addresses vazio/shared_preload_libraries vazio. Não reutiliza schema/dados/Auth de qualquer container antigo. Cron/pg_net não conseguem callbacks externos; na fonte não há jobs/subscriptions ou vault.secrets para recuperação de chave externa.
2. Comprovar network/label/ports e DB vazio via socket Unix. Restaurar roles sem senhas com ON_ERROR_STOP; só a linha CREATE do admin bootstrap já existente é removida, mantendo seus ALTER/memberships/grants. Hash de roles final deve ser exato.
3. Derivar SQL privado do archive intacto com pg_restore `--file=- --create --clean --if-exists`. Guard exige uma CREATE EXTENSION exata por objeto; envolver cada uma em SET SESSION AUTHORIZATION do owner fonte e RESET. Não remover objeto, COPY, owner ou ACL.
4. No alvo isolado, elevar postgres temporariamente a SUPERUSER para criar suas extensões; executar SQL via psql ON_ERROR_STOP conectado em template1, recriando somente postgres do alvo novo. Reverter NOSUPERUSER em finally. Atributos e memberships completos conferem com a fonte, não apenas esse flag.
5. Executar suplemento de grants das duas schemas com grantor original e grant option. Todos os ACLs fonte continuam no sidecar privado; prova final cobre todos os namespaces/objetos, não apenas o suplemento.
6. Conferir dados/schema/owners/grants/RLS/functions/triggers/roles/sequências/contagens, novo snapshot fonte e listagem Storage final; só então gravar PASS. Não há --no-owner/--no-acl, UPDATE de pg_catalog, erro ignorado ou mudança remota. CREATE DATABASE não cabe em transação única: a recuperação é fail-fast em clone completamente descartável.

O Lead confirmou independentemente hashes/bytes/imagens/ACL fora Git, alvo network-none sem portas, socket local, postgres não-superuser e todos os PRE agregados exigidos. Containers anteriores (inclusive baseline e ensaio de reset) não foram alterados. Tentativas interrompidas permaneceram privadas e não são a cópia selecionada acima.

## Tooling e limites

`node scripts/deployment-backup.mjs` exige somente NK_BACKUP_DATABASE_URL, NK_BACKUP_SUPABASE_URL e NK_BACKUP_SUPABASE_SECRET_KEY já configuradas no Process. Nunca colocar valores no comando/chat; não carrega arquivo .env nem busca cookies/Auth de navegador. Secret key serve exclusivamente à leitura administrativa de Storage neste processo local; os três valores são removidos do environment dos subprocessos. DSN é decomposta em campos enviados por stdin, não Docker args/Env. sslmode require/verify-ca/verify-full e timeout seguro fornecidos são respeitados; opções desconhecidas/duplicadas/fracas/empty abortam. Verificação de versão/projeto/DB, read-only PGOPTIONS e snapshot obrigatória. Falhas imprimem somente categoria/SQLSTATE ou mensagem própria controlada; erro nativo inesperado é suprimido.

A correção local de ACL remove PSModulePath herdado de PowerShell 7 somente para o subprocesso PowerShell 5.1; evita incompatibilidade de autoload e não muda configuração do sistema. Get-Item -Force permite verificar ancestors ocultos e recusa reparse points. Segurança não foi afrouxada para produzir backup.

Sem nova dependência, CLI linked/mint de role, credencial/S3key nova, mudança de schema/RLS/policy/role/password remota, cache purge, reset ou merge. O incidente histórico da role CLI permanece em [runbook](DEPLOYMENT_OPERATIONAL_RESET.md), não é repetido nesta etapa. A flag remoteWrites=false do relatório refere-se apenas a esta execução de backup, não apaga o incidente anterior.

Recuperação validada é de **DB lógico e Storage**, não clone integral de infraestrutura Supabase: senhas runtime de roles, JWT/OAuth/secrets externos não são exportados; vault.secrets é vazio. Ativação de PITR não é necessária nem foi feita. Um backup validado nesta janela não fica automaticamente válido horas depois: antes de qualquer reset separado, revisar freshness/deltas, revalidar integridade/restore e cumprir os gates originais de autorização/manutenção/DryRun/cache.

Fontes oficiais: [pg_dump 17](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore 17](https://www.postgresql.org/docs/17/app-pgrestore.html), [pg_dumpall 17](https://www.postgresql.org/docs/17/app-pg-dumpall.html), [sequências e isolamento](https://www.postgresql.org/docs/17/transaction-iso.html), [restore Supabase](https://supabase.com/docs/guides/self-hosting/restore-from-platform), [backup e Storage separados](https://supabase.com/docs/guides/platform/backups).

Testes desta etapa: 18 unitários comportamentais de backup e 11 regressões de reset/transporte sem SQL destrutivo passaram. O restore acima é REAL, não fixture. Os 25 checks DB de reset sintético permanecem da etapa anterior a3b4804 e não foram reexecutados contra containers existentes nesta etapa. TypeScript, lint e build padrão passaram (três warnings preexistentes de lint, nenhum novo); build executado sem as três credenciais de backup no environment. Diff-check passou. Não tratar os tempos de mocks como métricas reais.
