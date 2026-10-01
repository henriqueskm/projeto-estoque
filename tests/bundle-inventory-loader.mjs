import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const moduleUrl = (source) =>
  `data:text/javascript,${encodeURIComponent(source)}`;

export async function resolve(specifier, context, nextResolve) {
  const stubs = {
    "@/lib/supabase/server":
      "export async function createClient(){return globalThis.__NK72_CLIENT__}",
    "@/lib/shared-catalog":
      "export async function loadSharedCatalogSnapshot(){if(!globalThis.__NK72_ACTIVE__)throw new Error('inactive');return globalThis.__NK72_SNAPSHOT__} export function invalidateNkCatalog(){throw new Error('Unexpected catalog write')}",
    "next/cache":
      "export function revalidatePath(path){globalThis.__NK72_PATHS__.push(path)}",
    "next/navigation":
      "export function useRouter(){return {refresh(){},push(){}}} export function usePathname(){return '/estoque'}",
    "next/link":
      "import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}",
    "@/components/commercial-configuration-image":
      "export function CommercialConfigurationImage(){return null}",
    "@/components/compatible-kit-images":
      "export function CompatibleKitImages(){return null}",
    "@/components/purchase-recommendation-launcher":
      "export function PurchaseRecommendationLauncher(){return null}",
    "server-only": "export {}",
  };
  if (specifier in stubs)
    return { url: moduleUrl(stubs[specifier]), shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const base = new URL(`../${specifier.slice(2)}`, import.meta.url);
    const target = [base.href, `${base.href}.ts`, `${base.href}.tsx`].find(
      (url) => existsSync(new URL(url)),
    );
    if (target) return nextResolve(target, context);
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    for (const extension of [".ts", ".tsx"]) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
  }
  return nextResolve(
    specifier,
    context.parentURL?.startsWith("data:")
      ? { ...context, parentURL: import.meta.url }
      : context,
  );
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  let source = await readFile(new URL(url), "utf8");
  // Drive the actual route render from a selected initial search, without adding
  // a test-only prop/state path to the production components.
  source = source.replace(
    'const [query, setQuery] = useState("");',
    'const [query, setQuery] = useState(globalThis.__NK72_SEARCH__ ?? "");',
  );
  source = source.replace(
    'const [search, setSearch] = useState("");',
    'const [search, setSearch] = useState(globalThis.__NK72_SEARCH__ ?? "");',
  );
  source = source.replace(
    'const [sort, setSort] = useState<InventorySort>("code");',
    'const [sort, setSort] = useState<InventorySort>(globalThis.__NK72_SORT__ ?? "code");',
  );
  if (url.endsWith("/inventory-row-actions.tsx"))
    source = source.replace(
      "const [isOpen, setIsOpen] = useState(false);",
      "const [isOpen, setIsOpen] = useState(globalThis.__NK72_MENU_OPEN__ ?? false);",
    );
  return {
    format: "module",
    source: ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
    shortCircuit: true,
  };
}
