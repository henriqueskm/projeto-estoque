// Administrative local backup only. Never imported by the application.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';

export const ref = 'isdjboconmwaqipjrjvp';
export const image = 'public.ecr.aws/supabase/postgres:17.6.1.165';
export const bucket = 'commercial-catalog-images';
class BackupError extends Error {}
const backupError=message=>new BackupError(message);
export const safeErrorMessage=error=>error instanceof BackupError?error.message:'Backup stage failed; unclassified details suppressed.';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const credentialNames = ['NK_BACKUP_DATABASE_URL', 'NK_BACKUP_SUPABASE_URL', 'NK_BACKUP_SUPABASE_SECRET_KEY'];
export function sanitizedChildEnv(env=process.env) {const blocked=new Set([...credentialNames,'DOCKER_HOST','DOCKER_CONTEXT']); return Object.fromEntries(Object.entries(env).filter(([name])=>!blocked.has(name.toUpperCase())));}
const childEnv = sanitizedChildEnv();
let dockerTransport;
const localDockerEndpoints=new Set(['npipe:////./pipe/dockerDesktopLinuxEngine','npipe:////./pipe/docker_engine']);
export function pinnedDockerArgs(endpoint,args) {
  if(!localDockerEndpoints.has(endpoint)||args.some(arg=>arg==='-H'||arg==='--host'||arg==='--context'||arg.startsWith('--host=')||arg.startsWith('--context=')))throw backupError('Local Docker endpoint guard failed');
  return ['--host',endpoint,...args];
}
export async function createLocalDockerTransport({env=process.env,platform=process.platform,execute=runTool,startProcess=spawn}={}) {
  if(platform!=='win32'||Object.keys(env).some(name=>['DOCKER_HOST','DOCKER_CONTEXT'].includes(name.toUpperCase())))throw backupError('Local Docker overrides/platform refused');
  // This sole unpinned command reads local context metadata only; no daemon,
  // container, stdin credentials or backup bytes are used before validation.
  const context=await execute(['context','inspect','--format','{{(index .Endpoints "docker").Host}}'],null,'docker');
  const endpoint=context.bytes.toString('utf8').trim();
  const args=commandArgs=>pinnedDockerArgs(endpoint,commandArgs);
  const server=await execute(args(['info','--format','{{.OSType}}']),null,'docker');
  if(server.bytes.toString('utf8').trim()!=='linux')throw backupError('Local Docker Linux engine guard failed');
  const envForDocker=Object.freeze(sanitizedChildEnv(env));
  // Pin the validated pipe, not the mutable selected context, on EVERY path.
  return Object.freeze({
    run:(commandArgs,input=null)=>execute(args(commandArgs),input,'docker'),
    start:commandArgs=>startProcess('docker',args(commandArgs),{env:envForDocker,windowsHide:true,stdio:['pipe','pipe','pipe']})
  });
}
export function validateTargets(db, api) {
  const u = new URL(db), a = new URL(api);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hash || u.pathname !== '/postgres' ||
      !(u.hostname === `db.${ref}.supabase.co` || (u.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(u.username) === `postgres.${ref}`)) ||
      a.protocol !== 'https:' || a.hostname !== `${ref}.supabase.co` || a.pathname!=='/' || a.username || a.password || a.search || a.hash) throw backupError('Target identity guard failed');
  if ([...u.searchParams.keys()].some(k => !['sslmode', 'connect_timeout'].includes(k)) || new Set(u.searchParams.keys()).size !== [...u.searchParams.keys()].length) throw backupError('Unsupported connection option; human decision required');
  const sslmode=u.searchParams.has('sslmode')?u.searchParams.get('sslmode'):'require';
  const timeout=u.searchParams.has('connect_timeout')?u.searchParams.get('connect_timeout'):'15';
  if(!['require','verify-ca','verify-full'].includes(sslmode)||!/^\d+$/.test(timeout)||Number(timeout)<1||Number(timeout)>120)throw backupError('Unsupported connection security option');
  const fields = [u.hostname, u.port || '5432', decodeURIComponent(u.username), decodeURIComponent(u.password), 'postgres',sslmode,timeout];
  if (fields.some(v => !v || /[\r\n\0]/.test(v))) throw backupError('Unsupported credential encoding');
  return fields.join('\n') + '\n';
}
export function safePath(base, path) {
  if (!path || path.split('/').some(p => !p || p === '.' || p === '..' || /[\\:\0<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw backupError('Unsafe Storage path');
  const target = resolve(base, ...path.split('/'));
  if (!target.startsWith(resolve(base) + '\\') && !target.startsWith(resolve(base) + '/')) throw backupError('Storage path escaped destination');
  return target;
}
export const sha = data => createHash('sha256').update(data).digest('hex');
export function category(stderr) {
  for (const [label, re] of [['AUTHENTICATION', /authentication|password/i], ['PERMISSION', /permission denied|must be.*owner|must be.*superuser/i], ['CONNECTIVITY', /connect|network|timeout/i], ['OBJECT_EXISTS', /already exists/i], ['OBJECT_MISSING', /does not exist/i],['CLI_ARGUMENT',/one of.*must be specified|option.*required/i],['NOT_A_REPOSITORY',/not a git repository/i]]) if (re.test(stderr)) return label;
  return 'SUPPRESSED_ERROR';
}
async function runTool(args, input = null, command = 'docker') {
  const env={...childEnv}; if(command==='powershell.exe') delete env.PSModulePath;
  const p = spawn(command, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const out = [], err = [];
  p.stdout.on('data', x => out.push(x)); p.stderr.on('data', x => err.push(x));
  const result = new Promise((yes, no) => { p.on('error', () => no(backupError('Local tool launch failed'))); p.on('close', code => yes(code)); });
  if (input && typeof input.pipe === 'function') await pipeline(input, p.stdin).catch(() => {});
  else p.stdin.end(input);
  const code = await result, stderr = Buffer.concat(err).toString('utf8');
  if(code!==0 && command==='powershell.exe') { const errorId=Buffer.concat(out).toString().match(/ACL_CODE:([A-Za-z0-9.,_-]+)/)?.[1]; if(errorId)throw backupError(`Private ACL guard failed: ${errorId}`); }
  if (code !== 0) throw backupError(`Tool ${command}:${args[0]}:${args.find(a=>['psql','pg_dump','pg_dumpall','pg_restore'].includes(a))||'local'} stage failed: exit ${code}; ${category(stderr)}. Raw output suppressed.`);
  return { bytes: Buffer.concat(out), stderr };
}
async function run(args,input=null,command='docker') {
  if(command!=='docker')return runTool(args,input,command);
  if(!dockerTransport)throw backupError('Local Docker preflight required');
  return dockerTransport.run(args,input);
}
const sourceShell = 'IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; IFS= read -r PGDATABASE; IFS= read -r PGSSLMODE; IFS= read -r PGCONNECT_TIMEOUT; export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE PGCONNECT_TIMEOUT; export PGCLIENTENCODING=UTF8 PGOPTIONS="-c default_transaction_read_only=on"; exec "$@"';
export function remoteArgs(tool, args = []) { return ['run', '--pull=never', '--rm', '-i', '--entrypoint', 'sh', image, '-c', sourceShell, 'nk-backup-client', tool, ...args]; }
export async function client(input,transport=dockerTransport) {
  if(!transport)throw backupError('Local Docker preflight required');
  const p = transport.start(remoteArgs('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']));
  const waiting = [], queued = [], errors = [];
  const lines = createInterface({ input: p.stdout });
  lines.on('line', line => waiting.length ? waiting.shift().yes(line) : queued.push(line));
  p.stderr.on('data', x => errors.push(x));
  p.on('error', () => { while(waiting.length) waiting.shift().no(backupError('Source client launch failed')); });
  let stage='initial';
  p.on('close', code => { const raw=Buffer.concat(errors).toString(); const state=raw.match(/ERROR:\s+([0-9A-Z]{5})(?:\s|$)/)?.[1]||'unavailable'; while(waiting.length) waiting.shift().no(backupError(`Source session ${stage} closed: ${code}; SQLSTATE ${state}; ${category(raw)}`)); });
  p.stdin.write(input + '\\set VERBOSITY sqlstate\nbegin transaction isolation level repeatable read read only; set local search_path=pg_catalog;\n');
  let ended=false;
  return {
    async query(sql,label='source-query') { stage=label; const result = queued.length ? Promise.resolve(queued.shift()) : new Promise((yes,no) => waiting.push({yes,no})); p.stdin.write(sql + '\n'); return JSON.parse(await result); },
    close() { if(!ended){ended=true;p.stdin.end('commit;\n');} },
    abort() { if(!ended){ended=true;p.stdin.end('rollback;\n');} }
  };
}
const quote = s => '"' + s.replaceAll('"','""') + '"';
const literal = s => "'" + s.replaceAll("'", "''") + "'";
const tableListSql = `select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'extension',e.extname,'config',coalesce(c.oid=any(e.extconfig),false)) order by n.nspname,c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_depend d on d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e' left join pg_extension e on e.oid=d.refobjid where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in ('r','p','S');`;
function dataSql(tables) {
  const rows = tables.filter(t => t.kind !== 'S' && (!t.extension || t.config)).map(t => `select ${literal(t.schema+'.'+t.name)} name,count(*) rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'[]')) hash from ${quote(t.schema)}.${quote(t.name)} t`);
  return `select jsonb_object_agg(name,jsonb_build_object('rows',rows,'hash',hash) order by name) from (${rows.join(' union all ')}) t;`;
}
function sequenceSql(tables) {
  const rows = tables.filter(t=>t.kind==='S').map(t=>`select ${literal(t.schema+'.'+t.name)} name,jsonb_build_object('last_value',last_value,'is_called',is_called) state from ${quote(t.schema)}.${quote(t.name)} t`);
  return rows.length ? `select jsonb_object_agg(name,state order by name) from (${rows.join(' union all ')}) t;` : `select '{}'::jsonb;`;
}
export const aclSql = (acl,owner,type) => `(select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantor::regrole::text,x.grantee::regrole::text,x.privilege_type,x.is_grantable),'[]'::jsonb)::text from aclexplode(${owner ? `coalesce(${acl},acldefault(${type},${owner}))` : acl}) x)`;
const rawSchemaSql = `with parts as (
 select 'namespace|'||nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce(nspacl::text,'') v from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema'
 union all select 'relation|'||n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||coalesce(c.relacl::text,'')||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
 union all select 'column|'||n.nspname||'.'||c.relname||'|'||(row_number() over(partition by c.oid order by a.attnum))||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||coalesce(cn.nspname||'.'||cl.collname,'') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum left join pg_collation cl on cl.oid=a.attcollation left join pg_namespace cn on cn.oid=cl.collnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and a.attnum>0 and not a.attisdropped
 union all select 'constraint|'||n.nspname||'.'||c.relname||'|'||k.conname||'|'||pg_get_constraintdef(k.oid,true) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
 union all select 'function|'||n.nspname||'.'||p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||pg_get_functiondef(p.oid)||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and p.prokind<>'a'
 union all select 'policy|'||schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname not like 'pg_%'
 union all select 'trigger|'||n.nspname||'.'||c.relname||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid,true)||'|'||t.tgenabled::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and not t.tgisinternal
 union all select 'index|'||n.nspname||'.'||c.relname||'|'||pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%'
 union all select 'view|'||n.nspname||'.'||c.relname||'|'||pg_get_viewdef(c.oid,true) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and c.relkind in ('v','m')
 union all select 'default_acl|'||pg_get_userbyid(a.defaclrole)||'|'||coalesce(n.nspname,'')||'|'||a.defaclobjtype::text||'|'||a.defaclacl::text from pg_default_acl a left join pg_namespace n on n.oid=a.defaclnamespace
 union all select 'extension|'||e.extname||'|'||e.extversion||'|'||pg_get_userbyid(e.extowner)||'|'||n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace
 union all select 'database|'||pg_get_userbyid(datdba)||'|'||coalesce(datacl::text,'')||'|'||datcollate||'|'||datctype from pg_database where datname=current_database()
 union all select 'type|'||n.nspname||'.'||t.typname||'|'||t.typtype::text||'|'||pg_get_userbyid(t.typowner)||'|'||coalesce(t.typacl::text,'')||'|'||format_type(t.typbasetype,t.typtypmod)||'|'||t.typnotnull||'|'||coalesce(t.typdefault,'') from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
 union all select 'enum|'||n.nspname||'.'||t.typname||'|'||e.enumsortorder||'|'||e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
 union all select 'domain_constraint|'||n.nspname||'.'||t.typname||'|'||k.conname||'|'||pg_get_constraintdef(k.oid,true) from pg_constraint k join pg_type t on t.oid=k.contypid join pg_namespace n on n.oid=t.typnamespace
 union all select 'sequence_definition|'||schemaname||'.'||sequencename||'|'||sequenceowner||'|'||data_type||'|'||start_value||'|'||min_value||'|'||max_value||'|'||increment_by||'|'||cycle||'|'||cache_size from pg_sequences where schemaname not like 'pg_%'
) select jsonb_build_object('hash',md5(string_agg(v,E'\\n' order by v)),'parts',count(*)) from parts;`;
export const schemaSql = rawSchemaSql
  .replace("coalesce(nspacl::text,'')",aclSql('nspacl','nspowner',"'n'"))
  .replace("coalesce(c.relacl::text,'')",aclSql('c.relacl','c.relowner',"case when c.relkind='S' then 'S'::\"char\" else 'r'::\"char\" end"))
  .replace("coalesce(p.proacl::text,'')",aclSql('p.proacl','p.proowner',"'f'"))
  .replace('a.defaclacl::text',aclSql('a.defaclacl',null,null))
  .replace("coalesce(datacl::text,'')",aclSql('datacl','datdba',"'d'"))
  .replace("coalesce(t.typacl::text,'')",aclSql('t.typacl','t.typowner',"'T'"));
const rolesSql = `select jsonb_build_object('roles',md5(string_agg((to_jsonb(r)-'oid'-'rolpassword')::text,E'\\n' order by rolname)),'memberships',md5(coalesce((select string_agg(pg_get_userbyid(roleid)||'|'||pg_get_userbyid(member)||'|'||pg_get_userbyid(grantor)||'|'||admin_option||'|'||inherit_option||'|'||set_option,E'\\n' order by pg_get_userbyid(roleid),pg_get_userbyid(member)) from pg_auth_members),''))) from pg_roles r;`;
const countsSql = `select jsonb_build_object('itemBalanceRows',(select count(*) from public.stock_balances),'itemBalanceSum',(select sum(quantity) from public.stock_balances),'configurationBalanceRows',(select count(*) from public.configuration_stock_balances),'configurationBalanceSum',(select sum(quantity) from public.configuration_stock_balances),'itemsMinimum',(select count(*) from public.items where minimum_stock<>0),'configurationMinimum',(select count(*) from public.commercial_configurations where minimum_stock<>0),'part110Balance',(select quantity from public.stock_balances b join public.items i on i.id=b.item_id where i.code='110'),'part110Minimum',(select minimum_stock from public.items where code='110'),'looseCodes',(select jsonb_agg(i.code order by i.code) from public.loose_parts l join public.items i on i.id=l.item_id),'migrationCount',(select count(*) from supabase_migrations.schema_migrations),'latestMigration',(select max(version) from supabase_migrations.schema_migrations),'vaultSecretsCount',(select count(*) from vault.secrets),'subscriptions',(select count(*) from pg_subscription));`;
export async function snapshot(c) {
  const tables = await c.query(tableListSql,'relations');
  return { tables, data: await c.query(dataSql(tables),'full-row-hashes'), sequences: await c.query(sequenceSql(tables),'sequences'), schema: await c.query(schemaSql,'schema'), roles: await c.query(rolesSql,'roles'), counts: await c.query(countsSql,'counts') };
}
export function canonical(value) { return JSON.stringify(value, function(_key,v){return v && !Array.isArray(v) && typeof v==='object' ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)) : v;}); }
function same(a,b,label) { if(canonical(a)!==canonical(b)) throw backupError(`${label} equivalence guard failed; private artifacts retained, raw data suppressed`); }
export async function artifactMetadata(destination) {
  const names=['database.dump','roles-no-passwords.sql','namespace-acls.json','namespace-acls.sql','extension-owners.json','database-restoration.sql','source-snapshot.json','restore-validation.json','storage-manifest.json'];
  return Object.fromEntries(await Promise.all(names.map(async name=>{const file=join(destination,name),bytes=await readFile(file),info=await stat(file);if(bytes.length!==info.size)throw backupError('Artifact size guard failed');return [name,{bytes:bytes.length,sha256:sha(bytes),writtenAtUtc:info.mtime.toISOString()}];})));
}
export function deriveRestorationSql(sql,extensions) {
  for(const ext of extensions.filter(e=>e.name!=='plpgsql')){
    if(!['postgres','supabase_admin'].includes(ext.owner))throw backupError('Unsupported extension owner; human decision required');
    const name=/^[a-z_][a-z0-9_]*$/.test(ext.name)?ext.name:quote(ext.name);
    const command=`CREATE EXTENSION IF NOT EXISTS ${name} WITH SCHEMA ${quote(ext.schema)};`;
    const alternate=`CREATE EXTENSION IF NOT EXISTS ${name} WITH SCHEMA ${ext.schema};`;
    const matched=sql.includes(command)?command:alternate;
    if(sql.split(matched).length!==2)throw backupError('Extension restoration statement guard failed');
    sql=sql.replace(matched,`SET SESSION AUTHORIZATION ${quote(ext.owner)};\n${matched}\nRESET SESSION AUTHORIZATION;`);
  }
  return sql;
}
export function namespaceSupplement(acls) {
  return acls.filter(n=>['graphql','graphql_public'].includes(n.schema)).flatMap(n=>n.grants.map(g=>{
    if(!['CREATE','USAGE'].includes(g.privilege)||typeof g.grantable!=='boolean')throw backupError('Namespace privilege guard failed');
    return `SET SESSION AUTHORIZATION ${quote(g.grantor)}; GRANT ${g.privilege} ON SCHEMA ${quote(n.schema)} TO ${g.grantee==='PUBLIC'?'PUBLIC':quote(g.grantee)}${g.grantable?' WITH GRANT OPTION':''}; RESET SESSION AUTHORIZATION;`;
  })).join('\n');
}
async function main() {
  const startedAtUtc=new Date().toISOString();
  for(const name of credentialNames) if(!process.env[name]) throw backupError(`${name}: UNAVAILABLE`);
  dockerTransport=await createLocalDockerTransport();
  const sourceInput = validateTargets(process.env.NK_BACKUP_DATABASE_URL,process.env.NK_BACKUP_SUPABASE_URL);
  await run(['image','inspect','--format','{{.Id}}',image]);
  const version = (await run(['run','--pull=never','--rm','--network','none','--entrypoint','pg_dump',image,'--version'])).bytes.toString().trim();
  if(version!=='pg_dump (PostgreSQL) 17.6') throw backupError('Client version guard failed');
  const id = `pr68-${new Date().toISOString().replaceAll(/[^0-9]/g,'')}-${randomBytes(4).toString('hex')}`;
  const destination = join(process.env.LOCALAPPDATA,'NK-Private-Backups',id);
  if(destination.toLowerCase().startsWith(root.toLowerCase())) throw backupError('Private backup must be outside repository');
  await mkdir(destination,{recursive:true});
  const acl = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $p='${destination.replaceAll("'","''")}'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $a=[Security.AccessControl.DirectorySecurity]::new(); $a.SetOwner($sid); $a.SetAccessRuleProtection($true,$false); foreach($s in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) { $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }; Set-Acl -LiteralPath $p -AclObject $a; $v=Get-Acl -LiteralPath $p; if(!$v.AreAccessRulesProtected -or @($v.Access).Count -ne 2) { throw 'Private ACL failed' }; $q=$p; while($q){ if((Get-Item -Force -LiteralPath $q).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse ancestor refused'}; $q=Split-Path $q -Parent }; 'PRIVATE_ACL_CONFIRMED'`;
  await run(['-NoProfile','-EncodedCommand',Buffer.from(`try { ${acl} } catch { [Console]::WriteLine('ACL_CODE:'+$_.FullyQualifiedErrorId); exit 1 }`,'utf16le').toString('base64')],null,'powershell.exe');
  let gitOutside=false; try { await run(['-C',destination,'rev-parse','--show-toplevel'],null,'git'); } catch(error) {if(!(error instanceof BackupError)||!/^Tool git:-C:local stage failed: exit 128; NOT_A_REPOSITORY\./.test(error.message))throw error;gitOutside=true;} if(!gitOutside) throw backupError('Backup directory belongs to Git');
  const container = `supabase_db_nk_pr_68_backup_${randomBytes(6).toString('hex')}`;
  await run(['run','--pull=never','--detach','--name',container,'--label','nk.disposable=backup-restore-pr-68','--network','none','--user','postgres','--entrypoint','sh',image,'-c','initdb -D /tmp/nk_pr68_data --username=supabase_admin --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C.UTF-8 >/tmp/nk_init.log 2>&1 && exec postgres -D /tmp/nk_pr68_data -c listen_addresses= -c shared_preload_libraries=']);
  const proof = JSON.parse((await run(['inspect','--format','{{json .HostConfig.NetworkMode}}',container])).bytes.toString());
  const ports = (await run(['port',container])).bytes.toString().trim();
  const label = (await run(['inspect','--format','{{index .Config.Labels "nk.disposable"}}',container])).bytes.toString().trim();
  if(proof!=='none'||ports||label!=='backup-restore-pr-68') throw backupError('Restore isolation proof failed');
  console.log(JSON.stringify({checkpoint:'TOOLS_PRIVATE_ACL_GIT_EXCLUSION_TARGET_PROVEN',credentialFlags:'AVAILABLE/AVAILABLE/AVAILABLE',targetIdentity:true,version,privateDirectory:destination,container,network:'none',publishedPorts:0}));
  const source = await client(sourceInput);
  try {
    const server=await source.query(`select jsonb_build_object('version',current_setting('server_version'),'readOnly',current_setting('transaction_read_only'),'db',current_database(),'plpgsqlOwner',(select pg_get_userbyid(extowner) from pg_extension where extname='plpgsql'));`);
    if(server.version!=='17.6'||server.readOnly!=='on'||server.db!=='postgres'||server.plpgsqlOwner!=='supabase_admin') throw backupError('Source server/bootstrap identity guard failed');
    const token=await source.query(`select to_jsonb(pg_export_snapshot());`);
    if(!/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i.test(token)) throw backupError('Snapshot token guard failed');
    const pre=await snapshot(source);
    const extensions=await source.query(`select jsonb_agg(jsonb_build_object('name',extname,'version',extversion,'owner',pg_get_userbyid(extowner),'schema',nspname) order by extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace;`,'extension-owners');
    const restoreRoleFlags=await source.query(`select jsonb_object_agg(rolname,rolsuper) from pg_roles where rolname in ('postgres','supabase_admin');`,'restore-role-flags');
    if(restoreRoleFlags.postgres!==false||restoreRoleFlags.supabase_admin!==true)throw backupError('Local bootstrap role assumptions require human decision');
    const namespaceAcls=await source.query(`select jsonb_agg(jsonb_build_object('schema',nspname,'owner',pg_get_userbyid(nspowner),'grants',${aclSql('nspacl','nspowner',"'n'")}::jsonb) order by nspname) from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema';`,'namespace-grants');
    if(pre.counts.vaultSecretsCount!==0||pre.counts.subscriptions!==0) throw backupError('External encryption/replication dependency: human decision required');
    const expected={'public.items':106,'public.loose_parts':5,'public.servo_models':22,'public.installation_kits':74,'public.repair_kits':5,'public.commercial_configurations':80,'public.commercial_configuration_codes':80,'public.servo_repair_compatibility':22,'public.vehicle_applications':295,'public.vehicle_application_brands':8,'auth.users':3,'public.profiles':3,'public.safisa_portal_members':1,'storage.objects':76};
    for(const [name,count]of Object.entries(expected))if(pre.data[name]?.rows!==count)throw backupError('PRE count guard failed');
    const operationalNames=['stock_balances','stock_movements','supplier_orders','movement_batches','assembly_operations','inbound_batch_lines','outbound_batch_lines','safisa_portal_events','supplier_order_items','minimum_stock_changes','supplier_order_events','push_notification_events','private.stock_adjustment_requests','safisa_order_authorizations','configuration_stock_balances','supplier_order_stock_entries','configuration_stock_movements','private.configuration_operation_requests','supplier_order_stock_entry_lines','configuration_minimum_stock_changes'];
    const operationalRows=operationalNames.reduce((sum,name)=>sum+(pre.data[name.includes('.')?name:'public.'+name]?.rows??NaN),0);
    if(operationalRows!==411)throw backupError('PRE operational total guard failed');
    same(pre.counts.looseCodes,['067','091','091/VF','110','SUB071'],'PRE exact loose identities');
    if(pre.counts.migrationCount!==38||pre.counts.latestMigration!=='20260917120000'||pre.counts.itemBalanceRows!==15||pre.counts.itemBalanceSum!==76||pre.counts.configurationBalanceRows!==12||pre.counts.configurationBalanceSum!==42||pre.counts.itemsMinimum!==7||pre.counts.configurationMinimum!==4||pre.counts.part110Balance!==7||pre.counts.part110Minimum!==7)throw backupError('PRE operational guard failed');
    await writeFile(join(destination,'source-snapshot.json'),JSON.stringify(pre,null,2));
    await writeFile(join(destination,'namespace-acls.json'),JSON.stringify(namespaceAcls,null,2));
    await writeFile(join(destination,'extension-owners.json'),JSON.stringify(extensions,null,2));
    console.log('DUMP_STARTED_READ_ONLY_EXPORTED_SNAPSHOT');
    const dump=await run(remoteArgs('pg_dump',['--format=custom','--create',`--snapshot=${token}`,'--lock-wait-timeout=10s']),sourceInput);
    if(dump.stderr)throw backupError('Dump warnings require review; raw output suppressed');
    await writeFile(join(destination,'database.dump'),dump.bytes);
    const roles=await run(remoteArgs('pg_dumpall',['--roles-only','--no-role-passwords']),sourceInput);
    if(roles.stderr)throw backupError('Roles warnings require review');
    await writeFile(join(destination,'roles-no-passwords.sql'),roles.bytes);
    same(await source.query(sequenceSql(pre.tables)),pre.sequences,'Source sequence during dump');
    source.close();
    console.log(JSON.stringify({checkpoint:'DUMP_COMPLETE',bytes:dump.bytes.length,sha256:sha(dump.bytes)}));
    const headers={apikey:process.env.NK_BACKUP_SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.NK_BACKUP_SUPABASE_SECRET_KEY}`,'Content-Type':'application/json'};
    const base=process.env.NK_BACKUP_SUPABASE_URL.replace(/\/$/,'')+'/storage/v1';
    async function api(path,options={}) { const r=await fetch(base+path,{...options,headers,redirect:'error'}).catch(()=>{throw backupError('Storage request failed; details suppressed')}); if(!r.ok)throw backupError(`Storage status ${r.status}; details suppressed`);return r; }
    async function list(prefix='') { const all=[];let offset=0;for(;;){const rows=await(await api(`/object/list/${bucket}`,{method:'POST',body:JSON.stringify({prefix,limit:1000,offset,sortBy:{column:'name',order:'asc'}})})).json();if(!Array.isArray(rows))throw backupError('Invalid Storage list');for(const row of rows){const path=prefix?prefix+'/'+row.name:row.name;if(row.id)all.push({...row,path});else all.push(...await list(path));}if(rows.length<1000)break;offset+=rows.length;}return all.sort((a,b)=>a.path.localeCompare(b.path)); }
    const listed=await list();if(listed.length!==76||new Set(listed.map(x=>x.path.toLowerCase())).size!==76)throw backupError('Storage list count/case collision guard failed');
    console.log('STORAGE_LISTED_76_DOWNLOAD_STARTED');
    const manifest=[];
    for(const obj of listed){const encoded=obj.path.split('/').map(encodeURIComponent).join('/');const bytes=Buffer.from(await(await api(`/object/authenticated/${bucket}/${encoded}`)).arrayBuffer());const file=safePath(join(destination,'storage'),obj.path);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);if(obj.metadata?.size!==undefined&&Number(obj.metadata.size)!==bytes.length)throw backupError('Storage metadata size mismatch');manifest.push({path:obj.path,id:obj.id,bytes:bytes.length,sha256:sha(bytes)});}
    same(await list(),listed,'Storage list before/after');
    for(const obj of manifest){const bytes=await readFile(safePath(join(destination,'storage'),obj.path));if(bytes.length!==obj.bytes||sha(bytes)!==obj.sha256)throw backupError('Storage byte/checksum guard failed');}
    await writeFile(join(destination,'storage-manifest.json'),JSON.stringify(manifest,null,2));
    const fresh=await client(sourceInput);const after=await snapshot(fresh);fresh.close();same(after,pre,'Source fresh after dump/export');
    const metadataSource=await client(sourceInput);const metadata=await metadataSource.query(`select jsonb_agg(jsonb_build_object('path',name,'id',id,'size',(metadata->>'size')::bigint) order by name) from storage.objects where bucket_id='${bucket}';`);metadataSource.close();
    same(metadata,manifest.map(x=>({path:x.path,id:x.id,size:x.bytes})).sort((a,b)=>a.path.localeCompare(b.path)),'Storage API/database identity');
    console.log('STORAGE_76_LISTED_76_DOWNLOADED_76_CHECKSUMS_VALID');
    let ready=false;for(let i=0;i<40;i++){try{await run(['exec',container,'pg_isready','-U','supabase_admin','-q']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}if(!ready)throw backupError('Disposable server unavailable');
    const empty=(await run(['exec',container,'psql','-U','supabase_admin','-d','postgres','-X','-qAt','-c',"select to_regclass('public.items') is null and current_database()='postgres' and inet_server_addr() is null;"])).bytes.toString().trim();if(empty!=='t')throw backupError('Restore target must be empty local socket DB');
    const rolesText=roles.bytes.toString('utf8');if((rolesText.match(/^CREATE ROLE supabase_admin;$/gm)||[]).length!==1)throw backupError('Bootstrap role guard failed');
    await run(['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],rolesText.replace(/^CREATE ROLE supabase_admin;\r?\n/m,''));
    console.log('RESTORE_STARTED_NEW_DISPOSABLE_NETWORK_NONE');
    const sqlDump=await run(['exec','-i',container,'pg_restore','--file=-','--create','--clean','--if-exists'],createReadStream(join(destination,'database.dump')));
    if(sqlDump.stderr)throw backupError('Restore SQL warnings require review');
    const restorationSql=deriveRestorationSql(sqlDump.bytes.toString('utf8'),extensions);
    await writeFile(join(destination,'database-restoration.sql'),restorationSql);
    const supplemental=namespaceSupplement(namespaceAcls);
    await writeFile(join(destination,'namespace-acls.sql'),supplemental);
    // Only this verified disposable clone: extension creation needs the original
    // postgres owner. Restore its original non-superuser attribute immediately.
    await run(['exec','-i',container,'psql','-U','supabase_admin','-d','template1','-X','-qAt','-v','ON_ERROR_STOP=1'],'ALTER ROLE postgres SUPERUSER;\n');
    try{await run(['exec','-i',container,'psql','-U','supabase_admin','-d','template1','-X','-qAt','-v','ON_ERROR_STOP=1'],createReadStream(join(destination,'database-restoration.sql')));}
    finally{await run(['exec','-i',container,'psql','-U','supabase_admin','-d','template1','-X','-qAt','-v','ON_ERROR_STOP=1'],'ALTER ROLE postgres NOSUPERUSER;\n');}
    await run(['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],supplemental);
    const local={async query(sql){const r=await run(['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],`set search_path=pg_catalog;\n${sql}\n`);return JSON.parse(r.bytes.toString().trim());}};
    const restored=await snapshot(local);same(restored,pre,'Restored data/schema/owners/ACL/roles/sequences');
    await writeFile(join(destination,'restore-validation.json'),JSON.stringify(restored,null,2));
    const finalSource=await client(sourceInput);same(await snapshot(finalSource),pre,'Final source drift');finalSource.close();same(await list(),listed,'Final Storage drift');
    const artifacts=await artifactMetadata(destination);
    if(artifacts['database.dump'].sha256!==sha(dump.bytes))throw backupError('Original archive mutation guard failed');
    const report={status:'BACKUP VALIDATED — RESET STILL NOT EXECUTED',backupId:id,privateDirectory:destination,startedAtUtc,createdAtUtc:new Date().toISOString(),sourceMainSha:'50af5996ff0fb7e36c2c3ae08d20ca3232df6cdc',head:(await run(['-C',root,'rev-parse','HEAD'],null,'git')).bytes.toString().trim(),pgDumpVersion:version,dumpBytes:dump.bytes.length,dumpSha256:sha(dump.bytes),rolesSha256:sha(roles.bytes),artifacts,operationalRows,storage:{listed:76,downloaded:76,checksummed:76,totalBytes:manifest.reduce((a,x)=>a+x.bytes,0),manifestSha256:sha(await readFile(join(destination,'storage-manifest.json')))},restore:{container,network:'none',ports:0,host:'local Unix socket',database:'postgres',status:'PASS',dataHash:sha(JSON.stringify(pre.data)),schema:pre.schema,roles:pre.roles,sequences:pre.sequences,counts:pre.counts,rows:Object.fromEntries(Object.entries(pre.data).map(([k,v])=>[k,v.rows]))},consistency:'Dump and source comparisons share an exported read-only snapshot. Roles are captured separately and compared before/after/restore. Sequences are not MVCC: before/during/after/restore states match. Storage API is independent: before/after/final list identity and metadata match; downloaded bytes match metadata and local SHA256.',recoverySet:'Original database.dump + roles-no-passwords.sql + extension-owners.json + namespace-acls.json/sql + 76 Storage files/manifest. Dump alone is insufficient for exact extension owners and graphql namespace grants.',localRestore:'pg_restore --file=- --create --clean --if-exists derives private SQL from the intact archive. SET SESSION AUTHORIZATION wraps each extension CREATE with its source owner. postgres is temporarily SUPERUSER only in this network-none clone and returns to NOSUPERUSER in finally; full roles hash matches source. psql ON_ERROR_STOP=1 executes private SQL and grants supplement. No owner/ACL omission or ignored failure.',limitations:['Logical database/Storage recovery, not a full Supabase infrastructure clone. Runtime role passwords/JWT/OAuth and external credentials are not archived. Roles intentionally exclude passwords; vault.secrets is empty.','CREATE DATABASE cannot be in one transaction: restore is fail-fast in a new isolated target. Physical attnum gaps of dropped columns are not reproduced; every live column and its logical order/type/default/nullability/identity/generated/collation are compared. ACL normalization retains every grantor/grantee/privilege/grantable tuple.','Storage and role exports do not share the dump transaction. Independent drift checks passed; this backup must have freshness/deltas revalidated before any separately authorized reset.'],remoteWrites:false,remoteReset:false,remoteCachePurge:false};
    await writeFile(join(destination,'backup-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }catch(e){source.abort();throw e;}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error('BACKUP NOT VALIDATED — RESET STILL NOT EXECUTED');console.error(safeErrorMessage(e));process.exitCode=1;});
