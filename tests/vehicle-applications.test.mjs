import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  fetchVehicleApplicationPages,
  filterVehicleApplications,
  groupVehicleApplications,
  normalizeVehicleApplicationSearch,
} from "../lib/vehicle-applications-domain.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260916090000_create_vehicle_applications.sql",
  ),
  "utf8",
);
const payloadMatch = migration.match(
  /\$vehicle_applications\$(.*?)\$vehicle_applications\$::jsonb/s,
);
assert.ok(payloadMatch, "the self-contained migration payload must exist");
const payload = JSON.parse(payloadMatch[1]);

function application(overrides = {}) {
  return {
    id: "application-1",
    brandId: "brand-1",
    category: "TRUCK",
    vehicleModel: "1418 Atego",
    applicationKind: "NORMAL",
    sourceKitCode: "7A",
    sourceServoLabel: "BR-040",
    commercialConfigurationCodeId: "commercial-code-1",
    catalogResolutionStatus: "RESOLVED",
    observation: "4 FUROS – CAIXA DE CÂMBIO MBB – ALUMINIO",
    sourceSheet: "MERCEDES-BENZ",
    sourceRow: 51,
    sortOrder: 1,
    ...overrides,
  };
}

test("authoritative payload preserves exact approved counts and pending codes", () => {
  assert.equal(
    payload.source_sha256,
    "EADCF389E83231636A37EC7488345C1552BC4672FF7194F1E5C9A4D6A020D893",
  );
  assert.equal(payload.brands.length, 8);
  assert.equal(payload.applications.length, 295);
  assert.equal(
    payload.applications.filter((row) => row.application_kind === "NORMAL")
      .length,
    294,
  );
  assert.equal(
    payload.applications.filter(
      (row) => row.application_kind === "RESTRICTION",
    ).length,
    1,
  );

  const unresolved = payload.applications.filter(
    (row) => row.catalog_resolution_status === "UNRESOLVED",
  );
  assert.equal(unresolved.length, 11);
  assert.deepEqual(
    [...new Set(unresolved.map((row) => row.source_kit_code))].sort(),
    ["7B", "7C", "7G", "7I", "7J", "7K", "7L", "7M", "7O"],
  );
  assert.ok(
    unresolved.every(
      (row) =>
        row.application_kind === "NORMAL" &&
        row.source_kit_code &&
        row.source_servo_label &&
        row.catalog_resolution_status === "UNRESOLVED",
    ),
  );
});

test("payload keeps every source row and has no exact duplicate", () => {
  const sourceLocations = new Set(
    payload.applications.map((row) => `${row.source_sheet}:${row.source_row}`),
  );
  const exactRows = new Set(
    payload.applications.map((row) =>
      JSON.stringify([
        row.brand_slug,
        row.category,
        row.vehicle_model,
        row.application_kind,
        row.source_kit_code,
        row.source_servo_label,
        row.catalog_resolution_status,
        row.observation,
      ]),
    ),
  );

  assert.equal(sourceLocations.size, 295);
  assert.equal(exactRows.size, 295);
});

test("Mercedes-Benz 2423 ZF remains a searchable restriction without catalog identity", () => {
  const restriction = payload.applications.find(
    (row) => row.application_kind === "RESTRICTION",
  );

  assert.deepEqual(restriction, {
    brand_slug: "mercedes-benz",
    category: "TRUCK",
    vehicle_model: "2423 Câmbio ZF",
    application_kind: "RESTRICTION",
    source_kit_code: null,
    source_servo_label: null,
    catalog_resolution_status: "NOT_APPLICABLE",
    observation: "NÃO DÁ INSTALAÇÃO",
    source_sheet: "MERCEDES-BENZ",
    source_row: 104,
    sort_order: 99,
  });
});

