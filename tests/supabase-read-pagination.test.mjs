import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAllSupabaseRows,
  fetchAllSupabaseRowsByChunks,
} from "../lib/supabase-read-pagination.ts";

const rows = (size) =>
  Array.from({ length: size }, (_, index) => ({ id: `row-${index}` }));

test("pagina 2 e 3 são lidas sem duplicar linhas", async () => {
  const source = rows(2_005);
  const calls = [];
  const result = await fetchAllSupabaseRows(
    (from, to) => {
      calls.push([from, to]);
      return Promise.resolve({ data: source.slice(from, to + 1), error: null });
    },
    (row) => row.id,
  );

  assert.equal(result.error, null);
  assert.equal(result.data.length, 2_005);
  assert.equal(new Set(result.data.map((row) => row.id)).size, 2_005);
  assert.deepEqual(calls, [[0, 999], [1_000, 1_999], [2_000, 2_999]]);
});

test("limite exato de 1000 exige a página final vazia", async () => {
  const source = rows(1_000);
  const calls = [];
  const result = await fetchAllSupabaseRows(
    (from, to) => {
      calls.push([from, to]);
      return Promise.resolve({ data: source.slice(from, to + 1), error: null });
    },
    (row) => row.id,
  );

  assert.equal(result.data.length, 1_000);
  assert.deepEqual(calls, [[0, 999], [1_000, 1_999]]);
});

test("erro ou repetição na página 2 falha sem devolver parcial", async () => {
  const source = rows(1_001);
  const error = new Error("page two failed");
  const failed = await fetchAllSupabaseRows(
    (from, to) => Promise.resolve(
      from === 1_000
        ? { data: null, error }
        : { data: source.slice(from, to + 1), error: null },
    ),
    (row) => row.id,
  );
  assert.equal(failed.data, null);
  assert.equal(failed.error, error);

  const repeated = await fetchAllSupabaseRows(
    (from, to) => Promise.resolve({
      data: from === 1_000 ? [source[0]] : source.slice(from, to + 1),
      error: null,
    }),
    (row) => row.id,
  );
  assert.equal(repeated.data, null);
  assert.match(repeated.error.message, /não avançou/i);
});

test("cada bloco de filtro também pagina o fanout", async () => {
  const source = ["a", "b"].flatMap((group) =>
    rows(1_001).map((row) => ({ id: `${group}-${row.id}`, group })),
  );
  const secondPages = [];
  const result = await fetchAllSupabaseRowsByChunks(
    ["a", "b"],
    (groups, from, to) => {
      if (from === 1_000) secondPages.push(groups[0]);
      const accepted = new Set(groups);
      return Promise.resolve({
        data: source.filter((row) => accepted.has(row.group)).slice(from, to + 1),
        error: null,
      });
    },
    (row) => row.id,
    1,
  );
  assert.equal(result.error, null);
  assert.equal(result.data.length, 2_002);
  assert.deepEqual(secondPages, ["a", "b"]);
});
