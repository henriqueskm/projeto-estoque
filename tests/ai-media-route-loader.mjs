import { resolve as resolveAlias } from "../evals/assistant/node-alias-loader.mjs";
import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/supabase/server") {
    return { url: "data:text/javascript," + encodeURIComponent("export async function createClient() { return globalThis.__mediaTestSupabase; }"), shortCircuit: true };
  }
  if (specifier === "@/lib/assistant-supplier-order-photo-catalog") {
    return { url: "data:text/javascript," + encodeURIComponent("export class SupplierOrderPhotoCatalogError extends Error {} export async function loadSupplierOrderPhotoCatalog() { if(globalThis.__mediaPhotoCatalogFails) throw new SupplierOrderPhotoCatalogError(); return [{identity:'CONFIGURATION:test',codeIdentity:'code-test',code:'1H',description:'SERVO MBF-025'}]; }"), shortCircuit: true };
  }
  return resolveAlias(specifier, context, nextResolve);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith("/order-photo/interpret/route.ts")) return nextLoad(url, context);
  return { format: "module", source: ts.transpileModule(await readFile(new URL(url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, shortCircuit: true };
}
