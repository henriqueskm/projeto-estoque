// Run in an isolated Node 24 process with the project's node-alias-loader.
// Public, small fixture only. This is NOT a 16 MP stress test or Vercel RSS bound.
import { prepareSupplierOrderPhotoForOpenAI } from "../lib/ai/supplier-order-photo-heic.ts";
import { readSupplierOrderPhotoDimensions } from "../lib/assistant-supplier-order-photo-contract.ts";
import { rainbowHEIC } from "../tests/fixtures/heic-rainbow.mjs";

const initialRssBytes = process.memoryUsage().rss;
const started = performance.now();
const result = await prepareSupplierOrderPhotoForOpenAI({ bytes: rainbowHEIC, mimeType: "image/heic" });
console.log(JSON.stringify({
  node: process.version, platform: process.platform, fixture: "public-rainbow-451x461",
  inputBytes: rainbowHEIC.length, outputBytes: result.bytes.length,
  dimensions: readSupplierOrderPhotoDimensions(result.bytes, result.mimeType),
  durationMs: Math.round(performance.now() - started), initialRssBytes,
  finalRssBytes: process.memoryUsage().rss,
  processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  limitation: "isolated small-fixture process; native/external/WASM memory is not capped by V8 heap; not Vercel production measurement",
}));
