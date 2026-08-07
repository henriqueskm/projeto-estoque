import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const workdir = process.env.SAFISA_LOCAL_WORKDIR;
assert.ok(workdir, "SAFISA_LOCAL_WORKDIR is required");
const container = "supabase_db_nk_current_state_baseline";
const windowsDocker = join(process.env.LOCALAPPDATA ?? "", "Programs", "DockerDesktop", "resources", "bin", "docker.exe");
const docker = existsSync(windowsDocker) ? windowsDocker : "docker";

function statusEnv() {
  const cli = resolve("node_modules/.bin/supabase.ps1");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", cli, "status", "-o", "env"],
    { encoding: "utf8", cwd: workdir },
  );
  return Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_]+)="(.*)"$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function psql(sql) {
  return execFileSync(docker, ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const env = statusEnv();
assert.ok(env.API_URL && env.SERVICE_ROLE_KEY, "Local Supabase status is incomplete");
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const accounts = [
  { id: "20000000-0000-4000-8000-000000000101", email: "internal@example.test", password: "Local-Internal-2026!", name: "Equipe Local" },
  { id: "20000000-0000-4000-8000-000000000102", email: "safisa.a@example.test", password: "Local-Safisa-A-2026!", name: "Safisa Ana" },
  { id: "20000000-0000-4000-8000-000000000103", email: "safisa.b@example.test", password: "Local-Safisa-B-2026!", name: "Safisa Bruno" },
  { id: "20000000-0000-4000-8000-000000000104", email: "outsider@example.test", password: "Local-Outsider-2026!", name: "Sem Acesso" },
];

for (const account of accounts) {
  const { error } = await admin.auth.admin.createUser({ id: account.id, email: account.email, password: account.password, email_confirm: true, user_metadata: { full_name: account.name } });
  if (error && !/already.*registered|already exists/i.test(error.message)) throw error;
}

psql(`
  truncate table public.safisa_portal_events, public.safisa_order_authorizations,
    public.safisa_portal_members, public.supplier_order_events,
    public.supplier_order_items, public.supplier_orders cascade;
  insert into public.profiles (id, name, is_active) values
    ('${accounts[0].id}', '${accounts[0].name}', true),
    ('${accounts[1].id}', '${accounts[1].name}', false),
    ('${accounts[2].id}', '${accounts[2].name}', false),
    ('${accounts[3].id}', '${accounts[3].name}', false)
  on conflict (id) do update set
    name = excluded.name,
    is_active = excluded.is_active;
  update public.profiles set name = case id
    when '${accounts[0].id}' then '${accounts[0].name}'
    when '${accounts[1].id}' then '${accounts[1].name}'
    when '${accounts[2].id}' then '${accounts[2].name}'
    when '${accounts[3].id}' then '${accounts[3].name}' end,
    is_active = (id = '${accounts[0].id}')
  where id in (${accounts.map(({ id }) => `'${id}'`).join(",")});
  insert into public.safisa_portal_members (
    user_id, is_active, created_by, created_by_name_snapshot,
    activated_at, activated_by, activated_by_name_snapshot
  ) values
    ('${accounts[1].id}', true, '${accounts[0].id}', '${accounts[0].name}', now(), '${accounts[0].id}', '${accounts[0].name}'),
    ('${accounts[2].id}', true, '${accounts[0].id}', '${accounts[0].name}', now(), '${accounts[0].id}', '${accounts[0].name}');
  with catalog as (
    select id from public.items where is_active order by created_at, id limit 1
  ), created_orders as (
    insert into public.supplier_orders (id, negotiation_number, order_date, created_by, created_by_name_snapshot, finalized_at, finalized_by, finalized_by_name_snapshot)
    values
      ('20000000-0000-4000-8000-000000000201', 'SAF-UI-001', current_date, '${accounts[0].id}', '${accounts[0].name}', null, null, null),
      ('20000000-0000-4000-8000-000000000202', 'SAF-UI-ENCERRADO', current_date - 1, '${accounts[0].id}', '${accounts[0].name}', now(), '${accounts[0].id}', '${accounts[0].name}'),
      ('20000000-0000-4000-8000-000000000203', 'SAF-UI-OCULTO', current_date - 2, '${accounts[0].id}', '${accounts[0].name}', null, null, null),
      ('20000000-0000-4000-8000-000000000204', 'SAF-UI-REVOGADO', current_date - 3, '${accounts[0].id}', '${accounts[0].name}', null, null, null)
    returning id
  )
  insert into public.supplier_order_items (
    id, supplier_order_id, item_id, code_snapshot, description_snapshot, model_snapshot,
    item_type_snapshot, ordered_quantity, ready_quantity, picked_quantity,
    stocked_quantity, cancelled_quantity, position
  )
  select * from (values
    ('20000000-0000-4000-8000-000000000301'::uuid, '20000000-0000-4000-8000-000000000201'::uuid, (select id from catalog), '1', 'SERVO MBF-015 SEM KIT PARA TESTE LOCAL', 'MBF-015', 'SERVO', 10, 3, 1, 0, 0, 0),
    ('20000000-0000-4000-8000-000000000302'::uuid, '20000000-0000-4000-8000-000000000201'::uuid, (select id from catalog), 'KT-29', 'KIT DE INSTALAÇÃO KT-29 PARA TESTE LOCAL', 'KT-29', 'INSTALLATION_KIT', 5, 0, 0, 0, 0, 1),
    ('20000000-0000-4000-8000-000000000303'::uuid, '20000000-0000-4000-8000-000000000202'::uuid, (select id from catalog), 'R064', 'KIT DE REPARO R064 ENCERRADO', 'R064', 'REPAIR_KIT', 2, 2, 2, 0, 0, 0),
    ('20000000-0000-4000-8000-000000000304'::uuid, '20000000-0000-4000-8000-000000000203'::uuid, (select id from catalog), '110', 'ITEM NÃO PUBLICADO', '110', 'LOOSE_PART', 1, 0, 0, 0, 0, 0),
    ('20000000-0000-4000-8000-000000000305'::uuid, '20000000-0000-4000-8000-000000000204'::uuid, (select id from catalog), '11', 'ITEM REVOGADO', 'AL-10', 'SERVO', 1, 0, 0, 0, 0, 0)
  ) as fixture(id, supplier_order_id, item_id, code_snapshot, description_snapshot, model_snapshot, item_type_snapshot, ordered_quantity, ready_quantity, picked_quantity, stocked_quantity, cancelled_quantity, position);
  insert into public.safisa_order_authorizations (
    supplier_order_id, is_authorized, published_by, published_by_name_snapshot,
    revoked_at, revoked_by, revoked_by_name_snapshot
  ) values
    ('20000000-0000-4000-8000-000000000201', true, '${accounts[0].id}', '${accounts[0].name}', null, null, null),
    ('20000000-0000-4000-8000-000000000202', true, '${accounts[0].id}', '${accounts[0].name}', null, null, null),
    ('20000000-0000-4000-8000-000000000204', false, '${accounts[0].id}', '${accounts[0].name}', now(), '${accounts[0].id}', '${accounts[0].name}');
`);

assert.equal(psql("select count(*) from public.safisa_portal_members where is_active"), "2");
assert.equal(psql("select count(*) from public.safisa_order_authorizations where is_authorized"), "2");
console.log("SAFISA PORTAL BROWSER FIXTURE: READY (LOCAL ONLY)");
