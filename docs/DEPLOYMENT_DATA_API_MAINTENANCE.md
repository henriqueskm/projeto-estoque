# PR68 — preparação de manutenção pela Data API

Esta etapa prepara observações administrativas somente leitura. **A Data API continua ON; nenhum toggle, reset, purge, encerramento de sessão ou ALTER ROLE foi executado.** Não altera app, schema, migrations, RLS, usuários, dados ou backups. Somente depois da revisão do HEAD real o Lead poderá pedir o OFF humano no Dashboard; isso não autoriza Execute.

## Evidências reais e limites

Main `50af5996ff0fb7e36c2c3ae08d20ca3232df6cdc`, projeto `isdjboconmwaqipjrjvp`, PostgreSQL 17.6, PostgREST 14.5. Leituras reais em transações read-only; último checkpoint PG capturado `2026-09-29T11:04:09.57718Z`: admin disponível, duas sessões authenticator idle, zero transações/ativas/idle-in-transaction/lock waits e zero client transactions inesperadas. Não publicar query text, IPs, JWT, rolconfig ou dados Auth.

Os clients de navegador/SSR (`lib/supabase/client.ts`, `server.ts`, `proxy.ts`) e o client administrativo (`admin.ts`) usam supabase-js HTTP. Writers de estoque/configurações/pedidos/catálogo/Safisa são RPCs ou operações HTTP. Nenhum runtime direto pg/DATABASE_URL, Edge invocation, cron/worker independente ou upload/remove Storage foi localizado no código rastreado. CLI oficial listou zero Edge Functions remotas; catálogo remoto não tem cron.job/net.http_request_queue, foreign tables ou chamadas net/http/dblink/FDW nos corpos auditados. Esse inventário não garante inexistência de um consumidor externo desconhecido: atividade inesperada continua STOP, e todos os produtores conhecidos devem permanecer congelados.

Safisa: claim RPC → leitura de subscriptions → FCM (timeout 8s, chunk500; duas subscriptions habilitadas em um chunk) → UPDATE subscription/complete RPC. A fase FCM não mantém uma sessão PG e não pode ser esquecida no drain. Previews/produção/local apontando para o mesmo DB são igualmente afetados por OFF.

Role real postgres: NOSUPERUSER, CREATEROLE, ADMIN OPTION authenticator, membership authenticator, pg_signal_backend e pg_read_all_stats. Mesmo assim supautils protege authenticator como reserved role. **Não usar NOLOGIN, não contornar supautils, não mudar grants/passwords e não pausar o projeto.** A via atual é o toggle oficial Data API pelo humano.

Timeouts efetivos auditados: anon statement3s; authenticated statement8s; authenticator statement/lock8s; service_role sem override herda authenticator. Não há overrides específicos do banco ou de funções public/private, nem alteração dinâmica desses timeouts nos corpos auditados. O helper revalida esses conjuntos completos e recusa mudanças. Defaults globais do admin (statement120s; demais0) não são bounds HTTP.

`db_pool_acquisition_timeout=10s` foi **fornecido manualmente pelo humano a partir do Management API em 2026-09-29**. Não foi obtido autonomamente pelo helper, nem inferido do campo pool-size vazio do Dashboard. A margem de duas amostras é 2s. A janela mínima conhecida é 8+10+8+2 = **28s**, não uma prova de que todas as requests HTTP acabaram.

O SDK instalado permite três retries apenas de GET/HEAD/OPTIONS para 503/520; POST/PATCH/DELETE não têm esse auto-retry. Retry-After não tem teto no código; as factories do app não impõem timeout HTTP global. Uma leitura atrasada pode preceder uma mutação. Portanto **Retry-After/request/app phase desconhecidos não recebem um máximo inventado**: `observe-drain` sempre informa executionReady=false. Antes de Execute ou reabrir o app é preciso provar requests/fases pendentes encerradas e um horizonte real completo. Se não houver evidência, STOP; não ampliar schema/epoch/arquitetura para contornar.

## Comandos concretos, sem credenciais no argv

