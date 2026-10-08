// Actual SafisaPortal + actual CSS; LOCAL read-only stubs, not browser automation.
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stubs = {
  "next/navigation": `const navigate=(url,replace)=>{history[replace?'replaceState':'pushState']({...history.state},'',url);window.dispatchEvent(new Event('nk87-fixture-route'));};
    export function useRouter(){return {push:url=>navigate(url,false),replace:url=>navigate(url,true),back:()=>history.back(),prefetch(){},refresh(){}}}`,
  "@/app/safisa/actions": `const denied=async()=>{throw new Error('No mutation permitted in visual fixture');};
    export const incrementSafisaReadyQuantity=denied,markSafisaRemainingReady=denied,markSafisaOrderRemainingReady=denied,correctSafisaReadyQuantity=denied,safisaLogout=denied;`,
};
const result = await build({
  absWorkingDir: root, entryPoints: ["tests/safisa-portal-ui.browser-fixture.tsx"], bundle: true,
  platform: "browser", write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "read-only-safisa", setup(builder) {
    builder.onResolve({ filter: /^(next\/navigation|@\/app\/safisa\/actions)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js", resolveDir: root }));
  } }],
});
const css = await postcss([tailwindcss()]).process(readFileSync(resolve(root, "app/globals.css"), "utf8"), { from: resolve(root, "app/globals.css") });
const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NK #87 — Safisa local sanitizada</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(result.outputFiles[0].contents); }
  else if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css.css); }
  else if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); }
  else { response.setHeader("Content-Type", "text/html;charset=utf-8"); response.end(html); }
}).listen(3087, "127.0.0.1", () => console.log("Sanitized LOCAL Safisa fixture: http://127.0.0.1:3087/safisa"));
