// Reproduces Issue #91 without production data or network access.
// Prerequisite: the existing local baseline container (read-only source).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
const target = "supabase_db_nk_issue91", source = "supabase_db_nk_current_state_baseline";
const run = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", windowsHide: true,
  maxBuffer: 20 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const labels = JSON.parse(run(["inspect", "-f", "{{json .Config.Labels}}", target]));
if (labels["nk.disposable"] !== "nk-issue91" || run(["inspect", "-f", "{{.HostConfig.NetworkMode}}", target]).trim() !== "none") throw Error("Unsafe target");
// SCHEMA ONLY: never copies auth users, sessions, orders or stock from source.
const dump = run(["exec", source, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner",
  "--schema=public", "--schema=private", "--schema=auth", "--schema=storage", "--schema=extensions"])
  .replace("CREATE SCHEMA extensions;", 'CREATE SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;')
  // Reserved Supabase roles cannot have their defaults restored by postgres.
  // Explicit object ACLs/RLS ARE restored and the regression suite checks them.
  .replace(/^ALTER DEFAULT PRIVILEGES[^;]+;\r?\n/gm, "");
// Fixed, test-only DB inside an already verified labelled/network-none container.
run(["exec", target, "dropdb", "-U", "postgres", "--if-exists", "nk91_test"]);
run(["exec", target, "createdb", "-U", "postgres", "-T", "template0", "nk91_test"]);
const sql = text => run(["exec", "-i", target, "psql", "-U", "postgres", "-d", "nk91_test", "-X", "-q", "-v", "ON_ERROR_STOP=1"], text);
sql("drop schema public;"); sql(dump); sql(readFileSync("supabase/baseline/reference_data.sql", "utf8"));
for (const file of readdirSync("supabase/migrations").sort().filter(name => name.endsWith(".sql") && name > "20260828234000_z" && !name.includes("fix_supplier_order_edit_line_persistence"))) {
  sql(readFileSync("supabase/migrations/" + file, "utf8")); console.log("Applied locally:", file);
}
console.log("Isolated Issue91 fixture ready; run tests/supplier-order-edit-persistence.local.mjs.");
