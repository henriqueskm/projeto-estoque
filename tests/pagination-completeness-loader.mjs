import { access } from "node:fs/promises";
import { constants } from "node:fs";

async function existing(url) {
  try {
    await access(url, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export%20{}", shortCircuit: true };
  }

  if (specifier === "@/lib/supabase/server") {
    return {
      url: `data:text/javascript,${encodeURIComponent(
        "export async function createClient(){const client=globalThis.__NK63_PAGINATION_CLIENT__;client.auth??={getSession:async()=>({data:{session:{access_token:'pagination-test-token',user:{id:'pagination-test-user'}}},error:null})};return client}",
      )}`,
      shortCircuit: true,
    };
  }

  if (specifier === "@/lib/auth") {
    return {
      url: `data:text/javascript,${encodeURIComponent(
        "export async function requireActiveProfile(){return {id:'pagination-test-user',name:'Pagination Test',displayName:'Pagination Test',email:'pagination@example.com',hasRegisteredName:true}}",
      )}`,
      shortCircuit: true,
    };
  }

  if (specifier === "@supabase/supabase-js") {
    return {
      url: `data:text/javascript,${encodeURIComponent(
        "export function createClient(){return globalThis.__NK63_PAGINATION_CLIENT__}",
      )}`,
      shortCircuit: true,
    };
  }

  if (specifier === "next/cache") {
    return {
      url: `data:text/javascript,${encodeURIComponent(
        "export function unstable_cache(callback){return callback} export function revalidateTag(){} export function revalidatePath(){}",
      )}`,
      shortCircuit: true,
    };
  }

  if (specifier === "@/app/(authenticated)/pedidos/actions") {
    return {
      url: "data:text/javascript,export async function createSupplierOrderStockEntryAction(){throw new Error('not used in pagination tests')}",
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("next/") && !/\.[cm]?[jt]sx?$/u.test(specifier)) {
    return nextResolve(`${specifier}.js`, context);
  }

  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    const target = new URL(
      `../${relative}${/\.[cm]?[jt]sx?$/u.test(relative) ? "" : ".ts"}`,
      import.meta.url,
    );
    return nextResolve(target.href, context);
  }

  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[cm]?[jt]sx?$/u.test(specifier)
  ) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    if (await existing(target)) return nextResolve(target.href, context);
  }

  return nextResolve(specifier, context);
}
