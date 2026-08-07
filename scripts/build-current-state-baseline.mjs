import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const [schemaSourceArgument, dataSourceArgument, outputDirectoryArgument] =
  process.argv.slice(2);

if (!schemaSourceArgument || !dataSourceArgument || !outputDirectoryArgument) {
  throw new Error(
    "Usage: node scripts/build-current-state-baseline.mjs <schema-dump> <data-dump> <output-directory>",
  );
}

const schemaSource = resolve(schemaSourceArgument);
const dataSource = resolve(dataSourceArgument);
const outputDirectory = resolve(outputDirectoryArgument);

if (schemaSource.startsWith(resolve(".")) || dataSource.startsWith(resolve("."))) {
  throw new Error("Raw remote dumps must remain outside the repository.");
}

const schema = readFileSync(schemaSource, "utf8");
const data = readFileSync(dataSource, "utf8");

const allowlistedTables = [
  "items",
  "servo_models",
  "installation_kits",
  "repair_kits",
  "loose_parts",
  "commercial_configurations",
  "commercial_configuration_codes",
  "servo_repair_compatibility",
];

const insertPattern = new RegExp(
  `INSERT INTO "public"\\."(${allowlistedTables.join("|")})"[\\s\\S]*?;\\r?\\n`,
  "g",
);
const insertsByTable = new Map();

for (const match of data.matchAll(insertPattern)) {
  if (insertsByTable.has(match[1])) {
    throw new Error(`Duplicate INSERT block for ${match[1]}.`);
  }

  insertsByTable.set(match[1], match[0].trimEnd());
}

if (insertsByTable.size !== allowlistedTables.length) {
  const missing = allowlistedTables.filter((table) => !insertsByTable.has(table));
  throw new Error(`Missing allowlisted INSERT blocks: ${missing.join(", ")}.`);
}

const dumpedTables = [
  ...data.matchAll(/INSERT INTO "([^"]+)"\."([^"]+)"/g),
].map((match) => `${match[1]}.${match[2]}`);
const expectedDumpedTables = allowlistedTables.map((table) => `public.${table}`);

if (
  dumpedTables.length !== expectedDumpedTables.length ||
  dumpedTables.some((table) => !expectedDumpedTables.includes(table))
) {
  throw new Error(`The data dump contains a non-allowlisted table: ${dumpedTables.join(", ")}.`);
}

const forbiddenDataPatterns = [
  /session_replication_role/i,
  /auth\.users/i,
  /storage\.objects/i,
  /public\.profiles/i,
  /supplier_order/i,
  /movement_batches/i,
  /stock_movements/i,
  /stock_balances/i,
  /postgres(?:ql)?:\/\//i,
  /@[^\s'",)]+\.[a-z]{2,}/i,
];

for (const pattern of forbiddenDataPatterns) {
  if (pattern.test([...insertsByTable.values()].join("\n"))) {
    throw new Error(`The reference dump matched forbidden pattern ${pattern}.`);
  }
}

const storagePolicy = `

-- Supabase Local creates storage.objects. Recreate only the application-owned
-- policy; no managed Storage table or object is copied by this baseline.
CREATE POLICY "commercial_catalog_images_select_active_users"
ON "storage"."objects"
FOR SELECT
TO "authenticated"
USING (
  ("bucket_id" = 'commercial-catalog-images'::"text")
  AND "private"."is_active_profile"()
);
`;

const referenceData = [
  "-- Deterministic reference-only snapshot for local reconstruction.",
  "-- No personal, operational, balance, movement, order, or object data.",
  "BEGIN;",
  ...allowlistedTables.map((table) => insertsByTable.get(table)),
  `INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types") VALUES
  ('commercial-catalog-images', 'commercial-catalog-images', false, 5242880, ARRAY['image/jpeg']::text[]);`,
  "COMMIT;",
  "",
].join("\n\n");

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  resolve(outputDirectory, "current_schema.sql"),
  `${schema.trimEnd()}${storagePolicy}`,
  "utf8",
);
writeFileSync(
  resolve(outputDirectory, "reference_data.sql"),
  referenceData,
  "utf8",
);

for (const filename of ["current_schema.sql", "reference_data.sql"]) {
  const contents = readFileSync(resolve(outputDirectory, filename));
  const digest = createHash("sha256").update(contents).digest("hex");
  process.stdout.write(`${basename(filename)} ${digest}\n`);
}

for (const table of allowlistedTables) {
  const tableBlock = insertsByTable.get(table);
  const rows = tableBlock
    .split(/\r?\n/)
    .filter((line) => /^\s*\(/.test(line)).length;
  const digest = createHash("sha256").update(tableBlock).digest("hex");
  process.stdout.write(`${table} ${rows} ${digest}\n`);
}
