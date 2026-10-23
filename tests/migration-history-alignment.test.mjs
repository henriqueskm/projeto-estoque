import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/nk-migration-history-20261023.json", import.meta.url), "utf8"));
const root = new URL("../supabase/migrations/", import.meta.url);
test("45 applied migration versions match the read-only production snapshot without duplicates", () => {
  const versions = readdirSync(root).filter(n => n.endsWith(".sql")).map(n => n.split("_")[0]);
  assert.equal(baseline.versions.length, 45);
  assert.equal(new Set(versions).size, versions.length);
  assert.deepEqual(versions.filter(v => v <= baseline.versions.at(-1)).sort(), baseline.versions);
  assert.ok(!versions.includes("20261022191356"));
});
test("renamed catalog migration preserves the exact original Git blob (LF-normalized checkout)", () => {
  const sql = readFileSync(new URL("20261022200954_physical_catalog_management.sql", root), "utf8").replaceAll("\r\n", "\n");
  const body = Buffer.from(sql);
  const hash = createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
  assert.equal(hash, "6c28c343e9857476bea24f190f689580c5e3a3b3");
});
