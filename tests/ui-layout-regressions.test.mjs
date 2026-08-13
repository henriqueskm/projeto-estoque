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
  assert.match(orders, /bg-surface\/95/);
  assert.match(orders, /sticky bottom-2/);
  assert.match(orders, /flex-col items-stretch gap-1/);
  assert.match(orders, /sm:flex-row sm:items-center/);
  assert.match(globals, /@keyframes nk-dialog-enter/);
  assert.match(globals, /animation: nk-dialog-enter 180ms/);
});

test("order detail uses a full-width table on desktop and compact item blocks on mobile", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const detail = orders.slice(orders.indexOf("function OrderDetailsDialog"));

  assert.match(orders, /max-w-\[61\.25rem\]/);
  assert.match(orders, /max-h-\[min\(46rem,calc\(100dvh-1rem\)\)\]/);
  assert.match(detail, /hidden overflow-hidden rounded-xl[^\n]+lg:block/);
  assert.match(detail, /<table className="w-full table-fixed text-xs"/);
  assert.match(detail, /<thead[\s\S]*Item[\s\S]*Solicitado[\s\S]*Retirado[\s\S]*Falta[\s\S]*Pronto Safisa[\s\S]*Disponível agora[\s\S]*Retirada/);
  assert.match(detail, /lg:hidden/);
  assert.match(detail, /grid grid-cols-3 border-t/);
  assert.match(detail, /grid grid-cols-2 border-t/);
  assert.match(detail, /A retirada registra a entrada no estoque automaticamente\./);
  assert.match(orders, /\{pending \? "Retirando\.\.\." : "Retirar"\}/);
  assert.match(orders, /aria-label="Confirmar retirada e entrada automática no estoque"/);
  assert.match(orders, /max-\[350px\]:sr-only/);
  assert.doesNotMatch(detail, /Confirmar retirada \+ entrada/);
});

test("order detail keeps availability as the operational priority without changing pickup bounds", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const detail = orders.slice(orders.indexOf("function OrderDetailsDialog"));

  assert.match(detail, /maximumSafisaPickupQuantity\([\s\S]*item\.orderedQuantity,[\s\S]*item\.cancelledQuantity,[\s\S]*item\.readyQuantity/);
  assert.match(detail, /item\.readyWaitingPickupQuantity > 0[\s\S]*text-emerald-800/);
  assert.match(detail, /Pronto Safisa[\s\S]*font-mono text-sm font-bold text-text-muted/);
  assert.match(detail, /Disponível agora[\s\S]*font-mono text-base font-black/);
  assert.match(orders, /touchFriendly/);
});

test("order detail opens available item images from the code without an eye button", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const image = read("components/commercial-configuration-image.tsx");
  const compatibleImages = read("components/compatible-kit-images.tsx");
  const detail = orders.slice(orders.indexOf('aria-labelledby={`${titleId}-items`}'));

  assert.match(orders, /function OrderItemImageCode/);
  assert.match(detail, /<OrderItemIdentity/);
  assert.match(orders, /function OrderItemIdentity[\s\S]*<OrderItemImageCode/);
  assert.doesNotMatch(detail, /<OrderItemImageButton/);
  assert.match(orders, /triggerLabel={`Ver imagem do Cód\. \$\{code\}`}/);
  assert.match(orders, /Cód\. \{code\}/);
  assert.match(image, /triggerVariant === "code-link"/);
  assert.match(image, /underline-offset-4/);
  assert.match(compatibleImages, /triggerVariant === "code-link"/);
  assert.match(compatibleImages, /aria-label=\{actionLabel\}/);
  assert.doesNotMatch(detail, />\s*Ver imagem\s*</);
});