test("search tolerates case, accents, spaces and hyphens without changing records", () => {
  const rows = [
    application(),
    application({
      id: "application-2",
      vehicleModel: "O371 UP",
      sourceKitCode: "7C",
      commercialConfigurationCodeId: null,
      catalogResolutionStatus: "UNRESOLVED",
      observation: null,
      sourceRow: 120,
      sortOrder: 2,
    }),
    application({
      id: "restriction",
      vehicleModel: "2423 Câmbio ZF",
      applicationKind: "RESTRICTION",
      sourceKitCode: null,
      sourceServoLabel: null,
      commercialConfigurationCodeId: null,
      catalogResolutionStatus: "NOT_APPLICABLE",
      observation: "NÃO DÁ INSTALAÇÃO",
      sourceRow: 104,
      sortOrder: 3,
    }),
  ];

  assert.equal(normalizeVehicleApplicationSearch(" BR-040 "), "br040");
  assert.deepEqual(
    filterVehicleApplications(rows, "1418 atego", "ALL").map(
      (row) => row.id,
    ),
    ["application-1"],
  );
  assert.deepEqual(
    filterVehicleApplications(rows, "BR 040", "ALL").map((row) => row.id),
    ["application-1", "application-2"],
  );
  assert.deepEqual(
    filterVehicleApplications(rows, "nao da instalacao", "ALL").map(
      (row) => row.id,
    ),
    ["restriction"],
  );
  assert.deepEqual(
    filterVehicleApplications(rows, "7 C", "ALL").map((row) => row.id),
    ["application-2"],
  );
});

test("commercial-code searches match only the exact source kit code", () => {
  const exact = application({ id: "7a", sourceKitCode: "7A" });
  const prefixed = ["7AB", "7AC", "7AF"].map((sourceKitCode) =>
    application({
      id: sourceKitCode.toLowerCase(),
      sourceKitCode,
      sourceRow: sourceKitCode.charCodeAt(2),
    }),
  );
  const crossedFields = application({
    id: "crossed-fields",
    sourceKitCode: "9A",
    sourceServoLabel: "Servo 2",
    vehicleModel: "A",
    observation: null,
  });
  const mapPayloadApplication = (row) =>
    application({
      id: `${row.source_sheet}:${row.source_row}`,
      sourceKitCode: row.source_kit_code,
      sourceServoLabel: row.source_servo_label,
      vehicleModel: row.vehicle_model,
      observation: row.observation,
      sourceSheet: row.source_sheet,
      sourceRow: row.source_row,
      sortOrder: row.sort_order,
    });
  const fordApplications = payload.applications
    .filter((row) => row.brand_slug === "ford")
    .map(mapPayloadApplication);
  const mercedesApplications = payload.applications
    .filter((row) => row.brand_slug === "mercedes-benz")
    .map(mapPayloadApplication);

  for (const query of ["7A", "7 A", "7-A"]) {
    assert.deepEqual(
      filterVehicleApplications([exact, ...prefixed], query, "ALL").map(
        (row) => row.id,
      ),
      ["7a"],
    );
  }

  assert.ok(
    ["7AC", "7AF"].every((code) =>
      fordApplications.some((row) => row.sourceKitCode === code),
    ),
  );
  assert.ok(
    mercedesApplications.some((row) => row.sourceKitCode === "7AB"),
  );
  const mercedesExactResults = filterVehicleApplications(
    mercedesApplications,
    "7A",
    "ALL",
  );
  assert.ok(mercedesExactResults.length > 0);
  assert.ok(
    mercedesExactResults.every((row) => row.sourceKitCode === "7A"),
  );
  assert.deepEqual(
    filterVehicleApplications(fordApplications, "7A", "ALL").map(
      (row) => row.id,
    ),
    [],
    "Ford has 7AB/7AC/7AF but no 7A and must return no result",
  );
  assert.deepEqual(
    filterVehicleApplications([crossedFields], "2A", "ALL").map(
      (row) => row.id,
    ),
    [],
    "a code must not be assembled across searchable fields",
  );
});

