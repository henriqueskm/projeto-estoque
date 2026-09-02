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
  const sidebar = read("components/app-sidebar.tsx");
  const structured = read("components/assistant-structured-block.tsx");

  assert.match(home, /label: "Preparar entrada"/);
  assert.match(home, /label: "Preparar saída"/);
  assert.match(home, /label: "Analisar foto de Pedido"/);
  assert.match(home, /prompt: "Dê entrada manual\."/);
  assert.match(home, /prompt: "Dê saída manual\."/);
  assert.match(home, /context\?\.openOrderPhotoPicker/);
  assert.match(structured, /option\.id === "initial-order-photo"/);
  assert.match(sidebar, /aria-label="Nova conversa"/);
  assert.match(sidebar, /assistantNewConversationRequestEvent/);
  assert.match(home, /addEventListener\([\s\S]*assistantNewConversationRequestEvent/);
  assert.doesNotMatch(home, /isConversationMenuOpen/);
  assert.doesNotMatch(home, /flex-col gap-4 pr-12/);
  assert.match(home, /role="log"/);
  assert.match(home, /aria-relevant="additions text"/);
  assert.doesNotMatch(home, /MicrophoneIcon/);
});

test("Assistant chat keeps transcription feedback below the composer controls", () => {
  const home = read("components/assistant-home.tsx");
  const sidebar = read("components/app-sidebar.tsx");
  const voice = read("components/assistant-voice-dictation.tsx");

  assert.match(home, /bg-gradient-to-b from-app-background\/75 via-app-background\/35 to-transparent/);
  assert.match(home, /className="relative -mt-16 flex h-dvh min-h-0 flex-col overflow-hidden lg:mt-0"/);
  assert.match(home, /isHydrated && messages\.length === 0/);
  assert.match(home, /aria-label="Nova conversa"[\s\S]*lg:inline-flex/);
  assert.match(home, /lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-0 lg:border-t-0 lg:bg-transparent/);
  assert.match(home, /<AssistantVoiceDictation/);
  assert.doesNotMatch(sidebar, /bg-brand-charcoal-soft\/70 text-white[\s\S]*<ComposeIcon/);
  assert.match(home, /right-\[7\.25rem\] left-\[4\.5rem\]/);
  assert.match(home, /bg-surface px-2 py-1/);
  assert.doesNotMatch(home, /<header className=/);
  assert.match(read("components/app-sidebar.tsx"), /isAssistantHome \? \(/);
  assert.match(read("components/app-sidebar.tsx"), /!isAssistantHome \? \(/);
  assert.match(read("app\/(authenticated)\/layout.tsx"), /min-h-dvh pt-16 lg:pt-0 lg:pl-64/);
  assert.match(read("app\/globals.css"), /nk-mobile-nav-enter 260ms/);
  assert.match(read("app\/globals.css"), /\.nk-mobile-nav-backdrop-enter/);
  assert.match(read("app\/globals.css"), /nk-mobile-nav-exit 240ms/);
  assert.match(read("components/app-sidebar.tsx"), /isDrawerClosing \? "nk-mobile-nav-exit"/);
  assert.match(read("components/app-sidebar.tsx"), /right-\[7\.25rem\] left-\[4\.5rem\]/);
  assert.match(read("components/app-sidebar.tsx"), /pointer-events-auto flex max-w-full items-center justify-center rounded-full/);
  assert.match(read("components/app-sidebar.tsx"), /w-\[min\(17\.5rem,calc\(100vw-3\.5rem\)\)\]/);
  assert.doesNotMatch(read("app\/(authenticated)\/layout.tsx"), /AssistantFloatingLink/);
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

test("inventory table headers scroll naturally on mobile and remain sticky on desktop", () => {
  const workspace = read("app/(authenticated)/estoque/inventory-workspace.tsx");
  const headerClass = workspace.match(
    /const stickyHeaderClassName =\s*\n\s*"([^"]+)"/,
  )?.[1] ?? "";

  assert.doesNotMatch(headerClass, /(^|\s)sticky(\s|$)/);
  assert.match(headerClass, /lg:sticky lg:top-0 lg:z-30/);
  assert.match(headerClass, /first:rounded-tl-lg last:rounded-tr-lg/);
  assert.doesNotMatch(headerClass, /safe-area-inset-top/);
});

test("manual stock flows use wider mobile tables without sticky mobile headers", () => {
  const inbound = read("app/(authenticated)/entrada/inbound-entry-flow.tsx");
  const outbound = read("app/(authenticated)/saida/outbound-entry-flow.tsx");
  const inboundPage = read("app/(authenticated)/entrada/page.tsx");
  const outboundPage = read("app/(authenticated)/saida/page.tsx");

  for (const flow of [inbound, outbound]) {
    const headerClass = flow.match(
      /const catalogHeaderClassName =\s*\n\s*"([^"]+)"/,
    )?.[1] ?? "";

    assert.doesNotMatch(headerClass, /(^|\s)sticky(\s|$)/);
    assert.doesNotMatch(headerClass, /top-16/);
    assert.match(headerClass, /lg:sticky lg:top-0 lg:z-30/);
    assert.match(headerClass, /first:rounded-tl-xl last:rounded-tr-xl/);
    assert.match(flow, /-mx-3 mt-3 overflow-hidden bg-surface/);
    assert.match(flow, /sm:rounded-3xl sm:border sm:border-border-neutral/);
  }

  assert.doesNotMatch(inboundPage, /nk-industrial-grid/);
  assert.doesNotMatch(outboundPage, /nk-industrial-grid/);
  assert.match(inboundPage, /Selecione itens e informe as quantidades recebidas\./);
  assert.match(outboundPage, /Selecione itens, confira os saldos e revise antes de confirmar\./);
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

test("wide order dialogs stay proportionate and render a compact operational table", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const detail = orders.slice(orders.indexOf('aria-labelledby={`${titleId}-items`}'));

  assert.match(orders, /max-w-\[61\.25rem\]/);
  assert.match(orders, /max-h-\[min\(46rem,calc\(100dvh-1rem\)\)\]/);
  assert.match(detail, /role="table"/);
  assert.match(detail, /<span role="columnheader">Cód\.<\/span>/);
  assert.match(detail, /<span role="columnheader">Descrição dos Produtos<\/span>/);
  assert.match(detail, /<span role="columnheader" className="text-right">Qtde\.<\/span>/);
  assert.match(detail, /<span role="columnheader" className="text-right">Retirado<\/span>/);
  assert.match(detail, /grid-cols-\[minmax\(3\.25rem,0\.72fr\)_minmax\(0,2\.8fr\)_minmax\(2\.5rem,0\.5fr\)_minmax\(3\.4rem,0\.68fr\)\]/);
});

test("order detail keeps pickup state readable while exposing only the global pickup action", () => {
  const orders = read("app/(authenticated)/pedidos/orders-workspace.tsx");
  const detail = orders.slice(orders.indexOf('aria-labelledby={`${titleId}-items`}'));

  assert.match(detail, /Pronto para retirar:/);
  assert.doesNotMatch(detail, /Pronto pela Safisa:/);
  assert.doesNotMatch(detail, /Disponível para retirar:/);
  assert.match(detail, /item\.readyWaitingPickupQuantity/);
  assert.match(detail, /data-pickup-state=/);
  assert.match(detail, /item\.pickedQuantity === item\.orderedQuantity/);
  assert.match(detail, /item\.pickedQuantity > 0 && !fullyPicked/);
  assert.match(detail, /fullyPicked \? "bg-emerald-50\/55" : "bg-white"/);
  assert.match(detail, /<PickupReadyIcon/);
  assert.match(detail, /Retirar prontos/);
  assert.doesNotMatch(detail, /Nova retirada/);
  assert.doesNotMatch(detail, /<CompactQuantityControl/);
  assert.doesNotMatch(detail, /Confirmar retirada e entrada automática no estoque/);
  assert.match(orders, /waitingStockQuantity: readOnly \? 0 : order\.waitingStockQuantity/);
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
  assert.match(orders, /triggerText=\{code\}/);
  assert.match(image, /triggerVariant === "code-link"/);
  assert.match(image, /underline-offset-4/);
  assert.match(compatibleImages, /triggerVariant === "code-link"/);
  assert.match(compatibleImages, /aria-label=\{actionLabel\}/);
  assert.doesNotMatch(detail, />\s*Ver imagem\s*</);
});
