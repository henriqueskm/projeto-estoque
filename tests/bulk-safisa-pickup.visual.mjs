// Local read-only SSR fixture of the real dialog/preview, with built application CSS.
// No Supabase client, production data, authentication, or mutation is used.
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BulkDialog, SafisaBulkPickupPreviewContent } from "../components/safisa-bulk-pickup-dialog.tsx";

if (process.env.BULK_PICKUP_VISUAL_FIXTURE !== "1") throw new Error("Dedicated visual loader mode required");
globalThis.document = { body: {} };
const cssRoot = ".next/static";
const css = readdirSync(cssRoot, { recursive: true }).filter(name => name.endsWith(".css")).map(name => readFileSync(join(cssRoot, name), "utf8")).join("\n");
const uuid = n => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const preview = {
  orderCount: 4, lineCount: 8, totalQuantity: 79992,
  orders: Array.from({ length: 4 }, (_, i) => ({
    supplierOrderId: uuid(i), negotiationNumber: "40959", orderDate: "2026-10-06",
    lines: Array.from({ length: 2 }, (_, j) => ({
      supplierOrderItemId: uuid(10 + i * 2 + j), code: j ? "1H" : "CODIGO-SANITIZADO-MUITO-LONGO-SEM-DADOS-REAIS",
      descriptionSnapshot: "Descrição sanitizada extensa de um componente para verificar quebra segura e leitura em telas pequenas. ".repeat(2),
      quantityToPickup: 9999,
    })),
  })),
};
const buttonClass = "nk-focus min-h-11 rounded-xl px-4 py-2 text-sm font-bold";
const markup = renderToStaticMarkup(h(BulkDialog, { pending: false, onClose() {}, success: false },
  h("div", { className: "min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4" }, h(SafisaBulkPickupPreviewContent, { preview })),
  h("footer", { className: "flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-neutral p-3" },
    h("button", { className: `${buttonClass} border border-border-neutral` }, "Cancelar"),
    h("button", { className: `${buttonClass} min-w-0 bg-emerald-700 text-white` }, "Confirmar retirada + entrada")),
));
// Existing locked dev-tool dependency, not a new package or production route.
// Compile real React UI + coordinator; replace only server/network boundaries.
const mocks = {
  "next/link": "import {createElement as h} from 'react';export default function Link({children,...props}){return h('a',props,children)}",
  "next/navigation": "export function useRouter(){return {refresh(){window.__refreshes++}}}export function usePathname(){return location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}",
  "@/components/push-notification-control": "export function PushNotificationControl(){return null}",
  "@/components/safisa-pickup-alert-provider": `import {useSyncExternalStore} from 'react';
    const listeners=new Set();window.__clearAlerts=()=>{window.__alerts=[];listeners.forEach(f=>f())};
    const subscribe=f=>{listeners.add(f);return()=>listeners.delete(f)};
    export function useSafisaPickupAlerts(){const alerts=useSyncExternalStore(subscribe,()=>window.__alerts);
    return {alerts,alertCount:alerts.length,isComplete:true,hasConfirmedData:true,error:null,refreshAlerts:async()=>{window.__refreshes++}}}`,
  "@/lib/safisa-bulk-pickup-actions": `export async function previewSafisaBulkPickup(){window.__reads++;return {ok:true,preview:window.__preview}}
    export async function confirmSafisaBulkPickup(request){window.__requests.push(request);window.__writes++;
      if(window.__mode==='pending') await new Promise(resolve=>{window.__resolve=resolve});
      if(window.__mode==='stale')return {ok:false,stale:true,error:'A situação dos Pedidos mudou. Atualize a prévia antes de confirmar.'};
      window.__clearAlerts();
      if(window.__mode==='uncertain'){window.__mode='success';return {ok:false,transportUncertain:true,error:'Resultado não confirmado.'}}
      return {ok:true,receipt:window.__receipt};}`,
};
const browser = await build({ bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import {Activity,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {SemanticBackProvider} from './components/semantic-back-provider';
    import {SafisaPickupAlertHomeSummary} from './components/safisa-pickup-alerts';
    window.__preview=${JSON.stringify(preview)};
    window.__alerts=[{supplierOrderId:'${uuid(1)}',negotiationNumber:'40959',readyWaitingPickupQuantity:17,kind:'PARTIALLY_READY'}];
    window.__receipt={bulkPickupId:'${uuid(500)}',orderCount:4,changedLineCount:8,totalPickedQuantity:79992,totalStockEntryQuantity:79992,orders:[],idempotentReplay:false};
    window.__reads=0;window.__writes=0;window.__refreshes=0;window.__requests=[];window.__mode='success';
    function Fixture(){const [visible,setVisible]=useState(true);return <SemanticBackProvider>
      <button onClick={()=>{window.dispatchEvent(new Event('nk:workspace:before-navigation'));setVisible(!visible)}}>Alternar Activity (fixture)</button>
      <Activity mode={visible?'visible':'hidden'}><SafisaPickupAlertHomeSummary/></Activity>
    </SemanticBackProvider>}createRoot(document.getElementById('fixture')).render(<Fixture/>);`, },
  plugins: [{ name: "read-only-fixture-boundaries", setup(builder) {
    builder.onResolve({filter:/^(next\/(link|navigation)|@\/)/}, args => {
      if (args.path in mocks) return {path:args.path,namespace:"fixture"};
      const base=resolve(args.path.slice(2));
      return {path:[base,base+".ts",base+".tsx"].find(existsSync)};
    });
    builder.onLoad({filter:/.*/,namespace:"fixture"}, args=>({contents:mocks[args.path],loader:"js",resolveDir:process.cwd()}));
  }}],
});
createServer((req, res) => {
  if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  if (req.url === "/fixture.js") { res.writeHead(200,{"Content-Type":"text/javascript"});res.end(browser.outputFiles[0].text);return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  const content=req.url === "/interactive" ? '<div id="fixture"></div><script src="/fixture.js"></script>' : markup;
  res.end(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>NK84 — fixture local sanitizada</title><style>${css}</style></head><body>${content}</body></html>`);
}).listen(3084, "127.0.0.1", () => console.log("Read-only sanitized visual fixture: http://127.0.0.1:3084"));
