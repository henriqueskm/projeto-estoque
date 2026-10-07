import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { navigationSample, observeNavigationSample, performanceRoute, startNavigationSample } from "../lib/navigation-performance.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("metrics separate shell and ready and retain the first observation", () => {
  let pending = startNavigationSample("/estoque", 100, "sidebar", false);
  pending = observeNavigationSample(pending, "shell", 125);
  pending = observeNavigationSample(pending, "shell", 140);
  pending = observeNavigationSample(pending, "ready", 900);
  assert.deepEqual(navigationSample(pending), { route: "/estoque", kind: "sidebar", shellMs: 25, readyMs: 800, prefetchIntentObserved: false });
  assert.deepEqual(Object.keys(navigationSample(pending)).sort(), ["route", "kind", "shellMs", "readyMs", "prefetchIntentObserved"].sort());
});

test("direct ready does not invent a shell measurement", () => {
  const sample = observeNavigationSample(startNavigationSample("/entrada", 10, "sidebar", true), "ready", 30);
  assert.equal(sample.shellMs, null);
  assert.equal(sample.readyMs, 20);
});

test("clock rounding and initial sample remain structural", () => {
  const sample = observeNavigationSample(startNavigationSample("/", 0, "initial", null), "ready", 10.8);
  assert.equal(sample.readyMs, 11);
  assert.equal(observeNavigationSample(sample, "shell", -1).shellMs, 0);
});

test("only official section names enter diagnostics", () => {
  for (const route of ["/", "/estoque", "/entrada", "/saida", "/pedidos", "/aplicacoes", "/estatisticas", "/historico"]) assert.equal(performanceRoute(route), route);
  assert.equal(performanceRoute("/aplicacoes/mercedes-benz"), "/aplicacoes");
  for (const route of ["https://evil.invalid/estoque", "/pedidos?order=secret", "/api/stock", "/estoque/secret", "javascript:alert(1)"]) assert.equal(performanceRoute(route), null);
});

for (const [route, title] of [["estoque", "Estoque"], ["entrada", "Entrada manual"], ["saida", "Saída manual"], ["pedidos", "Pedidos"], ["aplicacoes", "Aplicações"], ["estatisticas", "Estatísticas"], ["historico", "Histórico de movimentações"]]) {
  test(`${route} shell is identifiable, static and contains no stock data`, () => {
    const source = read(`app/(authenticated)/${route}/loading.tsx`);
    assert.ok(source.includes(`data-nk-perf-shell="/${route}"`));
    assert.ok(source.includes(title));
    assert.match(source, /<h1/);
    assert.match(source, /aria-busy="true"/);
    assert.doesNotMatch(source, /loadInventory|loadStock|createClient|minimumStock|readyQuantity|assembledQuantity|looseQuantity|use cache|data-nk-perf-ready/);
  });
}

test("auth streams without caching identity or moving the profile gate", () => {
  const layout = read("app/(authenticated)/layout.tsx");
  assert.match(layout, /<Suspense fallback=/);
  assert.match(layout, /<AuthenticatedContent>\{children\}<\/AuthenticatedContent>/);
  assert.match(layout, /await measurePerformanceAudit\("auth", "layout_profile", requireActiveProfile\)/);
  assert.match(layout, /WorkspaceStateProvider key=\{profile.id\} userId=\{profile.id\}/);
  assert.doesNotMatch(layout, /use cache|instant = false/);
});

test("diagnostics are gated, hidden Activity markers excluded and observers cleaned", () => {
  const layout = read("app/(authenticated)/layout.tsx");
  const panel = read("components/performance-audit-panel.tsx");
  assert.match(layout, /process.env.NODE_ENV !== "production" \|\| process.env.VERCEL_ENV === "preview"/);
  assert.match(panel, /if \(!enabled\) return null/);
  assert.match(panel, /getClientRects\(\).length > 0/);
  assert.match(panel, /observer.disconnect\(\)/);
  assert.match(panel, /cancelAnimationFrame\(frame\)/);
  assert.match(panel, /shellMs === null \? "não observado"/);
  assert.doesNotMatch(panel, /fetch\(|sendBeacon|localStorage|access_token|refresh_token|\.setAttribute\(/);
});

test("official flags do not change dependencies or introduce operational caches", () => {
  const config = read("next.config.ts");
  assert.match(config, /cacheComponents: true/);
  assert.match(config, /partialPrefetching: true/);
  assert.doesNotMatch(config, /experimental|staleTimes/);
  const dependencies = JSON.parse(read("package.json")).dependencies;
  assert.equal(dependencies.next, "16.3.8");
  assert.equal(dependencies.react, "19.2.4");
  const catalog = read("lib/shared-catalog.ts");
  assert.match(catalog, /unstable_cache/);
  assert.doesNotMatch(catalog, /["']use cache["']/);
});

test("compatibility removal keeps authenticated handlers no-store and runtime-only", () => {
  for (const route of ["catalog/configuration-image", "purchase-recommendations", "push-subscriptions", "safisa-pickup-alerts", "supplier-orders/[orderId]", "supplier-orders/[orderId]/media", "supplier-orders/catalog", "supplier-orders/search"]) {
    const source = read(`app/api/${route}/route.ts`);
    assert.match(source, /no-store/);
    assert.match(source, /getClaims|authenticateSupplierOrdersRequest/);
    assert.doesNotMatch(source, /export const dynamic|["']use cache["']/);
  }
});

test("secondary build boundaries preserve proposal authorization and manual not-found guard", () => {
  const proposal = read("app/(public)/apresentacao/proposta/page.tsx");
  assert.match(proposal, /await hasCommercialProposalSession\(\)/);
  assert.match(proposal, /if \(!session\) return <CommercialProposalLogin/);
  assert.match(proposal, /<Suspense[\s\S]*<AuthenticatedProposalContent/);
  assert.doesNotMatch(proposal, /["']use cache["']/);
  const manual = read("app/(public)/manual/[slug]/page.tsx");
  assert.match(manual, /if \(!article\) notFound\(\)/);
  assert.match(manual, /generateStaticParams/);
});

test("operational pages block runtime prefetch before starting any loader", () => {
  for (const route of ["estoque", "entrada", "saida", "pedidos", "aplicacoes", "estatisticas", "historico", "aplicacoes/[slug]", "historico/[batchId]", "minha-conta"]) {
    const source = read(`app/(authenticated)/${route}/page.tsx`);
    assert.match(source, /import \{ connection \} from "next\/server"/);
    assert.match(source, /export default async function[\s\S]*?\)\s*\{\s*\/\/[^\n]*\n\s*await connection\(\);/);
    assert.doesNotMatch(source, /["']use cache["']/);
  }
  assert.match(read("app/(authenticated)/layout.tsx"), /await connection\(\);\s*const profile = await measurePerformanceAudit/);
  assert.match(read("app/(authenticated)/page.tsx"), /await connection\(\);\s*return loadAssistantAttention\(\)/);
});
