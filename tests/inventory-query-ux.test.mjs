import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { addAssistantConversationalCopy } from "../lib/assistant-conversation.ts";
import { consultAssistantInventoryItemSummary } from "../lib/assistant-data.ts";
import { parseAssistantStructuredBlock } from "../lib/assistant-types.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const uuid = (number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

const servoId = uuid(1);
const kitId = uuid(2);
const loosePartId = uuid(3);
const configurationId = uuid(4);

function inventorySnapshot() {
  return {
    items: [
      {
        id: servoId,
        code: "1",
        description: "SERVO MBF-020",
        item_type: "SERVO",
        minimum_stock: 2,
        is_active: true,
      },
      {
        id: kitId,
        code: "KT-01",
        description: "KIT DE INSTALAÇÃO 01",
        item_type: "INSTALLATION_KIT",
        minimum_stock: 3,
        is_active: true,
      },
      {
        id: loosePartId,
        code: "P-01",
        description: "PEÇA AVULSA 01",
        item_type: "LOOSE_PART",
        minimum_stock: 1,
        is_active: true,
      },
    ],
    servoModels: [{ item_id: servoId, model: "MBF-020" }],
    stockBalances: [
      { item_id: servoId, quantity: 5 },
      { item_id: kitId, quantity: 7 },
      { item_id: loosePartId, quantity: 4 },
    ],
    configurations: [
      {
        id: configurationId,
        description: "SERVO MBF-020 COM KIT 01",
        servo_id: servoId,
        installation_kit_id: kitId,
        minimum_stock: 2,
        is_active: true,
        image_path: null,
      },
    ],
    configurationCodes: [
      {
        id: uuid(5),
        configuration_id: configurationId,
        code: "1H",
        is_active: true,
      },
      {
        id: uuid(6),
        configuration_id: configurationId,
        code: "1H-ALT",
        is_active: true,
      },
      {
        id: uuid(7),
        configuration_id: configurationId,
        code: "INATIVO",
        is_active: false,
      },
    ],
    configurationBalances: [
      { configuration_id: configurationId, quantity: 3 },
    ],
    repairCompatibilities: [],
  };
}

function extractFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

for (const [label, path, searchId, nextFunction] of [
  [
    "Entrada",
    "app/(authenticated)/entrada/inbound-entry-flow.tsx",
    "inbound-search",
    "addOption",
  ],
  [
    "Saída",
    "app/(authenticated)/saida/outbound-entry-flow.tsx",
    "outbound-search",
    "addOption",
  ],
]) {
  test(`busca global da ${label} permanece preenchida ao trocar de aba`, () => {
    const source = read(path);
    const toggle = extractFunction(source, "toggleCatalogSection", nextFunction);

    assert.doesNotMatch(toggle, /setSearch\(\s*["']{2}\s*\)/);
    assert.ok(
      source.indexOf(`id="${searchId}"`) <
        source.indexOf("<StockFlowSection"),
      "o campo de pesquisa deve aparecer antes das abas de categoria",
    );
  });
}

test("configuração 1H expõe composição e saldos separados sem somá-los", async () => {
  const block = await consultAssistantInventoryItemSummary(
    "1H",
    "STOCK",
    async () => inventorySnapshot(),
  );
  const target = block.results[0];

  assert.equal(target.currentStock, 3);
  assert.deepEqual(target.composition, {
    servoCode: "1",
    servoDescription: "SERVO MBF-020",
    servoSeparateStock: 5,
    installationKitCode: "KT-01",
    installationKitDescription: "KIT DE INSTALAÇÃO 01",
    installationKitSeparateStock: 7,
  });
  assert.deepEqual(
    parseAssistantStructuredBlock(block)?.results[0].composition,
    target.composition,
  );
});

test("servo físico lista configurações comerciais ativas em Usado em", async () => {
  const block = await consultAssistantInventoryItemSummary(
      "1",
      "STOCK",
      async () => inventorySnapshot(),
    );
  const target = block.results[0];

  assert.deepEqual(target.usedIn, [
    {
      configurationId,
      codes: ["1H", "1H-ALT"],
      description: "SERVO MBF-020 COM KIT 01",
      href: `/estoque?configuration=${configurationId}`,
    },
  ]);
  assert.deepEqual(
    parseAssistantStructuredBlock(block)?.results[0].usedIn,
    target.usedIn,
  );
});

test("kit físico lista configurações comerciais ativas em Usado em", async () => {
  const target = (
    await consultAssistantInventoryItemSummary(
      "KT-01",
      "STOCK",
      async () => inventorySnapshot(),
    )
  ).results[0];

  assert.deepEqual(target.usedIn?.[0].codes, ["1H", "1H-ALT"]);
});

test("peça avulsa não inventa composição nem relações de uso", async () => {
  const target = (
    await consultAssistantInventoryItemSummary(
      "P-01",
      "STOCK",
      async () => inventorySnapshot(),
    )
  ).results[0];

  assert.equal(target.composition, undefined);
  assert.equal(target.usedIn, undefined);
});

test("consulta estruturada não oferece composição ou mínimo já visíveis", () => {
  const answer = addAssistantConversationalCopy({
    message: "fallback seguro",
    structuredBlock: {
      kind: "inventory_item_summary",
      metric: "STOCK",
    },
  });

  assert.equal(answer.followUpText, null);
});