Usar somente o canal local autorizado: NK_BACKUP_DATABASE_URL, NK_BACKUP_SUPABASE_URL e NK_BACKUP_SUPABASE_SECRET_KEY no Process. Não copiar valores para arquivos/chat/logs. A URL é validada para o projeto exato antes de qualquer probe. Docker deve ser Windows local/Linux, sem DOCKER_HOST/DOCKER_CONTEXT; pipe validado é fixado em cada chamada. Imagem PG17.6 já existente, `--pull=never`; credenciais entram por stdin protegido, não `docker -e`/argv. Sem instalação.

```powershell
# Agora: auditoria read-only, OFF não presumido.
node scripts/deployment-data-api-maintenance.mjs prepared
node scripts/deployment-data-api-maintenance.mjs freshness
```

Prepared foi executado realmente: probe do secret administrativo autorizado readable/status200; prova adicional do Lead HEAD/count retornou206/106. Isso confirma canal legítimo de probe, não igualdade com a service key do app. Produção/Preview autenticados ainda exigem login humano válido; nunca extrair cookie/JWT ou forjar credencial.

Após revisão e OFF humano, o Lead registra um JSON local contendo **somente metadados de verificações reais**, não credenciais, fora do Git:

```json
{
  "projectRef": "isdjboconmwaqipjrjvp",
  "capturedAt": "<UTC real da verificação>",
  "dashboardOff": true,
  "productionAuthenticatedOff": true,
  "previewAuthenticatedOff": true,
  "appRequestsDrained": true
}
```

Não preencher true por simulação. Renovar a evidência real durante observação; mais de30s, data futura, projeto errado ou campo ausente/falso abortam. Estes campos são acknowledgements humanos, não substituem executar e observar as requests reais autenticadas.

```powershell
# Somente DEPOIS de OFF humano e provas reais completas:
node scripts/deployment-data-api-maintenance.mjs prove-off '<arquivo local de evidência>'
node scripts/deployment-data-api-maintenance.mjs observe-drain '<arquivo local de evidência>'
node scripts/deployment-data-api-maintenance.mjs freshness
./scripts/deployment-operational-reset.ps1 -Mode DryRun `
  -DatabaseUrlEnvironmentVariable NK_BACKUP_DATABASE_URL -PushSubscriptions PRESERVE
