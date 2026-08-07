import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineDirectory = resolve(repositoryRoot, "supabase", "baseline");
const manifestPath = resolve(baselineDirectory, "baseline_manifest.json");
const schemaPath = resolve(baselineDirectory, "current_schema.sql");
const referenceDataPath = resolve(baselineDirectory, "reference_data.sql");
const resetScriptPath = resolve(
  repositoryRoot,
  "scripts",
  "reset-local-from-baseline.ps1",
);
const buildScriptPath = resolve(
  repositoryRoot,
  "scripts",
  "build-current-state-baseline.mjs",
);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const schema = readFileSync(schemaPath, "utf8");
const referenceData = readFileSync(referenceDataPath, "utf8");
const resetScript = readFileSync(resetScriptPath, "utf8");
const migrationFilenamePattern = /^(\d{14})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;

const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function validateMigrationContinuity(sourceMigrations, headMigrations, cutoff) {
  for (const filename of new Set([
    ...sourceMigrations.keys(),
    ...headMigrations.keys(),
  ])) {
    assert.match(filename, migrationFilenamePattern, `Invalid migration name: ${filename}`);
  }

  assert.equal(
    [...sourceMigrations].some(([filename]) => filename.slice(0, 14) === cutoff),
    true,
    `Cutoff migration ${cutoff} must exist in source_commit`,
  );

  for (const [filename, sourceContents] of sourceMigrations) {
    if (filename.slice(0, 14) > cutoff) continue;

    assert.equal(
      headMigrations.has(filename),
      true,
      `Historical migration was removed or renamed: ${filename}`,
    );
    assert.deepEqual(
      headMigrations.get(filename),
      sourceContents,
      `Historical migration content changed: ${filename}`,
    );
  }

  for (const filename of headMigrations.keys()) {
    if (!sourceMigrations.has(filename)) {
      assert.equal(
        filename.slice(0, 14) > cutoff,
        true,
        `New migration must be newer than cutoff ${cutoff}: ${filename}`,
      );
    }
  }
}

function readSourceMigrations(sourceCommit) {
  const prefix = "supabase/migrations/";
  const filenames = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", sourceCommit, "--", "supabase/migrations"],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => path.slice(prefix.length));

  return new Map(filenames.map((filename) => [
    filename,
    execFileSync(
      "git",
      ["show", `${sourceCommit}:${prefix}${filename}`],
      { cwd: repositoryRoot },
    ),
  ]));
}

function readHeadMigrations() {
  const migrationsDirectory = resolve(repositoryRoot, "supabase", "migrations");
  return new Map(readdirSync(migrationsDirectory).map((filename) => [
    filename,
    readFileSync(resolve(migrationsDirectory, filename)),
  ]));
}

test("baseline lives outside historical migrations and has every required file", () => {
  for (const path of [
    manifestPath,
    schemaPath,
    referenceDataPath,
    resolve(baselineDirectory, "README.md"),
    resetScriptPath,
  ]) {
    assert.equal(existsSync(path), true, `${path} must exist`);
    assert.equal(path.includes("supabase\\migrations"), false);
  }
});

test("manifest is valid and file checksums match", () => {
  assert.equal(manifest.baseline_version, 1);
  assert.equal(
    manifest.source_commit,
    "d06bedb275e4b178fb0e26fb7e6c56f66726a19b",
  );
  assert.equal(manifest.historical_cutoff_migration, "20260729001230");
  assert.equal(
    sha256(schemaPath),
    manifest.files["current_schema.sql"].sha256,
  );
  assert.equal(
    sha256(referenceDataPath),
    manifest.files["reference_data.sql"].sha256,
  );
  assert.equal(manifest.declarations.contains_personal_data, false);
  assert.equal(manifest.declarations.contains_operational_data, false);
  assert.equal(manifest.declarations.contains_secrets, false);
  assert.equal(manifest.declarations.contains_storage_objects, false);
});

