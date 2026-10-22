import { resolve as inheritedResolve, load } from "./bundle-inventory-loader.mjs";
export { load };
export function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/shared-catalog") return { shortCircuit: true,
    url: `data:text/javascript,${encodeURIComponent("export function invalidateNkCatalog(){globalThis.__NK95_INVALIDATIONS__++}")}` };
  return inheritedResolve(specifier, context, nextResolve);
}
