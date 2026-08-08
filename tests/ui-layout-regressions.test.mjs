import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a new or restored empty conversation starts at its saved scroll position", () => {
  const home = read("components/assistant-home.tsx");

  assert.match(home, /top: scrollTop,/);
  assert.doesNotMatch(home, /scrollTop > 0 \? scrollTop : conversation\.scrollHeight/);
});

test("inventory headers stay directly below the mobile header and at the desktop top", () => {
  const workspace = read("app/(authenticated)/estoque/inventory-workspace.tsx");

  assert.match(workspace, /sticky top-14/);
  assert.match(workspace, /lg:top-0/);
  assert.doesNotMatch(workspace, /sticky top-16/);
});

test("order dialogs use a restrained entry transition and integrated visual surface", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const globals = read("app/globals.css");

  assert.match(orders, /nk-dialog-enter/);
  assert.match(orders, /bg-black\/65/);
  assert.match(orders, /backdrop-blur-\[2px\]/);
  assert.match(orders, /border-brand-charcoal\/15/);
  assert.match(orders, /bg-app-background\/95/);
  assert.match(globals, /@keyframes nk-dialog-enter/);
  assert.match(globals, /animation: nk-dialog-enter 180ms/);
});
