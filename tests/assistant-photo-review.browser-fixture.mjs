import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stubs = {
  "next/navigation": "export const usePathname=()=>window.location.pathname; export const useSearchParams=()=>new URLSearchParams(window.location.search);",
  "next/link": "import {createElement} from 'react'; export default function Link({children,prefetch,...props}){return createElement('a',props,children)}",
  "@/components/safisa-bulk-pickup-dialog": "export function SafisaBulkPickupAction(){return null}",
  "@/components/safisa-pickup-alert-provider": "export const useSafisaPickupAlerts=()=>({hasConfirmedData:false,alertCount:0,error:null});",
  "@/components/commercial-configuration-image": "export function CommercialConfigurationImage(){return null}",
  "@/components/compatible-kit-images": "export function CompatibleKitImages(){return null}",
};
const result = await build({ absWorkingDir: root, entryPoints: ["tests/assistant-photo-review.browser-fixture.tsx"], bundle: true, platform: "browser", write: false, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "local-photo-review", setup(b) {
    b.onResolve({ filter: /^(next\/|@\/)/ }, a => a.path in stubs ? { path: a.path, namespace: "fixture" } : null);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: stubs[a.path], loader: "js", resolveDir: root }));
  } }] });
const css = await postcss([tailwindcss()]).process(readFileSync(resolve(root, "app/globals.css"), "utf8"), { from: resolve(root, "app/globals.css") });
createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(result.outputFiles[0].contents); }
  else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css); }
  else if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); }
  else { res.setHeader("Content-Type", "text/html;charset=utf-8"); res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NK102 LOCAL photo review</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
}).listen(3102, "127.0.0.1", () => console.log("LOCAL photo review fixture: http://127.0.0.1:3102/ — NO REMOTE WRITES"));