```

O probe service faz SELECT limit0 público sem retries e reconhece estritamente **o padrão esperado** HTTP406/PGRST106 com mensagem de schema restrito a `pg_pgrst_no_exposed_schemas`. O sentinel é documentado pela Supabase; PGRST106/406 pela referência PostgREST. **Esse padrão ainda não foi observado após OFF neste projeto.** Se a plataforma responder diferente, STOP para classificar a resposta real sem expor conteúdo; nunca aceitar timeout/DNS/401/403/404 genérico ou array vazio como OFF. O helper não faz toggle nem escreve por API.

Cada amostra PG abre nova transação read-only para stats frescas; zero active/TX/idleTX/lockwait/unknown writers e admin disponível são obrigatórios. Pool idle sem TX/lock é permitido. Janela limpa reinicia após atividade; perda de OFF, evidência externa vencida, timeout/worker novo ou três janelas sem drain abortam. Não mata sessões. Mesmo uma janela28s limpa fica rotulada **KNOWN DATABASE WINDOW OBSERVED — EXECUTION STILL BLOCKED** até resolver os bounds HTTP/app; não é gate Execute aprovado.

## Freshness estreita e backup preservado

Conjunto privado validado `pr68-20260929000637303-8476a552` permanece intacto; dump SHA256 `cf80b1e9b52d3a205b0e85208e9af7e72a2db8522eced1f92572fca5c6f03687`, manifesto Storage `81ab2bde32db4ae8e65b8479060f90351d884e5f26ff301080763be3b90a467b`. Não refazer automaticamente backup nem mudar clone71790/oracle. Papéis/configs/memberships e schema continuam exatos, sem exceção LOGIN nesta via.

`freshness` usa a semântica de snapshot do backup (73 tabelas/2756 partes schema, roles, sequências, counts). Só admite auth.sessions, auth.refresh_tokens, auth.mfa_amr_claims e **somente** auth.refresh_tokens_id_seq como volatilidade sessão/token autorizada. Para auth.users, o humano autorizou apenas updated_at: primeiro a oracle read-only deve coincidir no hash de linha integral/contagem com o snapshot privado original; depois compara row JSON menos **somente updated_at** porid. Todos os outros campos, identidade/security/password/email/metadata e IDs permanecem estritos. Nenhum Auth real é impresso/versionado.

Diagnóstico PRE real passou em `2026-09-29T11:02:44.008987Z`: dados/catalog/operacionais/schema/roles/counts/sets/sequências não voláteis iguais; diferenças limitadas à lista acima. **Não é FULL freshness PASS futuro**: repetir depois de OFF/drain e conferir os76 bytes Storage/list/metadata contra manifesto; rehash local do dump/manifesto sozinho não prova Storage remoto fresco. A janela do backup continua00:06:37.303Z–00:07:55.460Z. Drift relevante exige STOP/decisão, nunca atualizar guards para aceitar.

## Fail-safe e separação de autoridade

A: falha antes de Execute → nenhum reset; só recomendar ON humano após comprovar PRE inalterado. B: falha de Execute → só recomendar ON após rollback integral comprovado, não pela ausência de mensagem de erro. C: commit confirmado e validação de DB/cache incompleta → **manter OFF e STOP humano**. Commit incerto também mantémOFF; nunca liberar por timeout. O helper modela essas decisões mas não executa reset/purge/toggle/release.

O canal DatabaseUrl do procedimento oficial foi endurecido sem alterar SQL/bind/contract/guards. Mantém mode explícito e transaction prefix, TLS fornecido, cliente17.6, pipe local fixado e stdin; remove inclusive variável DSN custom do ambiente dos subprocessos, suprime erros brutos. Linked continua DryRun-only. Execute não aparece como comando nesta preparação e segue condicionado à autorização separada do Lead/humano.

Cache preflight read-only do Lead: VercelCLI59.11.2 autenticado/provider existente, projeto `prj_rRPl3vXCyjYTKVSgXhnJp200FAEa`, team `team_fFpQxgIvo4DVqfhWlXpTQbJ8`, projeto-estoque-sp4o. Help confirma `cache purge --project <ID> --type data --yes --scope henrqueskms-projects` com `--cwd` principal explícito. Nenhum purge agora. A capacidade real de escrita só se mede no futuro autorizado; se falhar apóscommit, casoC mantémOFF. Purge desse projeto não limpa outros projetos/localhost/processos; reiniciar apenas readers frios após validação e reload completo. Detalhes no [runbook de reset](DEPLOYMENT_OPERATIONAL_RESET.md).

## Testes e fronteira de prova

```powershell
node --test tests/deployment-data-api-maintenance.test.mjs tests/deployment-backup.test.mjs tests/deployment-operational-reset.test.mjs
node tests/deployment-data-api-maintenance.local.mjs
```

65 testes de comportamento passaram: semantic OFF failclosed, prova humana fresca, configs/bounds, observer com janela contínua, rollback decisionsABC, Auth projeção estreita, strict drift/integridade do snapshot original, reset stdin/TLS/versão/localidade/DSN custom semenv/argv, regressões backup/reset. Execute só foi exercitado com mocks sem rede nesta etapa. Ensaio local cinco checks, TypeScript, lint e build passaram; lint tem apenas três warnings preexistentes fora do escopo. Build removeu/restaurou as três variáveis administrativas dos subprocessos, sem instalar dependências.

Ensaio PG real separado: novo `supabase_db_nk_pr_68_maintenance_f4c850ac6656`, label data-api-maintenance-pr-68, networknone/nopublishedports. Cinco checks: poolidle permitido; idleTX bloqueia; waiter de lock bloqueia; rollback de ambas mantém fixture0; nova amostra vê drain. Prova nome/label/rede/ports antes de cada mutação local; alvo retido. Fixture sintética não comprova DashboardOFF, filaHTTP ou privilégio remoto. Nenhum clone existente modificado.

Fontes primárias: [desabilitar Data API](https://supabase.com/docs/guides/api/securing-your-api), [sentinel conhecido do OFF](https://github.com/orgs/supabase/discussions/45144), [PostgREST erros](https://docs.postgrest.org/en/v14/references/errors.html), [timeouts Supabase](https://supabase.com/docs/guides/database/postgres/timeouts), [supautils roles](https://github.com/supabase/supautils/blob/master/src/roles.c). Config pool10s tem proveniência humana explícita, não uma fonte default.

Limite de ciclos globais permanece1/2 consumido. A revisão deste HEAD vem antes do pedidoOFF humano. Readiness instrumental jamais significa RESET READY ou autorização de Execute.
