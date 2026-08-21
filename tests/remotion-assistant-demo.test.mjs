import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AssistantConversationDemo is registered with the approved composition contract", async () => {
  const root = await read("remotion/Root.tsx");
  const composition = await read("remotion/compositions/AssistantConversationDemo.tsx");

  assert.match(root, /id="AssistantConversationDemo"/);
  assert.match(root, /durationInFrames=\{990\}/);
  assert.match(root, /fps=\{30\}/);
  assert.match(root, /width=\{1920\}/);
  assert.match(root, /height=\{1080\}/);
  assert.match(composition, /ASSISTANT_DEMO_DURATION = 990/);
  assert.match(composition, /Sequence from=\{0\} durationInFrames=\{540\}/);
  assert.match(composition, /Sequence from=\{528\} durationInFrames=\{384\}/);
  assert.match(composition, /Sequence from=\{906\} durationInFrames=\{84\}/);
});

test("the demo fixture is local, typed and matches the approved screenshots", async () => {
  const fixture = await read("remotion/data/assistant-demo-fixture.ts");

  assert.match(fixture, /totalQuantity:\s*11/);
  assert.match(fixture, /mountedQuantity:\s*4/);
  assert.match(fixture, /kind:\s*"partial_reference"/);
  assert.match(fixture, /code:\s*"2A"/);
  assert.match(fixture, /description:\s*"MBF-025 \+ KT-18"/);
  assert.match(fixture, /quantity:\s*3/);
  assert.match(fixture, /assertCompleteBreakdownMatchesMountedQuantity/);
  assert.match(fixture, /configurationsTotal !== inventory\.mountedQuantity/);
  assert.doesNotMatch(fixture, /officialConfigurationCodes/);
  assert.match(fixture, /leadingCode:\s*"1B \/ 1D"/);
  assert.match(fixture, /leadingDescription:\s*"SERVO MBF-015 \+ KT-02"/);
  assert.match(fixture, /leadingQuantity:\s*2/);
  assert.doesNotMatch(fixture, /supabase|fetch\(|Gemini|@google\/genai/i);
});

test("mounted configuration and ranking copy do not claim unavailable data", async () => {
  const inventory = await read("remotion/scenes/InventoryConversationScene.tsx");
  const statistics = await read("remotion/scenes/StatisticsConversationScene.tsx");

  assert.match(inventory, /Posso mostrar uma configuração do modelo com saldo montado\./);
  assert.match(inventory, /Configurações do modelo \{inventory\.model\}/);
  assert.match(inventory, /Cód\. \{configuration\.code\}/);
  assert.match(inventory, /ESTOQUE/);
  assert.match(inventory, /hasCompleteMountedBreakdown\s*\?/);
  assert.match(inventory, /Esta é uma configuração do modelo/);
  assert.match(statistics, /ranking de até cinco configurações com mais saídas/);
  assert.match(statistics, /Ranking oficial das configurações com saída no período\./);
  assert.doesNotMatch(statistics, /Ranking oficial com cinco configurações/);
});

test("composition animation is frame-driven and has no CSS timeline", async () => {
  const files = [
    "remotion/compositions/AssistantConversationDemo.tsx",
    "remotion/scenes/InventoryConversationScene.tsx",
    "remotion/scenes/StatisticsConversationScene.tsx",
    "remotion/scenes/OutroScene.tsx",
    "remotion/utils/animation.ts",
  ];
  const source = (await Promise.all(files.map(read))).join("\n");

  assert.match(source, /useCurrentFrame/);
  assert.match(source, /useVideoConfig/);
  assert.match(source, /interpolate/);
  assert.match(source, /spring/);
  assert.match(source, /translate:\s*`0 \$\{scroll\}px`/);
  assert.match(source, /\[0, 362, 382, 516\], \[0, 0, -340, -340\]/);
  assert.match(source, /\[0, 228, 250, 360\], \[0, 0, -220, -220\]/);
  assert.match(source, /durationInFrames: 14/);
  assert.doesNotMatch(source, /animation(Name)?\s*:|transition\s*:/i);
});

test("public integration lazily loads Player and preserves static reduced-motion/mobile fallback", async () => {
  const page = await read("app/(public)/apresentacao/page.tsx");
  const boundary = await read("components/public-site/assistant-demo-player.tsx");
  const runtime = await read("components/public-site/assistant-demo-runtime.tsx");
  const css = await read("app/(public)/public-site.css");

  assert.match(page, /<AssistantDemoPlayer \/>/);
  assert.match(boundary, /dynamic\(/);
  assert.match(boundary, /ssr:\s*false/);
  assert.match(boundary, /IntersectionObserver/);
  assert.match(boundary, /prefers-reduced-motion:\s*reduce/);
  assert.match(boundary, /max-width:\s*39\.99rem/);
  assert.match(boundary, /<AssistantDemoFallback \/>/);
  assert.match(runtime, /from "@remotion\/player"/);
  assert.match(runtime, /autoPlay/);
  assert.match(runtime, /loop=\{false\}/);
  assert.doesNotMatch(runtime, /\n\s*loop\s*[\n\r]/);
  assert.match(boundary, /rootMargin: "0px 0px -12% 0px"/);
  assert.match(boundary, /threshold: 0\.35/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("public noindex and proxy public-route contract remain explicit", async () => {
  const page = await read("app/(public)/apresentacao/page.tsx");
  const proxy = await read("lib/supabase/proxy.ts");

  assert.match(page, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.match(proxy, /pathname === "\/apresentacao"/);
  assert.match(proxy, /pathname === "\/manual"/);
  assert.match(proxy, /pathname\.startsWith\("\/manual\/"\)/);
});
