import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

for (const [label, path, cartId] of [
  ["Entrada", "app/(authenticated)/entrada/inbound-entry-flow.tsx", "inbound-cart-title"],
  ["Saída", "app/(authenticated)/saida/outbound-entry-flow.tsx", "outbound-cart-title"],
]) {
  test(`${label}: cart quantity uses big − / + buttons around the same input`, () => {
    const source = read(path);
    assert.match(source, /<StockFlowQuantityStepper[\s\S]*?onChange=\{\(value\) => changeQuantity\(key, value\)\}[\s\S]*?<input[\s\S]*?<\/StockFlowQuantityStepper>/);
  });

  test(`${label}: review shows current → predicted on phones and keeps the desktop breakdown`, () => {
    const source = read(path);
    assert.match(source, /<StockFlowBalanceChange/);
    assert.match(source, /hidden grid-cols-3 gap-2 text-center sm:grid/);
  });

  test(`${label}: cart shortcut follows the results so it can stay visible`, () => {
    const source = read(path);
    assert.ok(source.indexOf("<StockFlowSearchResults") < source.indexOf(`<StockFlowCartShortcut count={lines.length} headingId="${cartId}"`));
  });
}

test("stepper never goes below 1 or above the maximum", () => {
  const source = read("components/stock-flow-balance-change.tsx");
  assert.match(source, /Math\.max\(1, \(quantity \?\? 2\) - 1\)/);
  assert.match(source, /Math\.min\(maximum, \(quantity \?\? 0\) \+ 1\)/);
  assert.match(source, /size-12/);
});

test("cart shortcut sticks to the bottom only on phones", () => {
  const source = read("components/stock-flow-cart-shortcut.tsx");
  assert.match(source, /sticky bottom-3/);
  assert.match(source, /sm:static/);
});
