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

function moduleUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: moduleUrl("export {}"), shortCircuit: true };
  }

  if (specifier === "@/lib/auth") {
    return {
      url: moduleUrl(`
        export async function requireActiveProfile() {
          globalThis.__NK66_GATE_CALLS__ += 1;
          const auth = globalThis.__NK66_CURRENT_AUTH__;
          if (!auth?.active) throw new Error("redirected before catalog lookup");
          return { id: auth.userId };
        }
      `),
      shortCircuit: true,
    };
  }

  if (specifier === "@/lib/supabase/server") {
    return {
      url: moduleUrl(`
        export async function createClient() {
          const auth = globalThis.__NK66_CURRENT_AUTH__;
          return {
            ...(globalThis.__NK66_REQUEST_CLIENT__ ?? {}),
            auth: {
              async getSession() {
                return {
                  data: {
                    session: auth?.token ? {
                      access_token: auth.token,
                      user: { id: auth.sessionUserId ?? auth.userId },
                    } : null,
                  },
                  error: null,
                };
              },
            },
          };
        }
      `),
      shortCircuit: true,
    };
  }

  if (specifier === "@supabase/supabase-js") {
    return {
      url: moduleUrl(`
        export function createClient(_url, _key, options) {
          const authorization = options?.global?.headers?.Authorization ?? "";
          const token = authorization.replace(/^Bearer\\s+/u, "");
          globalThis.__NK66_BOUND_TOKENS__.push(token);
          const client = globalThis.__NK66_CLIENTS_BY_TOKEN__.get(token);
          if (!client) throw new Error("unknown test token");
          return client;
        }
      `),
      shortCircuit: true,
    };
  }

  if (specifier === "@/lib/assistant-order-photo-route") {
    return {
      url: moduleUrl(`
        export function assistantOrderPhotoJson(body, status) {
          return Response.json(body, { status });
        }
        export async function authenticateAssistantOrderPhotoRequest() {
          return { supabase: {} };
        }
        export async function readExactJson(request) {
          return request.json();
        }
      `),
      shortCircuit: true,
    };
  }

  if (specifier === "@/lib/catalog-writer") {
    return {
      url: moduleUrl(`
        export class CatalogWritePolicyError extends Error {}
        export async function executeCatalogWrite(client, write) {
          return globalThis.__NK66_EXECUTE_CATALOG_WRITE__(client, write);
        }
      `),
      shortCircuit: true,
    };
  }

  if (specifier === "next/cache") {
    return {
      url: moduleUrl(`
        export function unstable_cache(callback, keyParts, options = {}) {
          const key = JSON.stringify(keyParts);
          return async function load() {
            globalThis.__NK66_CACHE_LOOKUPS__.push(keyParts);
            const entry = globalThis.__NK66_PERSISTENT_CACHE__.get(key);
            if (entry) return entry.value;
            const value = await callback();
            globalThis.__NK66_PERSISTENT_CACHE__.set(key, {
              value,
              tags: options.tags ?? [],
            });
            return value;
          };
        }

        export function revalidateTag(tag) {
          globalThis.__NK66_REVALIDATE_CALLS__.push(tag);
          for (const [key, entry] of globalThis.__NK66_PERSISTENT_CACHE__) {
            if (entry.tags.includes(tag)) {
              globalThis.__NK66_PERSISTENT_CACHE__.delete(key);
            }
          }
        }
      `),
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
