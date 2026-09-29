// Administrative observations only. No toggle, role change, termination or reset.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { canonical, client, createLocalDockerTransport, snapshot, validateTargets, ref, sha } from './deployment-backup.mjs';

export const volatileAuthTables = new Set(['auth.sessions', 'auth.refresh_tokens', 'auth.mfa_amr_claims']);
// Explicit human report of the REAL Management API value; not an inferred default.
export const sourcePoolEvidence = Object.freeze({ seconds: 10, provenance: 'HUMAN_PROVIDED_MANAGEMENT_API_2026-09-29', independentlyFetched: false });
export const minimumDatabaseDrainMs = 8000 + sourcePoolEvidence.seconds * 1000 + 8000 + 2000;
const volatileSequence = 'auth.refresh_tokens_id_seq';
export const backupSnapshotSha256 = 'f1708bc39564c3fccc93de82dfcc07fed81c863e7b38ef12ac03079cd6935c4e';
export function validatedBackupSnapshot(bytes) {
  if (sha(bytes) !== backupSnapshotSha256) throw new Error('BACKUP_SNAPSHOT_INTEGRITY_FAILED');
  return JSON.parse(bytes.toString('utf8'));
}
export const authUsersProjectionSql = `select jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg((to_jsonb(t)-'updated_at')::text,E'\\n' order by id),''))) from auth.users t;`;
export const activitySql = `select jsonb_build_object('utc',clock_timestamp(),'readOnly',current_setting('transaction_read_only'),'adminAvailable',current_user='postgres','sessions',(select jsonb_build_object('total',count(*),'active',count(*) filter(where state='active'),'transactions',count(*) filter(where xact_start is not null),'idleInTransaction',count(*) filter(where state like 'idle in transaction%'),'waitingLock',count(*) filter(where wait_event_type='Lock')) from pg_stat_activity where usename='authenticator' and datname=current_database()),'unexpectedClientTransactions',(select count(*) from pg_stat_activity where datname=current_database() and backend_type='client backend' and xact_start is not null and pid<>pg_backend_pid() and usename<>'authenticator'));`;
export const timeoutSql = `select jsonb_build_object('global',(select jsonb_object_agg(name,jsonb_build_object('value',setting,'unit',unit,'source',source)) from pg_settings where name in ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','transaction_timeout')),'roles',(select jsonb_object_agg(rolname,(select coalesce(jsonb_object_agg(split_part(s,'=',1),substring(s from position('=' in s)+1)),'{}'::jsonb) from unnest(rolconfig) s where split_part(s,'=',1) in ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','transaction_timeout'))) from pg_roles where rolname in ('anon','authenticated','service_role','authenticator')),'overrides',(select coalesce(jsonb_agg(jsonb_build_object('databaseSpecific',setdatabase<>0,'role',coalesce(r.rolname,'database-default'),'settings',v)),'[]'::jsonb) from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole cross join lateral(select jsonb_object_agg(split_part(c,'=',1),substring(c from position('=' in c)+1)) v from unnest(setconfig) c where split_part(c,'=',1) in ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','transaction_timeout')) x where v is not null and (setdatabase=0 or setdatabase=(select oid from pg_database where datname=current_database())) and (setrole=0 or r.rolname in ('anon','authenticated','service_role','authenticator'))),'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'settings',v)),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral(select jsonb_object_agg(split_part(c,'=',1),substring(c from position('=' in c)+1)) v from unnest(proconfig) c where split_part(c,'=',1) in ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','transaction_timeout')) x where n.nspname in ('public','private') and v is not null),'dynamicTimeoutFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosrc ~* '(statement_timeout|lock_timeout|transaction_timeout)'),'cronJobsRelation',to_regclass('cron.job') is not null,'netQueueRelation',to_regclass('net.http_request_queue') is not null,'foreignTables',(select count(*) from pg_foreign_table));`;

export function parseTimeout(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)\s*(ms|s|min|h)?$/);
  if (!match) throw new Error('TIMEOUT_UNSUPPORTED');
  const milliseconds = Number(match[1]) * ({ ms: 1, s: 1000, min: 60000, h: 3600000 }[match[2] ?? 'ms']);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new Error('TIMEOUT_UNBOUNDED');
  return milliseconds;
}

