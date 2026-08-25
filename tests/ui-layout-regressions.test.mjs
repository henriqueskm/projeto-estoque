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

test("Assistant shortcuts expose operations without shifting the conversation for a floating menu", () => {
  const home = read("components/assistant-home.tsx");
  const structured = read("components/assistant-structured-block.tsx");

  assert.match(home, /label: "Preparar entrada"/);
  assert.match(home, /label: "Preparar saída"/);
  assert.match(home, /label: "Analisar foto de Pedido"/);
  assert.match(home, /prompt: "Dê entrada manual\."/);
  assert.match(home, /prompt: "Dê saída manual\."/);
  assert.match(home, /context\?\.openOrderPhotoPicker/);
  assert.match(structured, /option\.id === "initial-order-photo"/);
  assert.match(home, /aria-label="Nova conversa"/);
  assert.match(home, /<span className="sr-only">Nova conversa<\/span>/);
  assert.match(home, /onClick=\{handleNewConversationRequest\}/);
  assert.doesNotMatch(home, /isConversationMenuOpen/);
  assert.doesNotMatch(home, /flex-col gap-4 pr-12/);
  assert.match(home, /role="log"/);
  assert.match(home, /aria-relevant="additions text"/);
  assert.doesNotMatch(home, /MicrophoneIcon/);
});

test("Assistant chat keeps transcription feedback below the composer controls", () => {
  const home = read("components/assistant-home.tsx");
  const voice = read("components/assistant-voice-dictation.tsx");

  assert.match(home, /bg-gradient-to-b from-app-background via-app-background\/95 to-transparent/);
  assert.match(home, /<BrandMark variant="full" size="lg"/);
  assert.doesNotMatch(home, /Consultas e fotos de Pedido geram prévias/);
  assert.match(voice, /order-last basis-full rounded-xl/);
  assert.match(voice, /order-last basis-full px-1 text-xs leading-5 font-semibold text-red-800/);
});

test("Assistant confirmation states name the operation and keep mobile metrics legible", () => {
  const structured = read("components/assistant-structured-block.tsx");

  assert.match(structured, /Registrando entrada\. Não feche esta tela\./);
  assert.match(structured, /Registrando saída\. Não feche esta tela\./);
  assert.match(structured, /Registrando montagem\. Não feche esta tela\./);
  assert.match(structured, /Registrando desmontagem\. Não feche esta tela\./);
  assert.match(structured, /Finalizando Pedido\. Não feche esta tela\./);
  assert.match(structured, /grid-cols-2 gap-1\.5 sm:grid-cols-3/);
  assert.doesNotMatch(
    structured,
    /block truncate text-\[0\.68rem\] font-semibold text-text-muted/,
  );
});

test("purchase recommendations use a compact market-list layout", () => {
  const structured = read("components/assistant-structured-block.tsx");
  const recommendations = structured.slice(
    structured.indexOf("function PurchaseRecommendationCard"),
    structured.indexOf("function SupplierOrderAmbiguity"),
  );

  assert.match(recommendations, /Cód\. \{item\.primaryCode\}/);
  assert.match(recommendations, /Est\.<\/dt>/);
  assert.match(recommendations, /Mín\.<\/dt>/);
  assert.match(recommendations, /min-\[440px\]:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(recommendations, /min-\[440px\]:col-start-2 min-\[440px\]:row-start-1/);
  assert.match(recommendations, /Comprar \{quantityFormatter\.format\(item\.recommendedQuantity/);
  assert.match(recommendations, /Já comprado \{quantityFormatter\.format\(item\.pendingPurchaseQuantity\)\}/);
  assert.match(recommendations, /Projetado \$\{quantityFormatter\.format\(item\.projectedStock\)\}/);
  assert.match(recommendations, /relatedOrders\[0\]\.href/);
  assert.match(
    recommendations,
    /<ul className="mt-3 divide-y divide-border-neutral/,
  );
  assert.doesNotMatch(recommendations, /Abrir no Estoque/);
  assert.doesNotMatch(recommendations, /rounded-xl border border-border-neutral bg-white p-3/);
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

test("wide order dialogs stay proportionate and keep item controls near their metrics", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");

  assert.match(orders, /max-w-\[61\.25rem\]/);
  assert.match(orders, /max-h-\[min\(46rem,calc\(100dvh-1rem\)\)\]/);
  assert.match(orders, /grid-cols-3 gap-2 text-xs/);
  assert.match(orders, /Cód\./);
  assert.match(orders, /sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(orders, /sm:justify-end/);
  assert.match(orders, /bg-gradient-to-b from-sky-600 to-sky-700/);
});

test("order detail preserves its layout while compacting only the pickup information and action", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const detail = orders.slice(orders.indexOf('aria-labelledby={`${titleId}-items`}'));

  assert.match(detail, /Pronto para retirar:/);
  assert.doesNotMatch(detail, /Pronto pela Safisa:/);
  assert.doesNotMatch(detail, /Disponível para retirar:/);
  assert.match(detail, /item\.readyWaitingPickupQuantity/);
  assert.match(detail, /\{isPending && pendingItemId === item\.id[\s\S]*\? "Retirando\.\.\."[\s\S]*: "Retirar"\}/);
  assert.match(detail, /aria-label="Confirmar retirada e entrada automática no estoque"/);
  assert.match(detail, /title="Confirmar retirada e entrada automática no estoque"/);
  assert.doesNotMatch(detail, /Confirmar retirada \+ entrada/);
});

test("order detail opens available item images from the code without an eye button", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const image = read("components/commercial-configuration-image.tsx");
  const compatibleImages = read("components/compatible-kit-images.tsx");
  const detail = orders.slice(orders.indexOf('aria-labelledby={`${titleId}-items`}'));

  assert.match(orders, /function OrderItemImageCode/);
  assert.match(detail, /<OrderItemImageCode/);
  assert.doesNotMatch(detail, /<OrderItemImageButton/);
  assert.match(orders, /triggerLabel={`Ver imagem do Cód\. \$\{code\}`}/);
  assert.match(orders, /Cód\. \{code\}/);
  assert.match(image, /triggerVariant === "code-link"/);
  assert.match(image, /underline-offset-4/);
  assert.match(compatibleImages, /triggerVariant === "code-link"/);
  assert.match(compatibleImages, /aria-label=\{actionLabel\}/);
  assert.doesNotMatch(detail, />\s*Ver imagem\s*</);
});
