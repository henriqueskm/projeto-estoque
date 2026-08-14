import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public allowlist is narrow and returns before Supabase authentication", () => {
  const proxy = read("lib/supabase/proxy.ts");
  const earlyReturn = proxy.indexOf("if (isStaticPublicContentRoute)");
  const clientCreation = proxy.indexOf("createServerClient(");

  assert.match(proxy, /pathname === "\/apresentacao"/);
  assert.match(proxy, /pathname === "\/manual"/);
  assert.match(proxy, /pathname\.startsWith\("\/manual\/"\)/);
  assert.ok(earlyReturn > -1 && earlyReturn < clientCreation);
  assert.doesNotMatch(proxy, /pathname\.startsWith\("\/apresentacao"\)/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\("\/api"\)/);
});

test("authenticated and Safisa surfaces remain outside the public allowlist", () => {
  const proxy = read("lib/supabase/proxy.ts");
  const publicExpression = proxy.slice(proxy.indexOf("const isStaticPublicContentRoute"), proxy.indexOf("if (isStaticPublicContentRoute)"));

  for (const route of ["/", "/estoque", "/pedidos", "/estatisticas", "/api", "/safisa"]) {
    assert.doesNotMatch(publicExpression, new RegExp(`\"${route.replace("/", "\\/")}\"`));
  }
  assert.match(proxy, /pathname\.startsWith\("\/safisa"\)/);
});

test("presentation and manual pages are static and do not import operational loaders", () => {
  const paths = [
    "app/(public)/apresentacao/page.tsx",
    "app/(public)/manual/page.tsx",
    "app/(public)/manual/[slug]/page.tsx",
    "app/(public)/manual/layout.tsx",
  ];
  const source = paths.map(read).join("\n");

  assert.doesNotMatch(source, /@\/lib\/supabase/);
  assert.doesNotMatch(source, /createClient|requireActiveProfile|loadSafisaPickupAlerts|loadStatisticsData|loadInventory/);
  assert.doesNotMatch(source, /use client/);
  assert.match(source, /robots: \{ index: false, follow: false \}/);
});

test("all required manual routes have initial content", () => {
  const content = read("lib/public-manual-content.ts");
  for (const slug of ["primeiros-passos", "assistente", "estoque", "entrada-saida", "pedidos", "montagem", "estatisticas", "safisa", "historico", "faq"]) {
    assert.match(content, new RegExp(`slug: \"${slug}\"`));
  }
  assert.match(read("app/(public)/manual/[slug]/page.tsx"), /generateStaticParams/);
});

test("approved local screenshots exist and Drive URLs are not shipped", () => {
  const presentation = read("app/(public)/apresentacao/page.tsx");
  assert.doesNotMatch(presentation, /drive\.google\.com|usercontent\.google\.com/);

  for (const path of [
    "public/presentation/screenshots/assistant/assistant-context-reference-mobile.png",
    "public/presentation/screenshots/photo-order/supplier-order-photo-sanitized.png",
    "public/presentation/screenshots/inventory/inventory-overview-desktop.png",
    "public/presentation/screenshots/orders/supplier-order-detail-mobile.png",
    "public/presentation/screenshots/safisa/safisa-portal-mobile.png",
    "public/presentation/screenshots/statistics/statistics-ranking-mobile.png",
  ]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, path);
  }
});

test("public presentation keeps product terminology and excludes Remotion", () => {
  const presentation = read("app/(public)/apresentacao/page.tsx");
  const packageJson = read("package.json");
  assert.match(presentation, /Servos com kit/);
  assert.match(presentation, /Servos sem kit/);
  assert.match(presentation, /saídas externas/);
  assert.match(presentation, /Automação sem abrir mão do controle/);
  assert.doesNotMatch(presentation, /caixa completa|faturamento|vendas financeiras/i);
  assert.doesNotMatch(packageJson, /remotion/i);
});
