import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CatalogWritePolicyError,
  executeCatalogWrite,
} from "../lib/catalog-writer.ts";

const knownItems = [
  { code: "1INV" },
  { code: "5INV015" },
  { code: "5INV028" },
  { code: "7INV015" },
  { code: "7INV028" },
];

function fakeSupabase({
  items = knownItems,
  commercialCodes = [{ code: "10A" }],
  readError = null,
  throwOnRead = false,
} = {}) {
  const calls = [];

  return {
    calls,
    from(table) {
      assert.ok(
        table === "items" || table === "commercial_configuration_codes",
      );
      return {
        async select(columns) {
          assert.equal(columns, "code");
          if (throwOnRead) throw new Error("network failed");
          return {
            data: table === "items" ? items : commercialCodes,
            error: readError,
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
  for (const code of ["1INV", "1-inv", " 1 Inv "]) {
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
        ["1INV"],
      );
    }
  }
});

test("famílias 5-INV e 7-INV permanecem ambíguas em ambos os writers", async () => {
  for (const [code, candidates] of [
    ["5-INV", ["5INV015", "5INV028"]],
    ["7 inv", ["7INV015", "7INV028"]],
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

test("duas grafias INV equivalentes na mesma entrada não criam duplicatas", async () => {
  const client = fakeSupabase({ items: [], commercialCodes: [] });
  await expectPolicyRejection(
    client,
    {
      kind: "STOCK_INBOUND",
      lines: [
        { kind: "NEW_LOOSE_PART", code: "8-INV", description: "PEÇA A", quantity: 1 },
        { kind: "NEW_LOOSE_PART", code: "8inv", description: "PEÇA A", quantity: 1 },
      ],
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
      description: null,
    },
    "AMBIGUOUS_CODE",
    ["8-INV"],
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
