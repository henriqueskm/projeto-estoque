import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CatalogWritePolicyError,
  executeCatalogWrite,
} from "../lib/catalog-writer.ts";
import {
  catalogCodesConflict,
  getCatalogCodeWriteIdentity,
} from "../lib/catalog-code-policy.ts";

const knownItems = [
  { code: "1INV" },
  { code: "1DESL" },
  { code: "091/VF" },
  { code: "5INV015" },
  { code: "5INV028" },
  { code: "7INV015" },
  { code: "7INV028" },
];

test("catálogo mestre atual passa no preflight sem colisão semântica", () => {
  const masterData = JSON.parse(
    readFileSync(
      new URL("../data/negocios-k-master-data.json", import.meta.url),
      "utf8",
    ),
  );
  const codes = [
    ...masterData.servos,
    ...masterData.kits,
    ...masterData.repairs,
    ...masterData.commercial_codes,
  ].map((entry) => entry.code);

  for (const code of codes) {
    assert.equal(getCatalogCodeWriteIdentity(code).kind, "VALID", code);
  }

  for (let left = 0; left < codes.length; left += 1) {
    for (let right = left + 1; right < codes.length; right += 1) {
      assert.equal(
        catalogCodesConflict(codes[left], codes[right]),
        false,
        `${codes[left]} conflicts with ${codes[right]}`,
      );
    }
  }
});

