import assert from "node:assert/strict";
import test from "node:test";

import { answerAssistantQuestion } from "../lib/ai/assistant.ts";
import { buildManualStockOutputBatchPreparationBlock } from "../lib/ai/manual-stock-output-batch-preparation.ts";
import { parseAssistantStructuredBlock } from "../lib/assistant-types.ts";
import { buildOutboundPreview } from "../lib/outbound-preview.ts";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  profileName: "Henrique Klein",
};
const emptyContext = {
  topic: "GENERAL",
  itemQuery: null,
  itemReferenceKind: null,
  supplierOrderId: null,
  supplierOrderCatalogCode: null,
  lastIntent: null,
  suggestedFollowUp: null,
  statisticsPeriod: null,
  statisticsIntent: null,
  statisticsCode: null,
};
const uuid = (value) => `22000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function component(id, code, currentStock) {
  return { id, code, description: code, currentStock };
}

function commercialTarget(overrides = {}) {
  const servo = overrides.servo ?? component(uuid(101), "MBF-015", 10);
  const installationKit = overrides.installationKit ?? component(uuid(102), "KT-18", 10);
  return {
    kind: "COMMERCIAL_CODE",
    targetId: uuid(201),
    configurationId: uuid(301),
    displayCode: "1B",
    aliases: ["1B"],
    typeLabel: "Servo com kit",
    description: "SERVO MBF-015 + KIT KT-18",
    detail: "Servo com kit",
    currentStock: 0,
    availableStock: 10,
    autoAssemblyCapacity: 10,
    servo,
    installationKit,
    ...overrides,
  };
}

function itemTarget(index, overrides = {}) {
  return {
    kind: "ITEM",
    targetId: uuid(400 + index),
    configurationId: null,
    displayCode: `S-${index}`,
    aliases: [],
    typeLabel: "Servo sem kit",
    description: `SERVO ${index}`,
    detail: `SERVO ${index}`,
    currentStock: 0,
    availableStock: 0,
    autoAssemblyCapacity: 0,
    servo: null,
    installationKit: null,
    ...overrides,
  };
}

function disassemblyTarget(index, servo, currentStock, overrides = {}) {
  return {
    commercialCodeId: uuid(500 + index),
    configurationId: uuid(600 + index),
    displayCode: `C-${index}`,
    aliases: [`C-${index}`],
    description: `Configuração ${index}`,
    currentStock,
    capacity: currentStock,
    servo: component(servo.targetId, servo.displayCode, servo.currentStock),
    installationKit: component(uuid(700 + index), `KT-${index}`, 0),
    ...overrides,
  };
}

function outboundCommercial(target) {
  return {
    kind: "COMMERCIAL_CODE",
    commercialCodeId: target.targetId,
    code: target.displayCode,
    configurationId: target.configurationId,
    description: target.description,
    imageUrl: null,
    assembledBalance: target.currentStock,
    aliases: target.aliases,
    servo: {
      id: target.servo.id,
      code: target.servo.code,
      description: target.servo.description,
      balance: target.servo.currentStock,
      model: null,
    },
    installationKit: {
      id: target.installationKit.id,
      code: target.installationKit.code,
      description: target.installationKit.description,
      balance: target.installationKit.currentStock,
    },
  };
}

function outboundItem(target) {
  return {
    kind: "ITEM",
    id: target.targetId,
    code: target.displayCode,
    description: target.description,
    itemType: "SERVO",
    model: null,
    balance: target.currentStock,
  };
}

function buildPreparation(lines, disassemblySources = []) {
  const projection = buildOutboundPreview(lines.map((line) => ({
    option: line.target.kind === "COMMERCIAL_CODE"
      ? outboundCommercial(line.target)
      : outboundItem(line.target),
    quantity: line.quantity,
  })));
  return {
    projection,
    block: buildManualStockOutputBatchPreparationBlock({
      lines,
      projection,
      disassemblySources,
    }),
  };
}

async function dispatchSelection({ assemblySelection = null, disassemblySelection = null }) {
  const calls = [];
  const response = await answerAssistantQuestion(
    "Preparar operação separada.",
    null, null, null, "Henrique", actor.userId, actor.profileName,
    null, null, null, null, assemblySelection, disassemblySelection,
    [], emptyContext,
    {
      semanticRouter: async () => { throw new Error("roteador não deve ser chamado"); },
      manualStockOutputPreview: async () => { throw new Error("prévia de saída unitária não deve ser chamada"); },
      manualStockOutputBatchPreview: async () => { throw new Error("prévia de saída em lote não deve ser chamada"); },
      configurationAssemblyPreview: async (selection, receivedActor) => {
        calls.push(["assembly", selection, receivedActor]);
        return { message: "Prévia oficial de montagem", structuredBlock: { kind: "configuration_assembly_preview" } };
      },
      configurationDisassemblyPreview: async (selection, receivedActor) => {
        calls.push(["disassembly", selection, receivedActor]);
        return { message: "Prévia oficial de desmontagem", structuredBlock: { kind: "configuration_disassembly_preview" } };
      },
    },
  );
  return { calls, response };
}

test("aliases da mesma configuração geram uma montagem com a quantidade total da projeção", () => {
  const first = commercialTarget({ targetId: uuid(201), displayCode: "1B", aliases: ["1B", "1D"] });
  const second = commercialTarget({ targetId: uuid(202), displayCode: "1D", aliases: ["1B", "1D"] });
  const { block, projection } = buildPreparation([
    { target: first, quantity: 2 },
    { target: second, quantity: 1 },
  ]);

  assert.equal(projection.autoAssembledQuantity, 3);
  assert.ok(block);
  assert.equal(block.options.length, 2);
  assert.deepEqual(block.options[0].configurationAssemblySelection, {
    action: "configuration_assembly_target",
    commercialCodeId: first.targetId,
    quantity: 3,
  });
});

test("montagem acima da capacidade real não oferece ação impossível", () => {
  const target = commercialTarget({ autoAssemblyCapacity: 1 });
  const { block, projection } = buildPreparation([{ target, quantity: 2 }]);
  assert.equal(projection.isValid, true);
  assert.equal(projection.autoAssembledQuantity, 2);
  assert.equal(block, null);
});

test("componente compartilhado no lote suprime desmontagem de forma fail-closed", () => {
  const looseServo = itemTarget(1, { targetId: uuid(101), displayCode: "MBF-015" });
  const mounted = commercialTarget({
    servo: component(looseServo.targetId, looseServo.displayCode, 0),
  });
  const source = {
    servoId: looseServo.targetId,
    failed: false,
    targets: [disassemblyTarget(1, looseServo, 3)],
  };
  const { block, projection } = buildPreparation([
    { target: looseServo, quantity: 2 },
    { target: mounted, quantity: 1 },
  ], [source]);

  assert.equal(projection.isValid, false);
  assert.equal(block, null);
});

test("preparação limita cinco operações, adiciona cancelar e falha fechada na leitura", () => {
  const lines = Array.from({ length: 6 }, (_, index) => ({
    target: itemTarget(index + 1),
    quantity: 1,
  }));
  const sources = lines.map(({ target }, index) => ({
    servoId: target.targetId,
    failed: false,
    targets: [disassemblyTarget(index + 1, target, 1)],
  }));
  const { block } = buildPreparation(lines, sources);
  assert.ok(block);
  assert.equal(block.options.length, 6);
  assert.equal(block.options.filter((option) => option.configurationDisassemblySelection).length, 5);
  assert.equal(block.options.at(-1).id, "output-cancel");

  const failedSources = sources.map((source, index) =>
    index === 0 ? { ...source, failed: true } : source);
  assert.equal(buildPreparation(lines, failedSources).block, null);
});

test("desmontagem distribuída preserva quantidades sugeridas", () => {
  const servo = itemTarget(1, { displayCode: "MBF-015" });
  const sources = [{
    servoId: servo.targetId,
    failed: false,
    targets: [
      disassemblyTarget(1, servo, 2),
      disassemblyTarget(2, servo, 3),
    ],
  }];
  const { block } = buildPreparation([{ target: servo, quantity: 5 }], sources);
  assert.ok(block);
  assert.deepEqual(
    block.options
      .map((option) => option.configurationDisassemblySelection?.quantity)
      .filter(Boolean),
    [2, 3],
  );
});

test("seleções serializadas despacham somente as prévias oficiais de montagem e desmontagem", async () => {
  const assemblyTarget = commercialTarget();
  const assembly = buildPreparation([{ target: assemblyTarget, quantity: 2 }]);
  const assemblyBlock = parseAssistantStructuredBlock(
    JSON.parse(JSON.stringify(assembly.block)),
  );
  assert.equal(assemblyBlock?.kind, "assistant_clarification");
  assert.equal(JSON.stringify(assemblyBlock).includes("proposalToken"), false);
  const assemblySelection = assemblyBlock.options[0].configurationAssemblySelection;
  const assemblyDispatch = await dispatchSelection({ assemblySelection });
  assert.deepEqual(assemblyDispatch.calls, [["assembly", assemblySelection, actor]]);
  assert.equal(assemblyDispatch.response.structuredBlock?.kind, "configuration_assembly_preview");
  assert.notEqual(assemblyDispatch.response.structuredBlock?.kind, "manual_stock_output_preview");

  const servo = itemTarget(1, { displayCode: "MBF-015" });
  const disassembly = buildPreparation(
    [{ target: servo, quantity: 2 }],
    [{
      servoId: servo.targetId,
      failed: false,
      targets: [disassemblyTarget(1, servo, 2)],
    }],
  );
  const disassemblyBlock = parseAssistantStructuredBlock(
    JSON.parse(JSON.stringify(disassembly.block)),
  );
  assert.equal(disassemblyBlock?.kind, "assistant_clarification");
  assert.equal(JSON.stringify(disassemblyBlock).includes("proposalToken"), false);
  const disassemblySelection = disassemblyBlock.options[0].configurationDisassemblySelection;
  const disassemblyDispatch = await dispatchSelection({ disassemblySelection });
  assert.deepEqual(disassemblyDispatch.calls, [["disassembly", disassemblySelection, actor]]);
  assert.equal(disassemblyDispatch.response.structuredBlock?.kind, "configuration_disassembly_preview");
  assert.notEqual(disassemblyDispatch.response.structuredBlock?.kind, "manual_stock_output_preview");
});