export function drainHorizon({ statementMs, poolAcquisitionMs, httpRetryBoundMs, appPhaseBoundMs, marginMs }) {
  const values = [statementMs, poolAcquisitionMs, httpRetryBoundMs, appPhaseBoundMs, marginMs];
  if (values.some(v => !Number.isFinite(v) || v < 0) || statementMs === 0 || poolAcquisitionMs === 0 || marginMs === 0) throw new Error('DRAIN_BOUND_UNPROVEN');
  // Supplied bounds must have real source evidence; this is not a default.
  return values.reduce((a, b) => a + b, 0);
}

export function validateSourceTimeouts(observation) {
  const expected = { anon: { statement_timeout: '3s' }, authenticated: { statement_timeout: '8s' }, authenticator: { statement_timeout: '8s', lock_timeout: '8s' }, service_role: {} };
  if (canonical(observation?.roles) !== canonical(expected) || observation?.functions?.length !== 0 ||
    observation.dynamicTimeoutFunctions !== 0 || observation.foreignTables !== 0 || observation.cronJobsRelation !== false || observation.netQueueRelation !== false ||
    !Array.isArray(observation.overrides) || observation.overrides.length !== 3 || observation.overrides.some(v => v.databaseSpecific !== false || !['anon','authenticated','authenticator'].includes(v.role) || canonical(v.settings) !== canonical(expected[v.role]))) throw new Error('SOURCE_TIMEOUT_OR_WRITER_CHANGED');
  if (new Set(observation.overrides.map(v=>v.role)).size !== 3) throw new Error('SOURCE_TIMEOUT_OR_WRITER_CHANGED');
  return true;
}

export function isDrained(observation) {
  const s = observation.sessions;
  return observation.readOnly === 'on' && observation.adminAvailable === true && observation.unexpectedClientTransactions === 0 &&
    s && ['total','active','transactions','idleInTransaction','waitingLock'].every(k => Number.isInteger(s[k]) && s[k] >= 0) &&
    ['active','transactions','idleInTransaction','waitingLock'].every(k => s[k] === 0);
}

export function semanticOff(result) {
  // Supabase's disabled API exposes only its sentinel schema. Generic failures,
  // authentication errors, empty rows and timeouts are deliberately insufficient.
  return result?.status === 406 && result.error?.code === 'PGRST106' &&
    result.error.message === 'The schema must be one of the following: pg_pgrst_no_exposed_schemas';
}

export function validateExternalOffEvidence(evidence, now = Date.now()) {
  const age = now - Date.parse(evidence?.capturedAt);
  if (evidence?.projectRef !== ref || !Number.isFinite(age) || age < 0 || age > 30000 ||
    ['dashboardOff','productionAuthenticatedOff','previewAuthenticatedOff','appRequestsDrained'].some(k => evidence[k] !== true)) throw new Error('EXTERNAL_OFF_EVIDENCE_REQUIRED');
  return true;
}

