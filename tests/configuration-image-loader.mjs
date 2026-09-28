import { resolve as resolveAlias } from "../evals/assistant/node-alias-loader.mjs";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/supabase/server") {
    return { url: "data:text/javascript,export async function createClient(){return globalThis.__NK_IMAGE_CLIENT__}", shortCircuit: true };
  }
  return resolveAlias(specifier, context, nextResolve);
}
