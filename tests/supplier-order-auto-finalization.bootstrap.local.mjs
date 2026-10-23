// Schema-only from the labelled local #95 fixture; never any remote URL/data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const source = "supabase_db_nk_issue95", container = "supabase_db_nk_issue100";
const run = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", windowsHide: true, maxBuffer: 25 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
assert.equal(JSON.parse(run(["inspect", "-f", "{{json .Config.Labels}}", source]))["nk.disposable"], "nk-issue95");
assert.equal(run(["inspect", "-f", "{{.HostConfig.NetworkMode}}", source]).trim(), "none");
assert.ok(!run(["ps", "-a", "--format", "{{.Names}}"]).trim().split(/\r?\n/).includes(container), "Fresh issue100 container required");
run(["run", "--pull=never", "--detach", "--name", container, "--label", "nk.disposable=nk-issue100", "--network", "none", "--user", "postgres", "--entrypoint", "sh",
  "public.ecr.aws/supabase/postgres:17.6.1.165", "-c", "initdb -D /tmp/nk100 --username=postgres --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C.UTF-8 >/tmp/nk100-init.log 2>&1 && exec postgres -D /tmp/nk100 -c listen_addresses= -c shared_preload_libraries="]);
let ready = false;
for (let n = 0; n < 40; n++) {
  try { run(["exec", container, "pg_isready", "-U", "postgres", "-q"]); ready = true; break; } catch { await new Promise(r => setTimeout(r, 250)); }
}
assert.ok(ready);
const sql = input => run(["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], input);
const roles = JSON.parse(run(["exec", source, "psql", "-U", "postgres", "-d", "nk95_test", "-X", "-qAt", "-c", "select json_agg(rolname) from pg_roles where rolname not like 'pg_%' and rolname <> 'postgres'"]));
sql(roles.map(name => `create role "${name.replaceAll('"', '""')}";`).join("\n") + "\ncreate schema extensions; create extension pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;");
const schema = run(["exec", source, "pg_dump", "-U", "postgres", "-d", "nk95_test", "--schema-only", "--no-owner", "--schema=public", "--schema=private", "--schema=auth"]);
sql(schema.replace(/^CREATE SCHEMA public;$/m, ""));
const versions = JSON.parse(readFileSync(new URL("./fixtures/nk-migration-history-20261023.json", import.meta.url), "utf8")).versions;
sql(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);
  insert into supabase_migrations.schema_migrations(version) values ${versions.map(v => `('${v}')`).join(",")};`);
// Synthetic catalog only. Stable IDs match existing atomic pickup regression fixtures.
sql(`insert into public.items(id,code,description,item_type) values
 ('d9bfc725-87a3-4194-8f51-bdc49d95bd8c','1','SERVO FIXTURE','SERVO'),
 ('10000000-0000-4000-8000-000000000011','KT-02','KIT FIXTURE','INSTALLATION_KIT'),
 ('10000000-0000-4000-8000-000000000012','NK100-P','PECA FIXTURE','LOOSE_PART'),
 ('10000000-0000-4000-8000-000000000013','NK100-R','REPARO FIXTURE','REPAIR_KIT'),
 ('10000000-0000-4000-8000-000000000014','NK100-P2','PECA FIXTURE 2','LOOSE_PART'),
 ('10000000-0000-4000-8000-000000000015','NK100-P3','PECA FIXTURE 3','LOOSE_PART');
 insert into public.servo_models(item_id,model) values('d9bfc725-87a3-4194-8f51-bdc49d95bd8c','MBF-FIXTURE');
 insert into public.installation_kits(item_id,name) values('10000000-0000-4000-8000-000000000011','KIT FIXTURE');
 insert into public.loose_parts(item_id) values('10000000-0000-4000-8000-000000000012'),('10000000-0000-4000-8000-000000000014'),('10000000-0000-4000-8000-000000000015');
 insert into public.repair_kits(item_id,name) values('10000000-0000-4000-8000-000000000013','REPARO FIXTURE');
 insert into public.commercial_configurations(id,description,servo_id,installation_kit_id) values
 ('ffdbc822-37ab-4018-a476-b7e6e1f0e596','CONFIG FIXTURE','d9bfc725-87a3-4194-8f51-bdc49d95bd8c','10000000-0000-4000-8000-000000000011');
 insert into public.commercial_configuration_codes(id,configuration_id,code) values
 ('9ec6cc33-6b9e-4143-831a-31cb1c0571c0','ffdbc822-37ab-4018-a476-b7e6e1f0e596','1B'),
 ('781e9bec-c1d7-46a3-a4f6-0a9b7c303771','ffdbc822-37ab-4018-a476-b7e6e1f0e596','1D');`);
sql(readFileSync(new URL("../supabase/migrations/20261023043855_auto_finalize_integral_supplier_order_pickup.sql", import.meta.url), "utf8"));
console.log("Issue100: schema-only clone, synthetic catalog, network none, no ports, migration local ONLY.");