export async function observeNaturalDrain({ readActivity, offStillObserved, horizonMs, now = Date.now, wait = ms => new Promise(r => setTimeout(r, ms)), intervalMs = 1000 }) {
  if (!Number.isFinite(horizonMs) || horizonMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('DRAIN_BOUND_UNPROVEN');
  const started = now();
  let firstClean;
  do {
    if (!(await offStillObserved())) throw new Error('DATA_API_OFF_NOT_PROVEN');
    const activity = await readActivity(); // New read-only transaction on EACH observation.
    if (isDrained(activity)) {
      firstClean ??= now();
      if (now() - firstClean >= horizonMs && now() > firstClean) return { drained: true, elapsedMs: now() - started, cleanWindowMs: now() - firstClean, finalActivity: activity };
    } else firstClean = undefined;
    if (now() - started > horizonMs * 3) throw new Error('NATURAL_DRAIN_NOT_PROVEN');
    await wait(intervalMs);
  } while (true);
}

export function compareFreshness(baseline, current, baselineUserProjection, currentUserProjection) {
  const blocked = [];
  const volatile = [];
  for (const key of ['tables','schema','roles','counts']) if (canonical(baseline[key]) !== canonical(current[key])) blocked.push(key);
  if (canonical(Object.keys(baseline.data).sort()) !== canonical(Object.keys(current.data).sort())) blocked.push('data-table-set');
  for (const table of Object.keys(baseline.data)) {
    if (canonical(baseline.data[table]) === canonical(current.data[table])) continue;
    if (volatileAuthTables.has(table)) volatile.push(table);
    else if (table === 'auth.users' && baselineUserProjection?.rows === baseline.data[table].rows && currentUserProjection?.rows === current.data[table]?.rows &&
      /^[a-f0-9]{32}$/.test(baselineUserProjection?.hash) && canonical(baselineUserProjection) === canonical(currentUserProjection)) volatile.push('auth.users.updated_at (explicit human authorization)');
    else blocked.push(table);
  }
  if (canonical(Object.keys(baseline.sequences).sort()) !== canonical(Object.keys(current.sequences).sort())) blocked.push('sequence-set');
  for (const name of Object.keys(baseline.sequences)) if (canonical(baseline.sequences[name]) !== canonical(current.sequences[name])) {
    if (name === volatileSequence) volatile.push(name); else blocked.push(name);
  }
  return { pass: blocked.length === 0, blocked, volatile };
}

export function failSafe({ executeStarted, commitConfirmed, rollbackProven, databaseValidated, cacheValidated, preStateUnchanged }) {
  if (typeof executeStarted !== 'boolean' || typeof commitConfirmed !== 'boolean') return 'COMMIT_STATE_UNKNOWN_KEEP_OFF_HUMAN_STOP';
  if (commitConfirmed) return databaseValidated && cacheValidated ? 'HUMAN_REENABLE_ALLOWED' : 'KEEP_DATA_API_OFF_HUMAN_STOP';
  if ((!executeStarted && preStateUnchanged) || (executeStarted && rollbackProven)) return 'NO_RESET_HUMAN_REENABLE_ALLOWED';
  return 'COMMIT_STATE_UNKNOWN_KEEP_OFF_HUMAN_STOP';
}

export async function readOnlyObservation(sql, transport) {
  const connection = await client(validateTargets(process.env.NK_BACKUP_DATABASE_URL, process.env.NK_BACKUP_SUPABASE_URL), transport);
  try { const observation = await connection.query(sql, 'data-api-maintenance-read-only'); connection.close(); return observation; }
  catch { connection.abort(); throw new Error('READ_ONLY_OBSERVATION_FAILED'); }
}

export async function probeSecretDataApi() {
  if (!process.env.NK_BACKUP_SUPABASE_SECRET_KEY) return { available: false, readable: false, offProven: false };
  const supabase = createClient(process.env.NK_BACKUP_SUPABASE_URL, process.env.NK_BACKUP_SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, db: { timeout: 15000 },
  });
  const result = await supabase.schema('public').from('items').select('id').limit(0).retry(false);
  // A timeout, network error, invalid key or denied table is NOT proof of OFF.
  return { available: true, status: result.status, readable: !result.error && result.status === 200, offProven: semanticOff(result) };
}

