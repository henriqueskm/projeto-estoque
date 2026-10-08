// Serves the REAL report component with sanitized data and a LOCAL fake settings
// action. No cookies, production connection, or browser automation in this script.
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cssPath = resolve(root, "app/(authenticated)/relatorio-estoque/report.module.css");
const css = readFileSync(cssPath, "utf8")
  .replaceAll(":global(body)", "body");
// CSS modules in the real build hash these names; the harness maps the same rules.
const cssNames = Object.fromEntries([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map(match => [match[1], match[1]]));
const stubs = {
  "next/link": "import {createElement} from 'react';export default function Link({children,prefetch,...props}){return createElement('a',props,children)}",
  "next/navigation": "export const usePathname=()=>'/relatorio-estoque';export const useSearchParams=()=>new URLSearchParams();",
  "./actions": "export async function saveInventoryReportOrder(order){window.dispatchEvent(new CustomEvent('nk86-fixture-save',{detail:order}));return {success:true}}",
};
const result = await build({
  absWorkingDir: root, entryPoints: ["tests/inventory-report.browser-fixture.tsx"], bundle: true,
  platform: "browser", write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "local-report-fixture", setup(builder) {
    builder.onResolve({ filter: /^(next\/|\.\/actions$)/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : null);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js", resolveDir: root }));
    builder.onResolve({ filter: /report\.module\.css$/ }, () => ({ path: cssPath, namespace: "fixture-css" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture-css" }, () => ({ contents: `export default ${JSON.stringify(cssNames)}`, loader: "js" }));
  } }],
});
const utilityCss = await postcss([tailwindcss()]).process(readFileSync(resolve(root, "app/globals.css"), "utf8"), { from: resolve(root, "app/globals.css") });
const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NK #86 — fixture local do relatório</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(result.outputFiles[0].contents); }
  else if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(`${utilityCss.css}\n${css}`); }
  else if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); }
  else { response.setHeader("Content-Type", "text/html;charset=utf-8"); response.end(html); }
}).listen(3086, "127.0.0.1", () => console.log("Sanitized local fixture: http://127.0.0.1:3086/relatorio-estoque"));
