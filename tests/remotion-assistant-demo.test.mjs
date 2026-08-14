import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AssistantConversationDemo is registered with the approved composition contract", async () => {
  const root = await read("remotion/Root.tsx");
  const composition = await read("remotion/compositions/AssistantConversationDemo.tsx");

  assert.match(root, /id="AssistantConversationDemo"/);
  assert.match(root, /durationInFrames=\{600\}/);
  assert.match(root, /fps=\{30\}/);
  assert.match(root, /width=\{1920\}/);
  assert.match(root, /height=\{1080\}/);
  assert.match(composition, /Sequence from=\{270\}/);
  assert.match(composition, /Sequence from=\{510\}/);
});

test("the demo fixture is local, typed and matches the approved screenshots", async () => {
  const fixture = await read("remotion/data/assistant-demo-fixture.ts");

  assert.match(fixture, /totalQuantity:\s*11/);
  assert.match(fixture, /mountedQuantity:\s*4/);
  assert.match(fixture, /leadingCode:\s*"1B \/ 1D"/);
  assert.match(fixture, /leadingDescription:\s*"SERVO MBF-015 \+ KT-02"/);
  assert.match(fixture, /leadingQuantity:\s*2/);
  assert.doesNotMatch(fixture, /supabase|fetch\(|Gemini|@google\/genai/i);
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
