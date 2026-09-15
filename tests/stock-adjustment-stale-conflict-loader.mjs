import { constants } from "node:fs";
import { access } from "node:fs/promises";

async function existing(url) {
  try {
    await access(url, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/cache") {
    return {
      url: "data:text/javascript,export%20function%20revalidatePath(path)%7BglobalThis.__nk58RevalidatedPaths.push(path)%7D",
      shortCircuit: true,
    };
  }

  if (specifier === "@/lib/supabase/server") {
    return {
      url: "data:text/javascript,export%20async%20function%20createClient()%7Breturn%20globalThis.__nk58SupabaseClient%7D",
      shortCircuit: true,
    };
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
    (specifier.startsWith("./") || specifier.startsWith("../"))
    && !/\.[cm]?[jt]sx?$/u.test(specifier)
  ) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    if (await existing(target)) return nextResolve(target.href, context);
  }

  return nextResolve(specifier, context);
}