export async function validatedBackupUserProjection(baseline, transport) {
  const container = 'supabase_db_nk_pr_68_backup_71790f2a52f2';
  const proof = JSON.parse((await transport.run(['inspect','--format','{"network":{{json .HostConfig.NetworkMode}},"label":{{json (index .Config.Labels "nk.disposable")}},"ports":{{json .NetworkSettings.Ports}}}',container])).bytes.toString());
  if (proof.network !== 'none' || proof.label !== 'backup-restore-pr-68' || Object.keys(proof.ports ?? {}).length) throw new Error('BACKUP_ORACLE_TARGET_UNPROVEN');
  // Read-only clone projection; verify its full auth.users hash against the
  // original private snapshot BEFORE accepting the narrow updated_at exception.
  const sql = `select jsonb_build_object('rows',count(*),'fullHash',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'[]')),'hash',md5(coalesce(string_agg((to_jsonb(t)-'updated_at')::text,E'\\n' order by id),''))) from auth.users t;`;
  const result = JSON.parse((await transport.run(['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],`begin read only;${sql}rollback;`)).bytes.toString());
  if (result.fullHash !== baseline.data['auth.users'].hash || result.rows !== baseline.data['auth.users'].rows) throw new Error('BACKUP_ORACLE_CHANGED');
  return { rows: result.rows, hash: result.hash };
}

async function main() {
  const phase = process.argv[2] ?? 'prepared';
  if (!['prepared','prove-off','freshness','observe-drain'].includes(phase)) throw new Error('READ_ONLY_PHASE_REQUIRED');
  for (const name of ['NK_BACKUP_DATABASE_URL','NK_BACKUP_SUPABASE_URL']) if (!process.env[name]) throw new Error('ADMIN_CREDENTIAL_UNAVAILABLE');
  const transport = await createLocalDockerTransport();
  // Validate target before HTTP probes as well as before credentials enter Docker.
  validateTargets(process.env.NK_BACKUP_DATABASE_URL, process.env.NK_BACKUP_SUPABASE_URL);
  const report = { phase, status: 'PREPARED — NOT EXECUTE AUTHORIZATION', resetExecuted: false, dataApiToggled: false,
    poolEvidence: sourcePoolEvidence, minimumDatabaseDrainMs, httpRetryHorizonProven: false,
    activity: await readOnlyObservation(activitySql, transport), timeouts: await readOnlyObservation(timeoutSql, transport),
    secretDataApi: await probeSecretDataApi(), requiredEvidence: ['bounded HTTP/client/app drain horizon (unknown Retry-After is a STOP)','human Dashboard OFF confirmation','production/Preview/authenticated OFF probes','freshness and fresh DryRun after proven OFF/drain'] };
  if (phase === 'prove-off' || phase === 'observe-drain') {
    validateSourceTimeouts(report.timeouts);
    const evidencePath = process.argv[3];
    if (!evidencePath || process.argv.length !== 4) throw new Error('EXTERNAL_OFF_EVIDENCE_REQUIRED');
    const offStillObserved = async () => {
      validateExternalOffEvidence(JSON.parse(await readFile(resolve(evidencePath), 'utf8')));
      return (await probeSecretDataApi()).offProven;
    };
    if (!(await offStillObserved())) throw new Error('DATA_API_OFF_NOT_PROVEN');
    report.externalOffObserved = true;
    if (phase === 'observe-drain') {
      report.observation = await observeNaturalDrain({ readActivity: async () => {
        validateSourceTimeouts(await readOnlyObservation(timeoutSql, transport));
        return readOnlyObservation(activitySql, transport);
      }, offStillObserved, horizonMs: minimumDatabaseDrainMs });
      // This known finite lower-bound window cannot bound SDK Retry-After or a
      // suspended HTTP request. It is evidence, NEVER an Execute/unlock gate.
      report.status = 'KNOWN DATABASE WINDOW OBSERVED — EXECUTION STILL BLOCKED';
      report.executionReady = false;
    }
  }
  if (phase === 'freshness') {
    // Artifacts remain private and unchanged. Never emit their contents.
    const baseline = validatedBackupSnapshot(await readFile(resolve(process.env.LOCALAPPDATA, 'NK-Private-Backups/pr68-20260929000637303-8476a552/source-snapshot.json')));
    const connection = await client(validateTargets(process.env.NK_BACKUP_DATABASE_URL, process.env.NK_BACKUP_SUPABASE_URL), transport);
    try {
      const current = await snapshot(connection);
      const currentProjection = await connection.query(authUsersProjectionSql, 'auth-users-approved-projection');
      connection.close();
      const baselineProjection = await validatedBackupUserProjection(baseline, transport);
      report.freshness = compareFreshness(baseline, current, baselineProjection, currentProjection);
    }
    catch { connection.abort(); throw new Error('FRESHNESS_FAILED'); }
    report.requiredEvidence.push('Storage byte manifest comparison');
  }
  console.log(JSON.stringify(report));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('MAINTENANCE_OBSERVATION_FAILED — no reset/toggle performed; raw details suppressed.'); process.exitCode = 1; });
