// Serves real inventory UI with LOCAL fake actions and synthetic data only.
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname,"..");
const stubs = {
  "next/link": "import {createElement} from 'react';export default function Link({children,prefetch,...props}){return createElement('a',props,children)}",
  "next/navigation": "export const usePathname=()=>'/estoque';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({refresh(){window.dispatchEvent(new Event('nk95-refresh'))},push(){},prefetch(){}});",
  "@/app/(authenticated)/estoque/catalog-actions": "export const loadPhysicalCatalogPreview=(...args)=>window.__nk95Fixture.preview(...args);export const managePhysicalCatalog=(...args)=>window.__nk95Fixture.manage(...args);",
  "@/app/(authenticated)/estoque/actions": ["adjustInventoryStock","assembleCommercialConfiguration","changeConfigurationMinimumStock","changeItemMinimumStock","disassembleCommercialConfiguration","assembleCommercialBundle","disassembleCommercialBundle"].map(n=>`export async function ${n}(){throw Error('Out of fixture scope')}`).join("\n"),
  "@/app/(authenticated)/saida/actions": "export async function submitInventorySale(){throw Error('Out of fixture scope')}",
  "@/components/commercial-configuration-image": "export function CommercialConfigurationImage(){return null}",
  "@/components/compatible-kit-images": "export function CompatibleKitImages(){return null}",
  "@/components/purchase-recommendation-launcher": "export function PurchaseRecommendationLauncher(){return null}",
};
const result = await build({ absWorkingDir: root, entryPoints: ["tests/physical-catalog-management.browser-fixture.tsx"], bundle: true, platform: "browser", write: false, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "local-catalog-fixture", setup(b) {
    b.onResolve({filter: /^(next\/|@\/)/}, args=>args.path in stubs ? {path:args.path, namespace:"fixture"} : null);
    b.onLoad({filter:/.*/,namespace:"fixture"}, args=>({contents:stubs[args.path],loader:"js",resolveDir:root}));
  } }] });
const css = await postcss([tailwindcss()]).process(readFileSync(resolve(root,"app/globals.css"),"utf8"), {from:resolve(root,"app/globals.css")});
createServer((req,res)=>{
  if(req.url==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(result.outputFiles[0].contents);}
  else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css.css);}
  else if(req.url==="/favicon.ico"){res.writeHead(204);res.end();}
  else {res.setHeader("Content-Type","text/html;charset=utf-8");res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NK95 fixture local sanitizada</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');}
}).listen(3095,"127.0.0.1",()=>console.log("Fixture sanitizada: http://127.0.0.1:3095/estoque"));