test("alphanumeric observation searches remain available outside the source kit set", () => {
  const metalforApplications = payload.applications
    .filter((row) => row.brand_slug === "metalfor")
    .map((row) =>
      application({
        id: `${row.source_sheet}:${row.source_row}`,
        sourceKitCode: row.source_kit_code,
        sourceServoLabel: row.source_servo_label,
        vehicleModel: row.vehicle_model,
        observation: row.observation,
        sourceSheet: row.source_sheet,
        sourceRow: row.source_row,
        sortOrder: row.sort_order,
      }),
    );

  assert.deepEqual(
    filterVehicleApplications(metalforApplications, "6BT", "ALL").map(
      (row) => row.id,
    ),
    ["METALFOR:7"],
  );
  assert.deepEqual(
    filterVehicleApplications(
      metalforApplications,
      "motor cummins",
      "ALL",
    ).map((row) => row.id),
    ["METALFOR:7"],
  );
});

test("category filters expose only matching records", () => {
  const rows = [
    application({ id: "truck" }),
    application({ id: "bus", category: "BUS" }),
    application({ id: "microbus", category: "MICROBUS" }),
  ];

  assert.deepEqual(
    filterVehicleApplications(rows, "", "BUS").map((row) => row.id),
    ["bus"],
  );
});

test("grouping uses authoritative kit plus servo labels and loses no application", () => {
  const rows = [
    application({ id: "one", vehicleModel: "1418 Atego" }),
    application({
      id: "two",
      vehicleModel: "1418 Atego",
      observation: "OUTRA APLICAÇÃO VÁLIDA",
      sourceRow: 52,
      sortOrder: 2,
    }),
    application({
      id: "three",
      sourceKitCode: "7A",
      sourceServoLabel: "BR-040 DETALHADO DA FONTE",
      vehicleModel: "1518 Atego",
      sourceRow: 59,
      sortOrder: 3,
    }),
  ];
  const groups = groupVehicleApplications(rows);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups[0].applications.map((row) => [row.vehicleModel, row.observation]),
    [
      ["1418 Atego", "4 FUROS – CAIXA DE CÂMBIO MBB – ALUMINIO"],
      ["1418 Atego", "OUTRA APLICAÇÃO VÁLIDA"],
    ],
  );
  assert.equal(
    groups.reduce((total, group) => total + group.applications.length, 0),
    rows.length,
  );
});

test("paginated loader requests every page including an exact final boundary", async () => {
  const source = Array.from({ length: 200 }, (_, index) => index + 1);
  const ranges = [];
  const result = await fetchVehicleApplicationPages(async (from, to) => {
    ranges.push([from, to]);
    return source.slice(from, to + 1);
  }, 100);

  assert.deepEqual(result, source);
  assert.deepEqual(ranges, [
    [0, 99],
    [100, 199],
    [200, 299],
  ]);
});

test("authenticated routes expose eight approved slugs without modal routing", () => {
  assert.deepEqual(
    payload.brands.map((brand) => brand.slug),
    [
      "mercedes-benz",
      "ford",
      "volkswagen",
      "scania",
      "volvo",
      "agrale",
      "metalfor",
      "gmc",
    ],
  );

  const indexPage = readFileSync(
    resolve(repositoryRoot, "app/(authenticated)/aplicacoes/page.tsx"),
    "utf8",
  );
  const brandGrid = readFileSync(
    resolve(
      repositoryRoot,
      "app/(authenticated)/aplicacoes/applications-brand-grid.tsx",
    ),
    "utf8",
  );
  const brandPage = readFileSync(
    resolve(repositoryRoot, "app/(authenticated)/aplicacoes/[slug]/page.tsx"),
    "utf8",
  );
  assert.match(brandGrid, /href={`\/aplicacoes\/\${brand\.slug}`}/);
  assert.doesNotMatch(indexPage + brandGrid + brandPage, /modal|dialog/i);
});
