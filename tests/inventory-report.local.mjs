// Real PostgreSQL/RLS regression in a new disposable LOCAL database, never a URL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const container = "supabase_db_nk_current_state_baseline";
const database = `nk86_report_${Date.now()}`;
assert.match(database, /^nk86_report_\d+$/);
const run = args => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
assert.equal(run(["inspect", "-f", "{{.Name}}", container]).trim(), `/${container}`);
run(["exec", container, "createdb", "-U", "postgres", "-T", "template0", database]);
const sql = statement => run(["exec", container, "psql", "-U", "postgres", "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement]).trim();
const user = "86000000-0000-4000-8000-000000000001", other = "86000000-0000-4000-8000-000000000002", inactive = "86000000-0000-4000-8000-000000000003";
// Copy the canonical local auth helper definition, not its production data.
const activeHelper = run(["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-c", "select pg_get_functiondef('private.is_active_profile()'::regprocedure)"]);
sql(`create schema auth; create schema private;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.profiles(id uuid primary key, is_active boolean not null);
  insert into public.profiles values('${user}',true),('${other}',true),('${inactive}',false);
  ${activeHelper}; grant usage on schema auth,private to authenticated;
  revoke all on function private.is_active_profile() from public,anon; grant execute on function private.is_active_profile() to authenticated;`);
const migration = readFileSync(new URL("../supabase/migrations/20261008115955_inventory_report_settings.sql", import.meta.url), "utf8");
sql(migration);
const asUser = (statement, id = user, role = "authenticated") => sql(`begin; select set_config('request.jwt.claim.sub','${id}',true); set local role ${role}; ${statement}; commit;`);
const order = ["SERVO_WITH_KIT", "SERVO_LOOSE", "INSTALLATION_KIT", "REPAIR_KIT", "LOOSE_PART", "BUNDLE"];
const literal = values => `array[${values.map(value => `'${value}'`).join(",")}]::text[]`;
const current = () => JSON.parse(sql("select row_to_json(s) from public.inventory_report_settings s"));

test("migration seeded exactly one shared row with six categories and RLS", () => {
  assert.deepEqual(current().category_order, order);
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.inventory_report_settings'::regclass"), "t");
  assert.equal(sql("select count(*) from public.inventory_report_settings"), "1");
});
test("active users save the same shared order; DB derives real author/time", () => {
  const custom = [...order].reverse();
  asUser(`update public.inventory_report_settings set category_order=${literal(custom)} where singleton`);
  assert.deepEqual(current().category_order, custom); assert.equal(current().updated_by, user);
  assert.match(asUser("select category_order[1] from public.inventory_report_settings", other), /BUNDLE/);
  asUser(`update public.inventory_report_settings set category_order=${literal(order)}`, other);
  assert.equal(current().updated_by, other); assert.deepEqual(current().category_order, order);
});
test("inactive/non-profile users cannot read or update; nothing changed", () => {
  for (const actor of [inactive, "86000000-0000-4000-8000-000000000009"]) {
    const before = current();
    assert.match(asUser("select count(*) from public.inventory_report_settings", actor), /\n0$/);
    asUser(`update public.inventory_report_settings set category_order=${literal([...order].reverse())}`, actor);
    assert.deepEqual(current(), before);
  }
});
test("anon has no SELECT/UPDATE, and anonymous authenticated claim sees no row", () => {
  assert.throws(() => asUser("select * from public.inventory_report_settings", user, "anon"), error => /permission denied/.test(String(error.stderr)));
  assert.equal(asUser("select count(*) from public.inventory_report_settings", ""), "0");
});
test("column grants prohibit spoofing author/time/singleton or inserting/deleting", () => {
  for (const statement of ["update public.inventory_report_settings set updated_by=null", "update public.inventory_report_settings set updated_at=now()", "update public.inventory_report_settings set singleton=false", "delete from public.inventory_report_settings", "insert into public.inventory_report_settings(singleton) values(true)"]) {
    const before = current(); assert.throws(() => asUser(statement), error => /permission denied/.test(String(error.stderr))); assert.deepEqual(current(), before);
  }
});
test("constraint rejects duplicates, missing/unknown/null and multidimensional arrays atomically", () => {
  const invalid = [literal(order.slice(1)), literal([...order.slice(1), order[1]]), literal([...order.slice(1), "FOREIGN"]), "array['SERVO_WITH_KIT','SERVO_LOOSE','INSTALLATION_KIT','REPAIR_KIT','LOOSE_PART',null]", `array[${literal(order)},${literal(order)}]`];
  for (const value of invalid) {
    const before = current(); assert.throws(() => asUser(`update public.inventory_report_settings set category_order=${value}`), error => /check constraint/.test(String(error.stderr))); assert.deepEqual(current(), before);
  }
});
test("singleton CHECK prohibits another row and false identity even as administrator", () => {
  assert.throws(() => sql("insert into public.inventory_report_settings(singleton) values(false)"));
  assert.throws(() => sql("insert into public.inventory_report_settings(singleton) values(true)"));
  assert.equal(sql("select count(*) from public.inventory_report_settings"), "1");
});
test("audit trigger invoker, empty search_path, not exposed as RPC", () => {
  assert.equal(sql("select prosecdef from pg_proc where oid='private.audit_inventory_report_settings()'::regprocedure"), "f");
  assert.equal(sql("select has_function_privilege('authenticated','private.audit_inventory_report_settings()','EXECUTE')"), "f");
  assert.match(sql("select proconfig from pg_proc where oid='private.audit_inventory_report_settings()'::regprocedure"), /search_path/);
});