test("reference data contains exactly the approved tables", () => {
  const expected = [
    "public.items",
    "public.servo_models",
    "public.installation_kits",
    "public.repair_kits",
    "public.loose_parts",
    "public.commercial_configurations",
    "public.commercial_configuration_codes",
    "public.servo_repair_compatibility",
    "storage.buckets",
  ];
  const actual = [
    ...referenceData.matchAll(/INSERT INTO "([^"]+)"\."([^"]+)"/g),
  ].map((match) => `${match[1]}.${match[2]}`);

  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, expected.length);
  assert.doesNotMatch(referenceData, /ON CONFLICT/i);
  assert.doesNotMatch(referenceData, /gen_random_uuid/i);
  assert.doesNotMatch(referenceData, /session_replication_role/i);
});

test("baseline contains no secret, remote endpoint, e-mail, personal, or operational data", () => {
  const allBaselineFiles = readdirSync(baselineDirectory)
    .map((filename) => readFileSync(resolve(baselineDirectory, filename), "utf8"))
    .join("\n");

  for (const pattern of [
    /supabase\.co/i,
    /postgres(?:ql)?:\/\//i,
    /(?:password|jwt|service_role_key|anon_key)\s*[=:]/i,
    /@[a-z0-9.-]+\.[a-z]{2,}/i,
  ]) {
    assert.doesNotMatch(allBaselineFiles, pattern);
  }

  for (const pattern of [
    /INSERT INTO "auth"\."users"/i,
    /INSERT INTO "storage"\."objects"/i,
    /INSERT INTO "public"\."profiles"/i,
    /INSERT INTO "public"\."supplier_order/i,
    /INSERT INTO "public"\."(?:stock|configuration_stock|movement|assembly)/i,
  ]) {
    assert.doesNotMatch(referenceData, pattern);
  }

  assert.doesNotMatch(schema, /CREATE TABLE (?:IF NOT EXISTS )?"auth"\."users"/i);
  assert.doesNotMatch(schema, /CREATE TABLE (?:IF NOT EXISTS )?"storage"\."objects"/i);
  assert.doesNotMatch(schema, /^(?:INSERT INTO|COPY )/im);
});

test("reset script requires a provably local target and never runs the historical chain", () => {
  assert.match(resetScript, /ALVO CONFIRMADO: SUPABASE LOCAL/);
  assert.match(resetScript, /127\.0\.0\.1/);
  assert.match(resetScript, /Remote database hosts are refused/);
  assert.match(resetScript, /supabase start/);
  assert.match(resetScript, /"migration", "repair"/);
  assert.match(resetScript, /--local/);
  assert.match(resetScript, /current_schema\.sql/);
  assert.match(resetScript, /reference_data\.sql/);
  assert.doesNotMatch(resetScript, /--linked/);
  assert.doesNotMatch(resetScript, /db push/);
  assert.match(resetScript, /supabase migration up --local/);
  assert.doesNotMatch(resetScript, /[a-z]{20}\.supabase\.co/i);
});

test("historical migrations match source_commit while future migrations remain allowed", () => {
  validateMigrationContinuity(
    readSourceMigrations(manifest.source_commit),
    readHeadMigrations(),
    manifest.historical_cutoff_migration,
  );
});

test("migration continuity rejects historical changes and accepts a future migration", () => {
  const cutoff = manifest.historical_cutoff_migration;
  const cutoffFilename = `${cutoff}_cutoff.sql`;
  const source = new Map([[cutoffFilename, Buffer.from("select 1;\n")]]);
  const future = new Map([
    ...source,
    ["20260730000000_future.sql", Buffer.from("select 2;\n")],
  ]);

  assert.doesNotThrow(() => validateMigrationContinuity(source, future, cutoff));

  const changedHistorical = new Map(source);
  changedHistorical.set(cutoffFilename, Buffer.from("select 3;\n"));
  assert.throws(
    () => validateMigrationContinuity(source, changedHistorical, cutoff),
    /Historical migration content changed/,
  );

  const backdated = new Map(source);
  backdated.set("20260728000000_backdated.sql", Buffer.from("select 4;\n"));
  assert.throws(
    () => validateMigrationContinuity(source, backdated, cutoff),
    /New migration must be newer than cutoff/,
  );
});

test("baseline builder rejects raw dumps located inside the repository", () => {
  const result = spawnSync(
    process.execPath,
    [buildScriptPath, schemaPath, referenceDataPath, resolve(repositoryRoot, "unused")],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Raw remote dumps must remain outside the repository/);
});
