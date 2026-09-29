import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { validateTargets, safePath, sha, canonical, sanitizedChildEnv, remoteArgs, ref, category, deriveRestorationSql, namespaceSupplement, safeErrorMessage } from '../scripts/deployment-backup.mjs';

const api=`https://${ref}.supabase.co`;
const db=`postgresql://postgres.${ref}:fixture-password@fixture.pooler.supabase.com:5432/postgres`;
test('target proof produces credentials only for protected stdin',()=>{
  const input=validateTargets(db,api);
  assert.equal(input.split('\n').length,8);
  const args=remoteArgs('pg_dump',['--format=custom']);
  assert.equal(args.includes('fixture-password'),false);
  assert.equal(args.includes(db),false);
  assert.equal(args.includes(api),false);
});
test('safe defaults are used only when security options are absent',()=>{
  assert.deepEqual(validateTargets(db,api).trimEnd().split('\n').slice(-2),['require','15']);
});
test('strict supplied TLS and timeout are preserved, not downgraded',()=>{
  for(const mode of ['verify-ca','verify-full'])assert.deepEqual(validateTargets(db+`?sslmode=${mode}&connect_timeout=29`,api).trimEnd().split('\n').slice(-2),[mode,'29']);
});
test('weak TLS, invalid timeout and duplicate options abort',()=>{
  for(const suffix of ['?sslmode=','?connect_timeout=','?sslmode=disable','?sslmode=prefer','?connect_timeout=0','?connect_timeout=121','?sslmode=require&sslmode=verify-full','?options=unsafe'])assert.throws(()=>validateTargets(db+suffix,api));
});
test('wrong project, protocol, database or API identity aborts',()=>{
  for(const source of [db.replace(ref,'other'),db.replace('/postgres','/other'),db.replace('postgresql:','http:')])assert.throws(()=>validateTargets(source,api));
  for(const endpoint of ['http://'+ref+'.supabase.co','https://other.supabase.co',api+'/other',api+'?token=fixture'])assert.throws(()=>validateTargets(db,endpoint));
});
test('credential line injection is rejected before transport',()=>{
  assert.throws(()=>validateTargets(db.replace('fixture-password','fixture%0Apassword'),api));
  assert.throws(()=>validateTargets(db.replace('fixture-password','fixture%00password'),api));
});
test('child environment excludes all admin credentials without changing parent',()=>{
  const env={NK_BACKUP_DATABASE_URL:db,NK_BACKUP_SUPABASE_URL:api,NK_BACKUP_SUPABASE_SECRET_KEY:'fixture-key',PATH:'fixture-path'};
  assert.deepEqual(sanitizedChildEnv(env),{PATH:'fixture-path'});
  assert.equal(env.NK_BACKUP_SUPABASE_SECRET_KEY,'fixture-key');
});
test('Storage nested names preserve literal Unicode and quotes',()=>{
  const base=resolve('fixture-private');
  assert.equal(safePath(base,"catálogo/servo d'água.png"),resolve(base,"catálogo","servo d'água.png"));
});
test('Storage traversal, Windows special paths and collisions are refused',()=>{
  for(const path of ['../file','/file','a//b','a/./b','C:/file','a\\b','a\0b','a:stream','CON.png','x/NUL','file.','file ','x?y','x|y'])assert.throws(()=>safePath(resolve('fixture-private'),path));
});
test('complete hashes notice byte mutation',()=>{
  assert.equal(sha(Buffer.from('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(sha(Buffer.from('abc')),sha(Buffer.from('abd')));
});
test('equivalence ignores object key serialization order, never changed values or arrays',()=>{
  assert.equal(canonical({z:[{b:2,a:1}],a:3}),canonical({a:3,z:[{a:1,b:2}]}));
  assert.notEqual(canonical({a:1}),canonical({a:2}));
  assert.notEqual(canonical([1,2]),canonical([2,1]));
});
test('error classification returns categories, never source-specific text',()=>{
  assert.equal(category('password authentication failed fixture-secret'),'AUTHENTICATION');
  assert.equal(category('permission denied fixture-secret'),'PERMISSION');
  assert.equal(category('unknown fixture-secret'),'SUPPRESSED_ERROR');
});
test('derived SQL wraps only the exact source extension CREATE, preserving payload',()=>{
  const sql='CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;\nCOPY fixture FROM stdin;\nfixture-row\n\\.\n';
  const result=deriveRestorationSql(sql,[{name:'pgcrypto',schema:'extensions',owner:'postgres'}]);
  assert.equal(result,'SET SESSION AUTHORIZATION "postgres";\nCREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;\nRESET SESSION AUTHORIZATION;\nCOPY fixture FROM stdin;\nfixture-row\n\\.\n');
  assert.equal(sql.startsWith('CREATE'),true);
});
test('restore derivation rejects missing, duplicate, or unaudited owner statements',()=>{
  const ext={name:'pgcrypto',schema:'extensions',owner:'postgres'};
  assert.throws(()=>deriveRestorationSql('',[ext]));
  const statement='CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;';
  assert.throws(()=>deriveRestorationSql(statement+'\n'+statement,[ext]));
  assert.throws(()=>deriveRestorationSql(statement,[{...ext,owner:'unexpected'}]));
});
test('quoted extension name and schema are supported without identifier injection',()=>{
  assert.match(deriveRestorationSql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";',[{name:'uuid-ossp',schema:'extensions',owner:'postgres'}]),/^SET SESSION AUTHORIZATION "postgres";/);
});
test('ACL supplement preserves grantor, grantee, privilege and grant option',()=>{
  const result=namespaceSupplement([{schema:'graphql',grants:[{grantor:'supabase_admin',grantee:'postgres',privilege:'USAGE',grantable:true},{grantor:'supabase_admin',grantee:'PUBLIC',privilege:'USAGE',grantable:false}]}]);
  assert.equal(result,'SET SESSION AUTHORIZATION "supabase_admin"; GRANT USAGE ON SCHEMA "graphql" TO "postgres" WITH GRANT OPTION; RESET SESSION AUTHORIZATION;\nSET SESSION AUTHORIZATION "supabase_admin"; GRANT USAGE ON SCHEMA "graphql" TO PUBLIC; RESET SESSION AUTHORIZATION;');
});
test('ACL supplement rejects non-schema privileges instead of interpolating arbitrary SQL',()=>{
  assert.throws(()=>namespaceSupplement([{schema:'graphql',grants:[{grantor:'supabase_admin',grantee:'postgres',privilege:'DROP SCHEMA',grantable:false}]}]));
});
test('unexpected parse/filesystem/runtime errors cannot print source-specific secrets',()=>{
  assert.equal(safeErrorMessage(new Error('fixture-secret response')), 'Backup stage failed; unclassified details suppressed.');
  try{validateTargets(db,'https://other.supabase.co');}catch(error){assert.equal(safeErrorMessage(error),'Target identity guard failed');}
});
