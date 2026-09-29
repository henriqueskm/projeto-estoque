// Synthetic PostgreSQL observer test; NOT a Dashboard OFF/HTTP queue proof.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createLocalDockerTransport, image } from '../scripts/deployment-backup.mjs';
import { activitySql, isDrained } from '../scripts/deployment-data-api-maintenance.mjs';

const transport = await createLocalDockerTransport();
const container = `supabase_db_nk_pr_68_maintenance_${randomBytes(6).toString('hex')}`;
const label = 'data-api-maintenance-pr-68';
async function prove() {
  const proof = JSON.parse((await transport.run(['inspect','--format','{"network":{{json .HostConfig.NetworkMode}},"label":{{json (index .Config.Labels "nk.disposable")}},"ports":{{json .NetworkSettings.Ports}}}',container])).bytes.toString());
  assert.equal(proof.network,'none'); assert.equal(proof.label,label); assert.equal(Object.keys(proof.ports??{}).length,0);
}
async function sql(statement, user='postgres') {
  await prove();
  return (await transport.run(['exec','-i',container,'psql','-X','-qAt','-U',user,'-d','postgres','-v','ON_ERROR_STOP=1'],statement)).bytes.toString().trim();
}
async function stats() { return JSON.parse(await sql(`begin read only;${activitySql}rollback;`)); }
async function session() {
  await prove();
  const process = transport.start(['exec','-i',container,'psql','-X','-qAt','-U','authenticator','-d','postgres','-v','ON_ERROR_STOP=1']);
  const lines = createInterface({input:process.stdout});
  const pending=[]; lines.on('line',line=>{if(line==='NK_TEST_READY')pending.shift()?.();});
  process.stderr.on('data',()=>{});
  const closed=new Promise((yes,no)=>{process.on('close',code=>code===0?yes():no(Error('LOCAL_SESSION_FAILED')));process.on('error',()=>no(Error('LOCAL_SESSION_FAILED')));});
  return { write:statement=>process.stdin.write(statement+'\n'), ready:statement=>new Promise(yes=>{pending.push(yes);process.stdin.write(statement+'\n\\echo NK_TEST_READY\n');}), close:()=>{process.stdin.end('rollback;\n');return closed;} };
}
async function until(predicate) {
  for(let i=0;i<50;i++){const value=await stats();if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}
  throw Error('LOCAL_OBSERVATION_NOT_REACHED');
}
try {
  await transport.run(['image','inspect','--format','{{.Id}}',image]);
  await transport.run(['run','--pull=never','--detach','--name',container,'--label',`nk.disposable=${label}`,'--network','none','--user','postgres','--entrypoint','sh',image,'-c','initdb -D /tmp/nk_maintenance --username=postgres --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C.UTF-8 >/tmp/nk_init.log 2>&1 && exec postgres -D /tmp/nk_maintenance -c listen_addresses= -c shared_preload_libraries=']);
  await prove();
  let ready=false;for(let i=0;i<40;i++){try{await transport.run(['exec',container,'pg_isready','-U','postgres','-q']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert.equal(ready,true);
  await sql('create role authenticator login nosuperuser;create table public.nk_fixture(id integer primary key,value integer not null);insert into public.nk_fixture values(1,0);grant select,update on public.nk_fixture to authenticator;');
  const first=await session(); await first.ready('select 1;');
  assert.equal(isDrained(await until(v=>v.sessions.total===1&&v.sessions.transactions===0)),true); // Idle pool is allowed.
  await first.ready('begin;update public.nk_fixture set value=1 where id=1;');
  assert.equal(isDrained(await until(v=>v.sessions.idleInTransaction===1)),false);
  const second=await session();second.write('begin;update public.nk_fixture set value=2 where id=1;');
  assert.equal(isDrained(await until(v=>v.sessions.waitingLock===1)),false);
  await first.close();await second.ready('select 1;');await second.close();
  assert.equal(await sql('select value from public.nk_fixture where id=1;'),'0');
  assert.equal(isDrained(await until(v=>v.sessions.total===0)),true);
  console.log(JSON.stringify({status:'LOCAL_OBSERVER_PASS',container,network:'none',publishedPorts:0,label,checks:5,syntheticOnly:true,dashboardOffProven:false,httpQueueProven:false,sourcePrivilegesProvenByFixture:false}));
} catch { console.error('LOCAL_OBSERVER_FAILED — synthetic target retained; raw details suppressed.');process.exitCode=1; }
