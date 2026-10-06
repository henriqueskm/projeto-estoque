import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
export async function resolve(specifier, context, nextResolve) {
  if (process.env.BULK_PICKUP_VISUAL_FIXTURE === "1" && specifier === "react-dom") return {
    url: "data:text/javascript,export function createPortal(children){return children}", shortCircuit: true,
  };
  const stubs = {
    "@/lib/auth": "export async function requireActiveProfile(){if(globalThis.__bulkAuth===false)throw new Error('inactive');return {id:'fixture'}}",
    "@/lib/supabase/server": "export async function createClient(){return globalThis.__bulkClient}",
    "next/cache": "export function revalidatePath(path){globalThis.__bulkPaths.push(path)}",
    "next/navigation": "export function useRouter(){return {refresh(){}}} export function usePathname(){return '/'} export function useSearchParams(){return new URLSearchParams()}",
    "next/link": "import {createElement} from 'react'; export default function Link({children,...props}){return createElement('a',props,children)}",
    "@/components/safisa-pickup-alert-provider": "export function useSafisaPickupAlerts(){return globalThis.__bulkAlerts ?? {alerts:[],alertCount:0,isComplete:true,hasConfirmedData:true,refreshAlerts:async()=>{}}}",
    "@/components/push-notification-control": "export function PushNotificationControl(){return null}",
  };
  if (specifier in stubs) return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  if (specifier.startsWith("@/") || specifier.startsWith(".")) {
    const base = specifier.startsWith("@/") ? new URL(`../${specifier.slice(2)}`, import.meta.url) : new URL(specifier, context.parentURL);
    const target = [base.href, `${base.href}.ts`, `${base.href}.tsx`].find(url => url.startsWith("file:") && existsSync(new URL(url)));
    if (target) return nextResolve(target, context);
  }
  return nextResolve(specifier, context.parentURL?.startsWith("data:") ? { ...context, parentURL: import.meta.url } : context);
}
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  let source = readFileSync(new URL(url), "utf8");
  if (process.env.BULK_PICKUP_VISUAL_FIXTURE === "1" && url.endsWith("/safisa-bulk-pickup-dialog.tsx")) source = source.replace("function BulkDialog(", "export function BulkDialog(");
  return { format: "module", shortCircuit: true, source: ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText };
}
