import { resolve as paginationResolve } from "./pagination-completeness-loader.mjs";
import { resolve as aliasResolve } from "../evals/assistant/node-alias-loader.mjs";

// Keep the real Assistant action modules: any accidental writer invocation is
// rejected by the test client's rpc(), rather than hidden by a reader stub.
export function resolve(specifier, context, nextResolve) {
  return specifier === "@/app/(authenticated)/pedidos/actions"
    ? aliasResolve(specifier, context, nextResolve)
    : paginationResolve(specifier, context, nextResolve);
}
