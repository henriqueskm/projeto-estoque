import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPurchaseRecommendations } from "../lib/purchase-recommendation-domain.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function catalogTarget(overrides = {}) {
  return {
    targetKind: "item",
    targetId: "item-1",
    primaryCode: "2",
    aliases: [],
    itemType: "SERVO",
    typeLabel: "Servoembreagem",
    description: "SERVO MBF-025",
    currentStock: 1,
    minimumStock: 4,
    inventoryHref: "/estoque?item=item-1",
    ...overrides,
  };
}

test("reader domain remains the only recommendation calculation", () => {
  const result = buildPurchaseRecommendations(
    [catalogTarget()],
    [],
  );

  assert.equal(result.buyNow.length, 1);
  assert.equal(result.buyNow[0].recommendedQuantity, 3);
  assert.equal(result.summary.buyNowCount, 1);

  const route = read("app/api/purchase-recommendations/route.ts");
  const launcher = read("components/purchase-recommendation-launcher.tsx");
  assert.match(route, /loadPurchaseRecommendations\(supabase\)/);
  assert.doesNotMatch(launcher, /buildPurchaseRecommendations|minimumStock\s*-/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /getClaims\(\)/);
  assert.match(route, /\.eq\("is_active", true\)/);
});

test("inventory page no longer waits for recommendations", () => {
  const page = read("app/(authenticated)/estoque/page.tsx");
  const workspace = read(
    "app/(authenticated)/estoque/inventory-workspace.tsx",
  );

  assert.doesNotMatch(page, /loadPurchaseRecommendations/);
  assert.doesNotMatch(page, /purchaseRecommendationsResult/);
  assert.match(page, /loadInventoryData\(\)/);
  assert.match(workspace, /<PurchaseRecommendationLauncher/);
});

test("modal open and close use local state plus native history", () => {
  const launcher = read("components/purchase-recommendation-launcher.tsx");
  const panel = read("components/purchase-recommendation-panel.tsx");
  const closeHandler = launcher.slice(
    launcher.indexOf("const close = useCallback"),
    launcher.indexOf("const open = useCallback"),
  );
  const openHandler = launcher.slice(
    launcher.indexOf("const open = useCallback"),
    launcher.indexOf("useEffect(() => {", launcher.indexOf("const open")),
  );

  assert.match(launcher, /setIsOpen\(true\)/);
  assert.match(launcher, /setIsOpen\(false\)/);
  assert.match(launcher, /window\.history\.pushState/);
  assert.match(launcher, /window\.history\.replaceState/);
  assert.match(launcher, /window\.history\.back\(\)/);
  assert.match(launcher, /useSearchParams\(\)/);
  assert.match(launcher, /const historySyncTimer = window\.setTimeout/);
  assert.match(launcher, /searchParams\.get\("view"\)/);
  assert.match(launcher, /urlRequestsOpen[\s\S]*loadRecommendations\("foreground"\)/);
  assert.doesNotMatch(launcher, /router\.(?:push|replace|refresh)/);
  assert.doesNotMatch(closeHandler, /fetch|loadRecommendations|router\./);
  assert.ok(
    openHandler.indexOf("setIsOpen(true)") <
      openHandler.indexOf('loadRecommendations("foreground")'),
  );
  assert.doesNotMatch(panel, /useRouter|router\.(?:push|replace|refresh)/);
  assert.equal(panel.match(/onClick=\{onClose\}/g)?.length, 2);
  assert.match(panel, /event\.key === "Escape"/);
  assert.match(panel, /document\.body\.style\.overflow = "hidden"/);
  assert.match(panel, /previousFocus\?\.focus\(\)/);
  assert.match(panel, /event\.key !== "Tab"/);
});

test("warm and click share one in-flight request and expose loading/error states", () => {
  const launcher = read("components/purchase-recommendation-launcher.tsx");
  const panel = read("components/purchase-recommendation-panel.tsx");

  assert.match(launcher, /requestInFlightRef\.current/);
  assert.match(
    launcher,
    /if \(requestInFlightRef\.current\)[\s\S]*return requestInFlightRef\.current/,
  );
  assert.match(launcher, /requestIdleCallback/);
  assert.match(launcher, /onPointerEnter/);
  assert.match(launcher, /onFocus/);
  assert.match(launcher, /cache: "no-store"/);
  assert.match(launcher, /inventoryDataChangedEvent/);
  assert.match(panel, /Carregando lista recomendada/);
  assert.match(panel, /Tentar novamente/);
  assert.match(panel, /última lista confirmada continua visível/);
});
