import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dismissSearchKeyboard } from "../lib/search-input.ts";

function keyboardEvent(key, isComposing = false) {
  const calls = [];
  const input = { value: "MBF015", blur() { calls.push("blur"); } };
  return {
    calls,
    input,
    event: { key, nativeEvent: { isComposing }, currentTarget: input,
      preventDefault() { calls.push("preventDefault"); } },
  };
}

test("search Enter dismisses the keyboard without clearing the query or submitting", () => {
  const { event, calls, input } = keyboardEvent("Enter");
  dismissSearchKeyboard(event);
  assert.deepEqual(calls, ["preventDefault", "blur"]);
  assert.equal(input.value, "MBF015");
});

test("ordinary typing, Escape and Tab keep their native behavior", () => {
  for (const key of ["M", "Backspace", "Escape", "Tab"]) {
    const { event, calls } = keyboardEvent(key);
    dismissSearchKeyboard(event);
    assert.deepEqual(calls, []);
  }
});

test("Enter used to compose characters does not dismiss the keyboard", () => {
  const { event, calls } = keyboardEvent("Enter", true);
  dismissSearchKeyboard(event);
  assert.deepEqual(calls, []);
});

for (const [page, path] of [
  ["Estoque", "app/(authenticated)/estoque/inventory-workspace.tsx"],
  ["Entrada", "app/(authenticated)/entrada/inbound-entry-flow.tsx"],
  ["Saída", "app/(authenticated)/saida/outbound-entry-flow.tsx"],
]) {
  test(`${page} search uses the shared keyboard handler and search action hint`, () => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const input = [...source.matchAll(/<input\b[\s\S]*?\/>/g)]
      .map((match) => match[0]).find((markup) => markup.includes('type="search"'));
    assert.ok(input);
    assert.match(input, /enterKeyHint="search"/);
    assert.match(input, /onKeyDown=\{dismissSearchKeyboard\}/);
    assert.match(input, /onChange=/);
    assert.match(input, /value=\{(?:search|query)\}/);
  });
}
