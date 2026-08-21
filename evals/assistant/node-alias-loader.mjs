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
  if (specifier.startsWith("@/")) {
    const target = new URL(`../../${specifier.slice(2)}.ts`, import.meta.url);
    return nextResolve(target.href, context);
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/u.test(specifier)) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    if (await existing(target)) return nextResolve(target.href, context);
  }

  return nextResolve(specifier, context);
}
