// Only schema + versioned reference catalog, never source business data.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
const target = "supabase_db_nk_issue95", source = "supabase_db_nk_current_state_baseline";
const run = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", windowsHide: true,
  maxBuffer: 20 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const labels = JSON.parse(run(["inspect", "-f", "{{json .Config.Labels}}", target]));
if (labels["nk.disposable"] !== "nk-issue95" || run(["inspect", "-f", "{{.HostConfig.NetworkMode}}", target]).trim() !== "none") throw Error("Unsafe target");
const dump = run(["exec", source, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner",
  "--schema=public", "--schema=private", "--schema=auth", "--schema=storage", "--schema=extensions"])
  .replace("CREATE SCHEMA extensions;", 'CREATE SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;')
  .replace(/^ALTER DEFAULT PRIVILEGES[^;]+;\r?\n/gm, "");
// Fixed disposable database, after container identity + network checks above.
run(["exec", target, "dropdb", "-U", "postgres", "--if-exists", "nk95_test"]);
run(["exec", target, "createdb", "-U", "postgres", "-T", "template0", "nk95_test"]);
const sql = text => run(["exec", "-i", target, "psql", "-U", "postgres", "-d", "nk95_test", "-X", "-q", "-v", "ON_ERROR_STOP=1"], text);
sql("drop schema public;"); sql(dump); sql(readFileSync("supabase/baseline/reference_data.sql", "utf8"));
for (const file of readdirSync("supabase/migrations").sort().filter(name => name.endsWith(".sql") && name > "20260828234000_z")) {
  sql(readFileSync("supabase/migrations/" + file, "utf8")); console.log("Applied locally:", file);
}
console.log("Isolated Issue95 fixture ready; no production data/network.");
