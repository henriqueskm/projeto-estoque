import { resolve as baseResolve, load as baseLoad } from "./bundle-inventory-loader.mjs";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/app/safisa/actions") return {
    url: "data:text/javascript," + encodeURIComponent(`
      const denied = async () => { throw new Error('UI render must not execute a mutation'); };
      export const incrementSafisaReadyQuantity = denied, markSafisaRemainingReady = denied,
        markSafisaOrderRemainingReady = denied, correctSafisaReadyQuantity = denied, safisaLogout = denied;
    `), shortCircuit: true,
  };
  return baseResolve(specifier, context, nextResolve);
}
export const load = baseLoad;
