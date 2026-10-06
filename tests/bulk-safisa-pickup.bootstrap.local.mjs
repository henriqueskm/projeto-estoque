// Only a fresh, isolated Docker database. Never uses env DB URLs or remote SQL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const binary = join(process.env.LOCALAPPDATA ?? "", "Programs/DockerDesktop/resources/bin/docker.exe");
const docker = existsSync(binary) ? binary : "docker";
const container = process.env.BULK_TEST_DB_CONTAINER ?? "supabase_db_nk_pr84_bulk";
assert.match(container, /^supabase_db_nk_pr84_bulk(?:_[a-z0-9]+)?$/);
const source = "supabase_db_nk_pr82_push";
const run = (...args) => execFileSync(docker, args, { encoding: "utf8", windowsHide: true, maxBuffer: 80 * 1024 * 1024 });
assert.equal(JSON.parse(run("inspect", "-f", "{{json .Config.Labels}}", source))["nk.disposable"], "nk-pr82-push");
// Refuse to reuse an existing target (including a previous failed run).
assert.ok(!run("ps", "-a", "--format", "{{.Names}}").trim().split(/\r?\n/).includes(container), "Fresh PR84 target required");
run("run", "--pull=never", "--detach", "--name", container, "--label", "nk.disposable=nk-pr84-bulk",
  "--network", "none", "--user", "postgres", "--entrypoint", "sh", "public.ecr.aws/supabase/postgres:17.6.1.165",
  "-c", "initdb -D /tmp/nk_pr84 --username=postgres --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C.UTF-8 >/tmp/nk_init.log 2>&1 && exec postgres -D /tmp/nk_pr84 -c listen_addresses= -c shared_preload_libraries=");
let ready = false;
for (let n = 0; n < 60; n++) {
  try { run("exec", container, "pg_isready", "-U", "postgres", "-q"); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
}
assert.ok(ready);
function sql(input) {
  return execFileSync(docker, ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input, encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}
// Roles without passwords; local source only. Preserve schema privileges for RLS tests.
const roles = JSON.parse(run("exec", source, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-c",
  "select json_agg(rolname) from pg_roles where rolname not like 'pg_%' and rolname <> 'postgres'"));
sql(roles.map(name => `create role "${name.replaceAll('"', '""')}";`).join("\n") + "\ncreate schema extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;");
const dump = run("exec", source, "pg_dump", "-U", "postgres", "-d", "postgres", "--no-owner", "--schema=public", "--schema=private", "--schema=auth", "--schema=supabase_migrations");
sql(dump.replace(/^CREATE SCHEMA public;$/m, ""));
sql(readFileSync(new URL("../supabase/migrations/20261006142946_bulk_safisa_pickup.sql", import.meta.url), "utf8"));
console.log("PR84 disposable DB bootstrapped; network none, no ports, migration local only.");