function fakeSupabase({
  items = knownItems,
  commercialCodes = [{ code: "10A" }],
  readError = null,
  throwOnRead = false,
} = {}) {
  const calls = [];
  const reads = [];

  return {
    calls,
    reads,
    from(table) {
      assert.ok(
        table === "items" || table === "commercial_configuration_codes",
      );
      return {
        select(columns) {
          assert.equal(columns, "code");
          return {
            order(column, options) {
              assert.equal(column, "code");
              assert.deepEqual(options, { ascending: true });
              return {
                async range(from, to) {
                  reads.push({ table, from, to });
                  if (throwOnRead) throw new Error("network failed");
                  const source = table === "items" ? items : commercialCodes;
                  return {
                    data: Array.isArray(source)
                      ? [...source]
                          .sort((left, right) => left.code.localeCompare(right.code))
                          .slice(from, to + 1)
                      : source,
                    error: readError,
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { ok: true }, error: null };
    },
  };
}

async function expectPolicyRejection(client, write, reason, catalogCodes) {
  await assert.rejects(
    executeCatalogWrite(client, write),
    (error) => {
      assert.ok(error instanceof CatalogWritePolicyError);
      assert.equal(error.reason, reason);
      assert.deepEqual(error.catalogCodes, catalogCodes);
      return true;
    },
  );
  assert.deepEqual(client.calls, []);
}

test("INV exato conhecido e variantes de consulta nunca chegam ao writer", async () => {
  for (const code of ["1INV", "1-inv", " 1-inv ", "1-DESL"]) {
    for (const write of [
      { kind: "CATALOG_ONLY_LOOSE_PART", code, description: "NOVA" },
      {
        kind: "STOCK_INBOUND",
        lines: [{ kind: "NEW_LOOSE_PART", code, description: "NOVA", quantity: 1 }],
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
        description: null,
      },
    ]) {
      const client = fakeSupabase();
      await expectPolicyRejection(
        client,
        write,
        "KNOWN_CODE",
        [code.toUpperCase().includes("DESL") ? "1DESL" : "1INV"],
      );
    }
  }
});

test("código geral com barra preserva a identidade exata existente", async () => {
  for (const code of ["091/VF", "091/vf"]) {
    const client = fakeSupabase();
    await expectPolicyRejection(
      client,
      { kind: "CATALOG_ONLY_LOOSE_PART", code, description: "NOVA" },
      "KNOWN_CODE",
      ["091/VF"],
    );
  }

  const client = fakeSupabase();
  await executeCatalogWrite(client, {
    kind: "CATALOG_ONLY_LOOSE_PART",
    code: "092/VF",
    description: "NOVA",
  });
  assert.equal(client.calls[0].name, "create_loose_part");
  assert.equal(client.calls[0].args.p_code, "092/VF");
});

test("famílias 5-INV e 7-INV permanecem ambíguas em ambos os writers", async () => {
  for (const [code, candidates] of [
    ["5-INV", ["5INV015", "5INV028"]],
    ["7-inv", ["7INV015", "7INV028"]],
  ]) {
    for (const write of [
      { kind: "CATALOG_ONLY_LOOSE_PART", code, description: "NOVA" },
      {
        kind: "STOCK_INBOUND",
        lines: [{ kind: "NEW_LOOSE_PART", code, description: "NOVA", quantity: 2 }],
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        description: null,
      },
    ]) {
      const client = fakeSupabase();
      await expectPolicyRejection(
        client,
        write,
        "AMBIGUOUS_CODE",
        candidates,
      );
    }
  }
});

test("código desconhecido usa create_loose_part sem quantidade ou estoque", async () => {
  const client = fakeSupabase();
  await executeCatalogWrite(client, {
    kind: "CATALOG_ONLY_LOOSE_PART",
    code: "P-123",
    description: "SUPORTE DO SERVO",
  });
  assert.deepEqual(client.calls, [{
    name: "create_loose_part",
    args: { p_code: "P-123", p_description: "SUPORTE DO SERVO" },
  }]);
});

test("entrada desconhecida usa somente stock_inbound_lines e preserva quantidade", async () => {
  const client = fakeSupabase();
  const lines = [{
    kind: "NEW_LOOSE_PART",
    code: "P-124",
    description: "MOLA DO SERVO",
    quantity: 3,
  }];
  await executeCatalogWrite(client, {
    kind: "STOCK_INBOUND",
    lines,
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
    description: "Entrada manual",
  });
  assert.deepEqual(client.calls, [{
    name: "stock_inbound_lines",
    args: {
      p_lines: lines,
      p_idempotency_key: "00000000-0000-4000-8000-000000000002",
      p_description: "Entrada manual",
    },
  }]);
});

test("família base e variante nova produzem a mesma decisão nas duas ordens", async () => {
  for (const codes of [
    ["8-INV", "8INV1"],
    ["8INV1", "8-INV"],
  ]) {
    const client = fakeSupabase({ items: [], commercialCodes: [] });
    await expectPolicyRejection(
      client,
      {
        kind: "STOCK_INBOUND",
        lines: codes.map((code) => ({
          kind: "NEW_LOOSE_PART",
          code,
          description: "PEÇA A",
          quantity: 1,
        })),
        idempotencyKey: "00000000-0000-4000-8000-000000000003",
        description: null,
      },
      "AMBIGUOUS_CODE",
      [codes[0]],
    );
  }
});

test("formatos e separadores não suportados são rejeitados, nunca normalizados", async () => {
  for (const code of [
    "5-INV-015",
    "5INV-015",
    "5 INV 015",
    "7 INV",
    "7\u2011INV",
    "7\u00a0INV",
    "７-INV",
  ]) {
    const client = fakeSupabase();
    await expectPolicyRejection(
      client,
      { kind: "CATALOG_ONLY_LOOSE_PART", code, description: "NOVA" },
      "UNSUPPORTED_CODE",
      [],
    );
  }
});

test("paginação lê o catálogo completo antes de permitir uma criação", async () => {
  const items = Array.from({ length: 1_001 }, (_, index) => ({
    code: `A${String(index).padStart(4, "0")}`,
  }));
  items.push({ code: "9INV" });
  const client = fakeSupabase({ items, commercialCodes: [] });
  await expectPolicyRejection(
    client,
    { kind: "CATALOG_ONLY_LOOSE_PART", code: "9-INV", description: "NOVA" },
    "KNOWN_CODE",
    ["9INV"],
  );
  assert.deepEqual(
    client.reads.filter((read) => read.table === "items"),
    [
      { table: "items", from: 0, to: 999 },
      { table: "items", from: 1_000, to: 1_999 },
    ],
  );
});

test("erro ou resposta inválida na leitura do catálogo falha fechado", async () => {
  for (const client of [
    fakeSupabase({ readError: { message: "offline" } }),
    fakeSupabase({ items: null }),
    fakeSupabase({ throwOnRead: true }),
  ]) {
    await expectPolicyRejection(
      client,
      { kind: "CATALOG_ONLY_LOOSE_PART", code: "P-125", description: "NOVA" },
      "CATALOG_READ_FAILED",
      [],
    );
  }
});

test("os dois entrypoints usam a boundary comum e não chamam RPC diretamente", () => {
  const route = readFileSync(
    new URL("../app/api/assistant/order-photo/create-loose-part/route.ts", import.meta.url),
    "utf8",
  );
  const action = readFileSync(
    new URL("../app/(authenticated)/entrada/actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /executeCatalogWrite\(auth\.supabase/);
  assert.match(route, /kind: "CATALOG_ONLY_LOOSE_PART"/);
  assert.doesNotMatch(route, /\.rpc\("create_loose_part"/);
  assert.match(action, /executeCatalogWrite\(supabase/);
  assert.match(action, /kind: "STOCK_INBOUND"/);
  assert.doesNotMatch(action, /\.rpc\("stock_inbound_lines"/);
});
